import type { Texture } from 'three';
import { Fn, attribute, cameraViewMatrix, float, frontFacing, glslFn, modelNormalMatrix, modelWorldMatrix, texture, uniform, uv, vec2, wgslFn } from 'three/tsl';

// Keep all transform/derivative intermediates native. Sharing normalViewGeometry
// through a custom NORMAL sub-build can alias a matrix-valued TSL temporary in r186.
// These inputs are the evaluated static Blender architecture, with no skinning.
const glslSourceNormal = glslFn(`
vec3 mdSourceNormal(vec3 localPosition, vec3 localNormal, mat4 modelMatrix, mat3 normalMatrix, mat4 viewMatrix, vec2 sourceUV, mat3 uvMatrix, vec3 normalTexel, vec2 strength, float sideMode, bool frontFace, float flatShading) {
  vec3 viewPosition = (viewMatrix * modelMatrix * vec4(localPosition, 1.0)).xyz;
  vec3 surfaceNormal = normalize((viewMatrix * vec4(normalMatrix * localNormal, 0.0)).xyz);
  vec3 dx = dFdx(viewPosition);
  vec3 dy = dFdy(viewPosition);
  if (flatShading > 0.5) surfaceNormal = normalize(cross(dx, dy));
  else if ((sideMode > 0.5 && sideMode < 1.5) || (sideMode > 1.5 && !frontFace)) surfaceNormal = -surfaceNormal;
  vec2 coords = (uvMatrix * vec3(sourceUV, 1.0)).xy;
  vec2 sx = dFdx(coords);
  vec2 sy = dFdy(coords);
  vec3 dyPerp = cross(dy, surfaceNormal);
  vec3 dxPerp = cross(surfaceNormal, dx);
  vec3 tangent = dyPerp * sx.x + dxPerp * sy.x;
  vec3 bitangent = dyPerp * sx.y + dxPerp * sy.y;
  float inverseLength = inversesqrt(max(max(dot(tangent, tangent), dot(bitangent, bitangent)), 1e-12));
  vec3 mapped = normalTexel * 2.0 - 1.0;
  mapped.xy *= strength;
  return normalize(mat3(tangent * inverseLength, bitangent * inverseLength, surfaceNormal) * mapped);
}
`);

const wgslSourceNormal = wgslFn(`
fn mdSourceNormal(localPosition: vec3<f32>, localNormal: vec3<f32>, modelMatrix: mat4x4<f32>, normalMatrix: mat3x3<f32>, viewMatrix: mat4x4<f32>, sourceUV: vec2<f32>, uvMatrix: mat3x3<f32>, normalTexel: vec3<f32>, strength: vec2<f32>, sideMode: f32, frontFace: bool, flatShading: f32) -> vec3<f32> {
  let viewPosition = (viewMatrix * modelMatrix * vec4<f32>(localPosition, 1.0)).xyz;
  var surfaceNormal = normalize((viewMatrix * vec4<f32>(normalMatrix * localNormal, 0.0)).xyz);
  let dx = dpdx(viewPosition);
  let dy = dpdy(viewPosition);
  if (flatShading > 0.5) { surfaceNormal = normalize(cross(dx, dy)); }
  else if ((sideMode > 0.5 && sideMode < 1.5) || (sideMode > 1.5 && !frontFace)) { surfaceNormal = -surfaceNormal; }
  let coords = (uvMatrix * vec3<f32>(sourceUV, 1.0)).xy;
  let sx = dpdx(coords);
  let sy = dpdy(coords);
  let dyPerp = cross(dy, surfaceNormal);
  let dxPerp = cross(surfaceNormal, dx);
  let tangent = dyPerp * sx.x + dxPerp * sy.x;
  let bitangent = dyPerp * sx.y + dxPerp * sy.y;
  let inverseLength = inverseSqrt(max(max(dot(tangent, tangent), dot(bitangent, bitangent)), 1e-12));
  let sampled = normalTexel * 2.0 - 1.0;
  let mapped = vec3<f32>(sampled.xy * strength, sampled.z);
  return normalize(mat3x3<f32>(tangent * inverseLength, bitangent * inverseLength, surfaceNormal) * mapped);
}
`);

/** Use the matching source UV and normal frame for static architectural materials. */
export function sourceUVNormal(map: Texture, channel: number, scale: [number, number]) {
  if (map.matrixAutoUpdate) map.updateMatrix();
  return Fn(builder => {
    const implementation = 'isWebGLBackend' in builder.renderer.backend ? glslSourceNormal : wgslSourceNormal;
    const sampler = texture(map, uv(channel)); sampler.updateMatrix = true;
    const flat = 'flatShading' in builder.material && builder.material.flatShading === true;
    return implementation(attribute('position', 'vec3'), attribute('normal', 'vec3'), modelWorldMatrix, modelNormalMatrix, cameraViewMatrix, uv(channel), uniform(map.matrix), sampler.rgb, vec2(...scale), float(builder.material.side), frontFacing, float(flat ? 1 : 0));
  })();
}
