import {
  DataTexture, NoBlending, LinearFilter, MeshBasicMaterial, SRGBColorSpace, type Camera, type Mesh,
} from 'three';
import preview from '../../generated/presentation-wood-preview.json' with { type: 'json' };

/** The Studio plate cropped exactly as Stage paints its 1600 by 558 viewport.
 * Decoding this tiny palette inline gives the very first GPU frame wood without
 * a second image request, an async preload race, or the GLB's old globe. */
function createWoodPreview() {
  const palette = atob(preview.palette), indices = atob(preview.indices);
  const rgba = new Uint8Array(indices.length * 4);
  for (let i = 0; i < indices.length; i++) {
    const color = indices.charCodeAt(i) * 3;
    rgba[i * 4] = palette.charCodeAt(color);
    rgba[i * 4 + 1] = palette.charCodeAt(color + 1);
    rgba[i * 4 + 2] = palette.charCodeAt(color + 2);
    rgba[i * 4 + 3] = 255;
  }
  const texture = new DataTexture(rgba, preview.width, preview.height);
  texture.name = 'Presentation display | Studio wood preview';
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** An opaque wood surface while loading, and a depth-tested DOM aperture only
 * for the main camera after the native iframe is ready. Reflection cameras
 * cannot sample a browser window, so they retain the fitted wood surface. */
export function createScreenAperture(mesh: Mesh, mainCamera: Camera) {
  const original = mesh.material, before = mesh.onBeforeRender;
  const wood = createWoodPreview();
  const material = new MeshBasicMaterial({
    map: wood, color: 0xffffff, toneMapped: false, fog: false,
    transparent: true, blending: NoBlending, depthTest: true, depthWrite: true,
  });
  material.name = 'Presentation display | native Studio aperture';
  mesh.material = material;
  let live = false, dirty = true, disposed = false;
  mesh.onBeforeRender = function(renderer, scene, camera, geometry, renderedMaterial, group) {
    before.call(this, renderer, scene, camera, geometry, renderedMaterial, group);
    const open = live && camera === mainCamera;
    // Transparent black clears both RGB and alpha in the existing temporal
    // pipeline. The display still writes depth, so a chair/person in front wins.
    material.opacity = open ? 0 : 1;
    material.color.setScalar(open ? 0 : 1);
  };
  return {
    setLive(next: boolean) {
      if (!disposed && live !== next) { live = next; dirty = true; }
    },
    takeDirty() { const value = dirty; dirty = false; return value; },
    dispose() {
      if (disposed) return;
      disposed = true; dirty = false;
      mesh.material = original; mesh.onBeforeRender = before;
      wood.dispose(); material.map = null; material.dispose();
    },
  };
}