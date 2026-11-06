import { type PerspectiveCamera, type Vector2 } from 'three';

/** TRAA's top-left view offset moves rasterized pixels in the opposite direction.
 * TextureNode handles backend Y conventions; offsets here use top-left UVs. */
export function nativeScreenSampleOffset(camera: PerspectiveCamera, target: Vector2) {
  const view = camera.view;
  return view?.enabled
    ? target.set(-view.offsetX / view.fullWidth, -view.offsetY / view.fullHeight)
    : target.set(0, 0);
}
