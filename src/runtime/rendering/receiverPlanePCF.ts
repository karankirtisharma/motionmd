import type { DepthTexture, DirectionalLightShadow } from 'three';
import type Node from 'three/src/nodes/core/Node.js';
import { Fn, float, glslFn, interleavedGradientNoise, reference, screenCoordinate, texture, vec2, vogelDiskSample, wgslFn } from 'three/tsl';

const planeGL = glslFn(`vec2 mdReceiverSlope(vec3 p) {
  vec3 dx=dFdx(p), dy=dFdy(p);
  float det=dx.x*dy.y-dx.y*dy.x;
  if(abs(det)<1e-12) return vec2(0.0);
  return vec2(dy.y*dx.z-dx.y*dy.z,dx.x*dy.z-dy.x*dx.z)/det;
}`);
const planeGPU = wgslFn(`fn mdReceiverSlope(p:vec3<f32>)->vec2<f32> {
  let dx=dpdx(p); let dy=dpdy(p);
  let det=dx.x*dy.y-dx.y*dy.x;
  if(abs(det)<1e-12){return vec2<f32>(0.0);}
  return vec2<f32>(dy.y*dx.z-dx.y*dy.z,dx.x*dy.z-dy.x*dx.z)/det;
}`);

type Inputs = { depthTexture: DepthTexture; shadowCoord: Node<'vec3'>; shadow: DirectionalLightShadow };

/** r186's original five-tap Vogel PCF, with each tap compared against the
 * receiver plane at that tap. A single centre depth falsely shadows sloped
 * surfaces (the studio desktops at sunset). Keep resolution, radius, pattern
 * and hardware filtering; do not hide acne by disabling shadows/materials.
 * This hook is installed only on our 2D directional sun shadow.
 */
export function receiverPlanePCF({depthTexture, shadowCoord, shadow}: Inputs) {
  return Fn(builder => {
    const slope = ('isWebGLBackend' in builder.renderer.backend ? planeGL : planeGPU)(shadowCoord) as Node<'vec2'>;
    const mapSize = reference('mapSize','vec2',shadow);
    const radius = reference('radius','float',shadow);
    const texel = vec2(1).div(mapSize);
    // Hardware comparison filtering blends four neighboring texels. Cover
    // that remaining one-texel footprint, independent of the PCF disk radius.
    const footprint = slope.abs().dot(texel).min(.002);
    const compareBase = shadowCoord.z.add(footprint.mul(builder.renderer.reversedDepthBuffer ? 1 : -1));
    const phi = interleavedGradientNoise(screenCoordinate.xy).mul(6.28318530718);
    const result = float(0).toVar();
    for (let i=0;i<5;i++) {
      const offset = vogelDiskSample(float(i),float(5),phi).mul(radius).mul(texel.x);
      result.addAssign(texture(depthTexture,shadowCoord.xy.add(offset)).compare(compareBase.add(slope.dot(offset))));
    }
    return result.mul(1/5);
  })();
}
