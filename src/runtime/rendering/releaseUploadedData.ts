import { BufferAttribute, InterleavedBufferAttribute, Mesh, type BufferGeometry, type Object3D, type Texture } from 'three';
import type { WebGPURenderer } from 'three/webgpu';

/*
 * After warmup every architectural vertex buffer and texture already lives on the GPU,
 * yet three.js keeps the decoded CPU copy (~1 GB for the studio and founder chunks plus
 * the KTX2 mip chains and half-float lightmaps). Nothing reads those copies after load:
 * collision, stair surfaces and lighting probes copy what they need at creation.
 *
 * This releases only data whose GPU upload is confirmed by the renderer's own
 * bookkeeping, keeps element counts (draw ranges come from `count`, not the array),
 * keeps bounds for frustum culling, and never touches objects that are raycast or
 * animated (`retain`). Rendering is unchanged; only JavaScript heap is returned.
 */

type Internals = {
  _attributes?: { get(attribute: object): { version?: number }; update(attribute: object, type: number): void };
  _textures?: { get(texture: Texture): { initialized?: boolean; version?: number } };
};

const VERTEX = 1, INDEX = 2;
const empty = (array: ArrayLike<number>) => new (array.constructor as new (length: number) => ArrayLike<number>)(0);

export function releaseUploadedData(renderer: WebGPURenderer, scene: Object3D, textures: Iterable<Texture>, retain: Object3D[], minimumVertices = 20000) {
  const internals = renderer as unknown as Internals;
  const attributes = internals._attributes, textureData = internals._textures;
  if (!attributes || !textureData) return { geometries: 0, attributes: 0, textures: 0, bytes: 0 };

  // Attributes shared with anything that must stay readable are never released.
  const keep = new Set<object>();
  const keepGeometry = (geometry: BufferGeometry) => {
    for (const attribute of Object.values(geometry.attributes)) keep.add(storage(attribute));
    if (geometry.index) keep.add(geometry.index);
  };
  for (const root of retain) root.traverse(object => { const mesh = object as Mesh; if (mesh.isMesh) keepGeometry(mesh.geometry); });
  scene.traverse(object => { const mesh = object as Mesh; if (mesh.isMesh && ((mesh as { isSkinnedMesh?: boolean }).isSkinnedMesh || mesh.userData.mdPlanarMirror)) keepGeometry(mesh.geometry); });

  let geometries = 0, released = 0, bytes = 0;
  const seen = new Set<BufferGeometry>();
  scene.traverse(object => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || seen.has(mesh.geometry)) return;
    const geometry = mesh.geometry; seen.add(geometry);
    const position = geometry.attributes.position;
    if (!position || position.count < minimumVertices) return;
    // Frustum culling needs bounds; compute them while the positions still exist.
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    let any = false;
    const release = (attribute: BufferAttribute | InterleavedBufferAttribute, type: number) => {
      const buffer = storage(attribute);
      if (keep.has(buffer) || buffer.array.length === 0) return;
      attributes.update(attribute, type);                         // no-op if already uploaded
      if (attributes.get(attribute).version === undefined) return; // upload not confirmed
      bytes += (buffer.array as unknown as { byteLength: number }).byteLength;
      buffer.array = empty(buffer.array) as typeof buffer.array;  // `count` is a stored field and stays
      released++; any = true;
    };
    for (const attribute of Object.values(geometry.attributes)) release(attribute, VERTEX);
    if (geometry.index) release(geometry.index, INDEX);
    if (any) geometries++;
  });

  // Texture CPU copies: KTX2 mip chains and EXR/LUT typed arrays. A shared source is
  // released only when every texture using it is uploaded or never uploads (views).
  // Clones (UV-channel views) share the mip objects / image record, so those are the key.
  const holders = new Map<object, Texture[]>();
  for (const texture of textures) {
    const flags = texture as Texture & { isDataTexture?: boolean; isData3DTexture?: boolean; isCompressedTexture?: boolean };
    const key = flags.isCompressedTexture ? texture.mipmaps?.[0] : flags.isDataTexture || flags.isData3DTexture ? texture.image : undefined;
    if (!key) continue;
    const list = holders.get(key) ?? [];
    list.push(texture); holders.set(key, list);
  }
  let releasedTextures = 0;
  for (const users of holders.values()) {
    const ready = users.every(texture => texture.userData.mdSkipUpload === true || (textureData.get(texture).initialized === true && textureData.get(texture).version === texture.version));
    if (!ready || !users.some(texture => textureData.get(texture).initialized === true)) continue;
    for (const texture of users) {
      if ((texture as Texture & { isCompressedTexture?: boolean }).isCompressedTexture) {
        for (const mip of texture.mipmaps as { data?: ArrayBufferView }[]) {
          if (mip.data && mip.data.byteLength) { bytes += mip.data.byteLength; mip.data = new Uint8Array(0); }
        }
      } else {
        const image = texture.image as { data?: ArrayBufferView | null };
        if (image.data && image.data.byteLength) { bytes += image.data.byteLength; image.data = new (image.data.constructor as new (n: number) => ArrayBufferView)(0); }
      }
    }
    releasedTextures++;
  }
  return { geometries, attributes: released, textures: releasedTextures, bytes };
}

function storage(attribute: BufferAttribute | InterleavedBufferAttribute) {
  return (attribute as InterleavedBufferAttribute).isInterleavedBufferAttribute ? (attribute as InterleavedBufferAttribute).data : attribute as BufferAttribute;
}
