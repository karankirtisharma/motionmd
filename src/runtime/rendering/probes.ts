import { Box3, Texture, Vector3 } from 'three';
import type Node from 'three/src/nodes/core/Node.js';
import { Fn, If, float, max, min, mix, pmremTexture, positionWorld, smoothstep, uniform, vec3 } from 'three/tsl';

export type RoomProbe = { id: string; region: Box3; position: Vector3; texture: Texture; intensity: number };

/** Finite-volume parallax correction. Room geometry is approximated by the exported box. */
export function roomEnvironment(global: Texture, globalIntensity: number, probes: RoomProbe[]) {
  const volumes = [...probes].sort((a, b) => b.region.getSize(new Vector3()).lengthSq() - a.region.getSize(new Vector3()).lengthSq()).map(probe => ({
    ...probe, minimum: uniform(probe.region.min), maximum: uniform(probe.region.max), capture: uniform(probe.position),
  }));
  return Fn(builder => {
    const context = builder.context as { getUV: () => Node<'vec3'>; getTextureLevel: () => Node<'float'> };
    const direction = context.getUV();
    const roughness = context.getTextureLevel();
    const result = pmremTexture(global, direction, roughness).mul(globalIntensity).toVar();
    for (const probe of volumes) {
      // Influence extends slightly beyond the box so a floor/wall on its boundary still
      // receives the capture. The original box remains the reflection intersection volume.
      const minimumDistance = positionWorld.sub(probe.minimum.sub(0.4));
      const maximumDistance = probe.maximum.add(0.4).sub(positionWorld);
      const inside = minimumDistance.greaterThanEqual(vec3(0)).all().and(maximumDistance.greaterThanEqual(vec3(0)).all());
      If(inside, () => {
        const signs = vec3(direction.x.greaterThanEqual(0).select(1, -1), direction.y.greaterThanEqual(0).select(1, -1), direction.z.greaterThanEqual(0).select(1, -1));
        const safeDirection = signs.mul(max(direction.abs(), vec3(0.00001)));
        const origin = positionWorld.clamp(probe.minimum.add(0.001), probe.maximum.sub(0.001));
        const first = probe.maximum.sub(origin).div(safeDirection);
        const second = probe.minimum.sub(origin).div(safeDirection);
        const intersection = max(first, second);
        const distance = min(intersection.x, min(intersection.y, intersection.z));
        const corrected = origin.add(direction.mul(distance)).sub(probe.capture).normalize();
        // The diffuse IBL lookup uses the highest roughness. Keep its cosine lobe directional,
        // while sharp and moderately rough reflected rays use the finite room intersection.
        const lookup = mix(corrected, direction, smoothstep(0.8, 1, roughness));
        const sample = pmremTexture(probe.texture, lookup, roughness).mul(probe.intensity);
        const edge = min(minimumDistance, maximumDistance);
        const nearestEdge = min(edge.x, min(edge.y, edge.z));
        const weight = smoothstep(float(0), float(0.35), nearestEdge);
        result.assign(mix(result, sample, weight));
      });
    }
    return result;
  })();
}
