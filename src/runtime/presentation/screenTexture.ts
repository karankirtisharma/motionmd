import {
  CanvasTexture, MeshBasicMaterial, SRGBColorSpace, type Mesh,
} from 'three';

/** Keep the authored display visible until the first complete Studio paint.
 * All views, including reflections, then sample the same opaque curved mesh. */
export function createScreenTexture(meshes: readonly Mesh[]) {
  const originals = meshes.map(mesh => mesh.material);
  const material = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false });
  material.name = 'Presentation display | live Studio';
  let texture: CanvasTexture | undefined;
  let width = 0, height = 0;
  let dirty = false;
  let disposed = false;

  function paint(canvas: HTMLCanvasElement) {
    if (disposed || !canvas.width || !canvas.height) return;
    if (!texture || width !== canvas.width || height !== canvas.height) {
      width = canvas.width;
      height = canvas.height;
      texture?.dispose();
      texture = new CanvasTexture(canvas);
      // The exported glTF uses v=0 on the top edge, just like a DOM pointer.
      texture.flipY = false;
      texture.colorSpace = SRGBColorSpace;
      texture.anisotropy = 4;
      material.map = texture;
      material.needsUpdate = true;
      for (const mesh of meshes) mesh.material = material;
    } else {
      texture.image = canvas;
      texture.needsUpdate = true;
    }
    dirty = true;
  }

  return {
    paint,
    takeDirty() {
      const changed = dirty;
      dirty = false;
      return changed;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      dirty = false;
      for (let i = 0; i < meshes.length; i++) meshes[i].material = originals[i];
      texture?.dispose();
      texture = undefined;
      material.map = null;
      material.dispose();
    },
  };
}
