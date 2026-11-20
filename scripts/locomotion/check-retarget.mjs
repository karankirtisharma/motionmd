// Check step 1 on the flat clips: bone directions match the source, planted feet stay put on the ground.
//   node scripts/locomotion/check-retarget.mjs
import * as THREE from 'three';
import { geometryFixture } from '../../qa/helpers/geometry-fixture.mjs';
import { loadSource, prepareTarget, poseAt, directionError } from './retarget.mjs';
const SRC = 'D:/MD Website Perf Audit/anim-src/';
for (const name of ['Walking', 'Running', 'Ascending Stairs', 'Running Up Stairs']) {
  const source = loadSource(SRC + name + '.fbx');
  const visitor = (await geometryFixture('/assets/character/RocketboxVisitor.glb')).gltf.scene;
  const prep = prepareTarget(visitor, source);
  const mixer = new THREE.AnimationMixer(source.root), action = mixer.clipAction(source.clip).play();
  const duration = source.clip.duration;
  // Root motion: the source hips' straight-line travel over the cycle.
  action.time = 0; mixer.update(0); source.root.updateMatrixWorld(true);
  const start = source.bones.get('Hips').getWorldPosition(new THREE.Vector3());
  action.time = duration; mixer.update(0); source.root.updateMatrixWorld(true);
  const end = source.bones.get('Hips').getWorldPosition(new THREE.Vector3()), total = end.clone().sub(start);
  const travel = time => total.clone().multiplyScalar(time / duration);
  const feet = ['L', 'R'].map(s => [prep.bones.get(`Bip01_${s}_Foot`), prep.bones.get(`Bip01_${s}_Toe0`)]);
  const HZ = 240, frames = Math.round(duration * HZ), rows = [];
  let worstDir = { worst: 0 };
  for (let i = 0; i <= frames; i++) {
    const time = i / frames * duration;
    poseAt(source, mixer, action, prep, time, travel);
    visitor.updateMatrixWorld(true);
    const d = directionError(source, prep); if (d.worst > worstDir.worst) worstDir = { ...d, time };
    // Ground frame: the root advances by the scaled travel; add it back to get positions over the ground.
    const advance = travel(time).multiplyScalar(prep.scale);
    rows.push(feet.map(([foot, toe]) => [foot.getWorldPosition(new THREE.Vector3()).add(advance), toe.getWorldPosition(new THREE.Vector3()).add(advance)]));
  }
  // Planted = the lower of heel/toe moves < 0.25 m/s over the ground; measure its slide and height in those spans.
  const report = [];
  for (let s = 0; s < 2; s++) {
    let span = [];
    const flush = () => {
      if (span.length >= .06 * HZ) {
        const pick = row => row[s][0].y < row[s][1].y ? row[s][0] : row[s][1];
        const a = pick(span[0]), b = pick(span.at(-1));
        const minY = Math.min(...span.map(r => Math.min(r[s][0].y, r[s][1].y)));
        report.push(`${'LR'[s]} planted ${(span.length / HZ).toFixed(2)} s slide ${(Math.hypot(b.x - a.x, b.z - a.z) * 100).toFixed(1)} cm lowest ${(minY * 100).toFixed(1)} cm`);
      }
      span = [];
    };
    for (let i = 1; i < rows.length; i++) {
      const v = Math.min(rows[i][s][0].distanceTo(rows[i - 1][s][0]), rows[i][s][1].distanceTo(rows[i - 1][s][1])) * HZ / (duration * HZ / frames);
      if (v < .25) span.push(rows[i]); else flush();
    }
    flush();
  }
  console.log(`\n${name}: leg scale ${prep.scale.toFixed(3)}, cycle ${duration.toFixed(3)} s, travel ${(total.z * prep.scale).toFixed(3)} m fwd ${(total.y * prep.scale).toFixed(3)} m up => ${(total.z * prep.scale / duration).toFixed(2)} m/s`);
  console.log(`  worst bone direction error ${worstDir.worst.toFixed(2)} deg (${worstDir.name} at ${worstDir.time?.toFixed(2)} s)`);
  console.log('  ' + report.join('\n  '));
}
