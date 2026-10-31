import { Matrix4, Object3D, Vector4 } from 'three';

/** A mirror is not temporal: unchanged reflected content can be reused while the
 * main TRAA pass accumulates samples. Revision must change for every scene edit. */
export class ReflectionFrameCache {
  private revision?: number;
  private scene?: Object3D;
  private world = new Matrix4();
  private projection = new Matrix4();
  private crop = new Vector4();
  private width = 0;
  private height = 0;
  matches(scene: Object3D, revision: number | undefined, world: Matrix4, projection: Matrix4, crop: Vector4, width: number, height: number) {
    return revision !== undefined && this.revision === revision && this.scene === scene &&
      this.width === width && this.height === height && this.world.equals(world) &&
      this.projection.equals(projection) && this.crop.equals(crop);
  }
  record(scene: Object3D, revision: number | undefined, world: Matrix4, projection: Matrix4, crop: Vector4, width: number, height: number) {
    this.scene = scene; this.revision = revision;
    this.world.copy(world); this.projection.copy(projection); this.crop.copy(crop);
    this.width = width; this.height = height;
  }
  invalidate() { this.revision = undefined; this.scene = undefined; }
}
