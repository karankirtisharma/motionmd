import { Matrix3, Mesh, Vector3, type Object3D } from 'three';

const TOP = -.01;
const TERRACE_X = -2.3399980068206787;
const STAIR_X = -5.799997091293335;
const STUDIO_Z = -24.99;
const FRONT_Z = -24.09999990463257;

/** Fit the buried slab edges after exterior lightmap receivers have been extracted.
 * Keep their UVs and the bevels facing the sand. Dimensions are from the shipped meshes. */
export function closeEntryStairJoint(root: Object3D) {
  root.updateMatrixWorld(true);
  const p = new Vector3();
  let moved = 0;
  root.traverse(object => {
    if (!(object instanceof Mesh) || object.geometry.userData.mdEntryStairJoint) return;
    const name = object.name.replace(/^Exterior baked \| /, '');
    const shell = name === 'Box_Complete_foundation001_1';
    const apron = name === 'Box_Entrance-side_upper_bridge002';
    const plinth = name === 'Box_Complete_foundation001';
    if (!shell && !apron && !plinth) return;
    const g = object.geometry, positions = g.getAttribute('position'), normals = g.getAttribute('normal');
    const lightUV = apron ? g.getAttribute('uv1') : undefined;
    const inverse = object.matrixWorld.clone().invert();
    const up = new Vector3(0, 1, 0).applyMatrix3(new Matrix3().getNormalMatrix(inverse)).normalize();
    let changed = 0;
    for (let i = 0; i < positions.count; i++) {
      p.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
      if (p.y < -.351 || p.y > TOP + .00001) continue;
      if (plinth) {
        // Double-sided planter bases sit on the terrace top: bury just their bottom ring 4 mm.
        if (Math.abs(p.y - TOP) > .00001 || p.x < -5.2 || p.x > -4.5 || p.z < -15 || p.z > -13) continue;
        p.y -= .004;
      } else {
        // The main stair meets the sharp terrace across its entire 4.2 m width, including both corners.
        if (shell && p.x >= -5.8091 && p.x <= -5.7998 && p.z >= -19.2001 && p.z <= -14.9999) {
          if (p.x > -5.80899) p.x = STAIR_X;
          if (p.z < -19.1909) p.z = -19.2;
          if (p.z > -15.0091) p.z = -15;
        } else if (shell && p.x >= -3.504 && p.x <= .0001 && p.z >= -25.0021 && p.z <= -24.0999) {
          // Two facing 12 mm bevels at z=-24.99 cut a groove from the glass to the rocks.
          // The short return also needs square ends against the front terrace and gallery apron.
          if (p.z < -24.9778) p.z = STUDIO_Z;
          else if (p.z > -24.1121) p.z = FRONT_Z;
          else if (p.x < -2.3051 || p.x > -2.2929) continue;
          if (p.x >= -2.3051 && p.x <= -2.2929) p.x = TERRACE_X;
        } else if (apron && p.x >= -2.2901 && p.x <= .0001 && p.z >= -25.0501 && p.z <= -23.3498) {
          // The gallery apron overlaps the studio slab by 60 mm and stops 50 mm
          // short of the entrance terrace. Meet both at their measured edges.
          // Only the large top island sampled the old overlap as black in the gallery bake.
          // Two atlas rows are dark. Keep the existing UV gradient (0.049759 / 1.69 m)
          // when trimming its buried 55 mm, leaving the stone UV and all other islands intact.
          if (lightUV && Math.abs(p.y - TOP) < .00001 && Math.abs(p.z + 25.045) < .00001
            && Math.abs(lightUV.getY(i) - .581319) < .00001) {
            lightUV.setY(i, lightUV.getY(i) + (STUDIO_Z - p.z) * (.049759 / 1.69));
          }
          if (p.x < -2.2849) p.x = TERRACE_X;
          else if (p.z > -25.0449) continue;
          if (p.z < -25.0449) p.z = STUDIO_Z;
        } else continue;
        if (p.y >= -.0221) {
          p.y = TOP;
          normals?.setXYZ(i, up.x, up.y, up.z);
        }
      }
      p.applyMatrix4(inverse);
      positions.setXYZ(i, p.x, p.y, p.z);
      changed++;
    }
    if (!changed) return;
    positions.needsUpdate = true;
    if (lightUV) lightUV.needsUpdate = true;
    if (normals) normals.needsUpdate = true;
    g.computeBoundingBox(); g.computeBoundingSphere();
    g.userData.mdEntryStairJoint = true;
    moved += changed;
  });
  return moved;
}
