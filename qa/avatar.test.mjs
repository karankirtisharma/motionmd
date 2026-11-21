import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Execute the shipped TypeScript without a build, a browser or temporary files.
// Resolving Three to an ESM file URL preserves the same Three instance as the loader.
const dataModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const transpile = (relativePath) => ts.transpileModule(fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const movementURL = dataModule(transpile('../src/runtime/interaction/movement.ts'));
const flightsURL = dataModule(transpile('../src/runtime/interaction/stairFlights.ts'));
const locomotionURL = dataModule(transpile('../src/runtime/interaction/locomotionClips.ts')
  .replace("from 'three'", `from ${JSON.stringify(import.meta.resolve('three'))}`)
  .replace("from './stairFlights'", `from ${JSON.stringify(flightsURL)}`));
const avatarSource = transpile('../src/runtime/interaction/RocketboxAvatar.ts')
  .replace("from 'three'", `from ${JSON.stringify(import.meta.resolve('three'))}`)
  .replace("from './movement'", `from ${JSON.stringify(movementURL)}`)
  .replace("from './locomotionClips'", `from ${JSON.stringify(locomotionURL)}`);
const { createRocketboxAvatar } = await import(dataModule(avatarSource));
const { locomotionHeading, easedTurnRate, turnSpeedFactor } = await import(movementURL);

// Geometry, skinning and all animation buffers remain intact. Texture decoding
// needs browser APIs and is unrelated to this numerical pose check.
const bytes = fs.readFileSync(new URL('../public/assets/character/RocketboxVisitor.glb', import.meta.url));
const oldLength = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.subarray(20, 20 + oldLength));
delete json.images; delete json.textures; delete json.samplers;
json.materials = json.materials.map((material) => ({ name: material.name }));
let encoded = Buffer.from(JSON.stringify(json));
encoded = Buffer.concat([encoded, Buffer.alloc((4 - encoded.length % 4) % 4, 32)]);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(20 + encoded.length + bytes.length - 20 - oldLength, 8);
header.writeUInt32LE(encoded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
const blob = Buffer.concat([header, encoded, bytes.subarray(20 + oldLength)]);
const load = () => new GLTFLoader().parseAsync(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.length), '');
const seatHeightAboveFloor = 0.56655; // Source cushion top .59155 m minus source chair floor .025 m.

test('walk/run transition shares one foot phase and settles into idle after stopping', async context => {
  const avatar = createRocketboxAvatar(await load());
  try {
    let minWeight = 1, maxWeight = 0, maxLean = 0;
    for (let frame = 0; frame < 600; frame++) {
      const speed = frame < 120 ? 1.38 : frame < 300 ? 3.35 : frame < 420 ? 1.38 : 0;
      if (frame > 180 && frame < 240) avatar.root.rotation.y += .04;
      avatar.update(1 / 60, speed, 0);
      const state = avatar.locomotion;
      const total = Object.values(state.weights).reduce((a, b) => a + b, 0);
      minWeight = Math.min(minWeight, total); maxWeight = Math.max(maxWeight, total);
      maxLean = Math.max(maxLean, Math.abs(state.forwardLean), Math.abs(state.sideLean));
      assert.ok(state.phase >= 0 && state.phase < 1);
      assert.ok(Math.abs(total - 1) < 1e-6, 'pose weights must remain normalized');
    }
    const stopped = avatar.locomotion;
    assert.ok(stopped.speed < .001 && stopped.weights.idle > .999, 'stop settles instead of walking in place');
    assert.ok(Math.abs(stopped.sideLean) < .001 && Math.abs(stopped.forwardLean) < .001, 'idle has no leftover bank');
    assert.ok(maxLean > .02 && maxLean <= .071, 'restrained visible weight transfer');
    const phase = stopped.phase;
    for (let i = 0; i < 60; i++) avatar.update(1 / 60, 0, 0);
    assert.ok(Math.abs(avatar.locomotion.phase - phase) < .001, 'resting gait is frozen');
    context.diagnostic(JSON.stringify({minWeight, maxWeight, maximumLeanDegrees:maxLean*180/Math.PI}));
  } finally { avatar.dispose(); }
});

test('a reversal has bounded body turning and minor contact corrections preserve full speed', () => {
  for (const hz of [60, 90, 144, 165]) {
    let angle = 0;
    for (let i = 0; i < hz; i++) {
      const next = locomotionHeading(angle, Math.PI, 3.35, 1/hz);
      assert.ok(Math.abs(next - angle) <= 4.6/hz + 1e-8);
      angle = next;
    }
    assert.ok(Math.abs(angle - Math.PI) < .03, 'reversal remains responsive');
  }
  // The pivot builds up instead of starting at full rate, still settles on the
  // new heading within a second, and never swings past it.
  for (const hz of [60, 144]) {
    let angle = 0, rate = 0, firstTick = 0, peak = 0;
    for (let i = 0; i < hz; i++) {
      rate = easedTurnRate(rate, angle, Math.PI, 1.38, 1/hz);
      if (i === 0) firstTick = rate;
      assert.ok(rate >= -1e-9 && rate <= 6.2 + 1e-9, 'bounded, one direction only');
      angle += rate / hz; peak = Math.max(peak, rate);
      assert.ok(angle <= Math.PI + 1e-9, 'no overshoot');
    }
    assert.ok(firstTick < 6.2 * .35, 'reversal onset is eased');
    assert.ok(peak > 6.1, 'full pivot rate is still reached');
    assert.ok(Math.abs(angle - Math.PI) < .03, 'eased reversal remains responsive');
  }
  // A gentle change of direction is passed through unchanged.
  assert.ok(Math.abs(easedTurnRate(0, 0, .02, 1.38, 1/60) - (locomotionHeading(0, .02, 1.38, 1/60)) * 60) < 1e-9);
  assert.equal(turnSpeedFactor(0, 0.1), 1);
  assert.ok(turnSpeedFactor(0, Math.PI) < .4);
});

function updateSkeletons(root) {
  root.updateMatrixWorld(true);
  root.traverse((object) => { if (object.isSkinnedMesh) object.skeleton.update(); });
}

test('desk contact IK preserves relaxed elbows until the hands start reaching', async () => {
  const avatar=createRocketboxAvatar(await load());
  try {
    avatar.update(0,0,0);avatar.root.updateMatrixWorld(true);
    const get=name=>avatar.root.getObjectByName(name).getWorldPosition(new THREE.Vector3());
    const bend=side=>get(`Bip01_${side}_Forearm`).sub(get(`Bip01_${side}_UpperArm`)).normalize();
    const before=['L','R'].map(bend);
    const feet=['L','R'].map(side=>get(`Bip01_${side}_Foot`).setY(0));
    avatar.update(0,0,0,.44,{feet,hands:[new THREE.Vector3(),new THREE.Vector3()],handWeight:0,footWeight:1,upright:0,deskHeight:.8});
    for(const [i,side] of ['L','R'].entries())assert.ok(before[i].distanceTo(bend(side))<.001,'working elbow pole must not flare the approaching arms');
  } finally {avatar.dispose();}
});

test('desk pose does not inherit the seated gesture loop or its elapsed arrival time', async () => {
  const avatar=createRocketboxAvatar(await load());
  try {
    avatar.root.position.set(15.62,4.265,-5.3);avatar.root.rotation.y=Math.PI/2;
    const contacts={feet:[new THREE.Vector3(15.98,4.265,-5.41),new THREE.Vector3(15.98,4.265,-5.19)],hands:[new THREE.Vector3(16.145,5.1016,-5.49),new THREE.Vector3(16.145,5.1016,-5.11)],handWeight:1,footWeight:1,upright:1,deskHeight:5.058,deskFront:16.125,hipOffset:.125};
    const names=['Bip01_Pelvis','Bip01_Head','Bip01_L_Calf','Bip01_R_Calf','Bip01_L_Forearm','Bip01_R_Forearm'];
    const positions=()=>names.map(name=>avatar.root.getObjectByName(name).getWorldPosition(new THREE.Vector3()));
    avatar.update(1/60,0,1,.4414914,contacts);const reference=positions();
    for(let frame=0;frame<900;frame++) {
      avatar.update(1/60,0,1,.4414914,contacts);
      positions().forEach((p,i)=>assert.ok(p.distanceTo(reference[i])<.00001,`${names[i]} must not be pulled by an unrelated seated gesture`));
    }
  } finally {avatar.dispose();}
});

test('palm heels, distal palms and finger pads contact the actual support surfaces', async context => {
  const avatar = createRocketboxAvatar(await load());
  try {
    avatar.root.position.set(15.62,4.265,-5.3); avatar.root.rotation.y=Math.PI/2;
    const contacts={feet:[new THREE.Vector3(15.98,4.265,-5.41),new THREE.Vector3(15.98,4.265,-5.19)],hands:[new THREE.Vector3(16.145,5.1016,-5.49),new THREE.Vector3(16.145,5.1016,-5.11)],handWeight:0,footWeight:1,upright:1,deskHeight:5.058,deskFront:16.125,hipOffset:.125};
    for (const handWeight of [0,1]) {
      contacts.handWeight=handWeight;
      avatar.update(0,0,1,.4414914,contacts); updateSkeletons(avatar.root);
      const body=avatar.root.getObjectByProperty('isSkinnedMesh',true);
      const indices=body.geometry.attributes.skinIndex,weights=body.geometry.attributes.skinWeight;
      const points=Array.from({length:indices.count},(_,v)=>body.getVertexPosition(v,new THREE.Vector3()).applyMatrix4(body.matrixWorld));
      const weight=(v,pattern)=>{
        let value=0;
        for(let k=0;k<4;k++) if(pattern.test(body.skeleton.bones[indices.getComponent(v,k)].name))value+=weights.getComponent(v,k);
        return value;
      };
      for(const side of ['L','R']) {
        // Ray-test only the deformed trouser triangles: a whole-body ray would
        // hit the hand itself and incorrectly report that floating is contact.
        const thigh=points.map((_,v)=>weight(v,new RegExp(`Bip01_${side}_(Thigh|Calf)`))>.5);
        const triangles=[],index=body.geometry.index;
        for(let n=0;n<index.count;n+=3) {
          const vertices=[index.getX(n),index.getX(n+1),index.getX(n+2)];
          if(vertices.every(v=>thigh[v]))triangles.push(vertices.map(v=>points[v]));
        }
        const wrist=avatar.root.getObjectByName(`Bip01_${side}_Hand`).getWorldPosition(new THREE.Vector3());
        const patches={heel:Infinity,palm:Infinity,fingers:Infinity};
        let minimum=Infinity;
        points.forEach((point,v)=>{
          if(weight(v,new RegExp(`Bip01_${side}_(Hand|Finger)`))<.8)return;
          let surface=handWeight?contacts.deskHeight:-Infinity;
          if(!handWeight) {
            const ray=new THREE.Ray(new THREE.Vector3(point.x,8,point.z),new THREE.Vector3(0,-1,0));
            for(const triangle of triangles) {
              const hit=ray.intersectTriangle(...triangle,false,new THREE.Vector3());
              if(hit)surface=Math.max(surface,hit.y);
            }
          }
          if(!Number.isFinite(surface))return;
          const gap=point.y-surface,forward=point.x-wrist.x;
          minimum=Math.min(minimum,gap);
          if(forward>=0&&forward<.025)patches.heel=Math.min(patches.heel,gap);
          if(forward>=.06&&forward<.09)patches.palm=Math.min(patches.palm,gap);
          if(forward>=.14)patches.fingers=Math.min(patches.fingers,gap);
        });
        assert.ok(minimum>=-.001,`${side}: hand skin penetrates its ${handWeight?'desk':'thigh'} support by ${-minimum}`);
        for(const [patch,gap] of Object.entries(patches))assert.ok(gap<(handWeight?.006:.009),`${side} ${patch} floats ${gap} above its support`);
        context.diagnostic(JSON.stringify({handWeight,side,minimum,patches}));
      }
    }
  } finally {avatar.dispose();}
});

test('desk hands retain palm support and settle without wrist flips at 60 and 144 Hz', async context => {
  for (const hz of [60, 144]) {
    const avatar = createRocketboxAvatar(await load());
    try {
      avatar.root.position.set(15.62,4.265,-5.3); avatar.root.rotation.y=Math.PI/2;
      const contacts={feet:[new THREE.Vector3(15.98,4.265,-5.41),new THREE.Vector3(15.98,4.265,-5.19)],hands:[new THREE.Vector3(16.145,5.1016,-5.49),new THREE.Vector3(16.145,5.1016,-5.11)],handWeight:0,footWeight:1,upright:1,deskHeight:5.058,deskFront:16.125,hipOffset:.125};
      const point=name=>avatar.root.getObjectByName(name).getWorldPosition(new THREE.Vector3());
      const palms=()=>['L','R'].map(side=>{
        const hand=avatar.root.getObjectByName(`Bip01_${side}_Hand`);
        const forward=point(`Bip01_${side}_Finger2`).sub(hand.getWorldPosition(new THREE.Vector3())).normalize();
        const across=point(`Bip01_${side}_Finger1`).sub(point(`Bip01_${side}_Finger4`)).normalize();
        return {point:hand.getWorldPosition(new THREE.Vector3()),q:hand.getWorldQuaternion(new THREE.Quaternion()),normal:forward.cross(across).normalize()};
      });
      let previous,maximumSpeed=0,maximumAngularSpeed=0;
      const smooth=x=>x*x*x*(x*(x*6-15)+10);
      for (const outward of [false,true]) {
        for(let frame=0;frame<=Math.ceil(1.2*hz);frame++) {
          const progress=Math.min(1,frame/(1.2*hz));
          contacts.handWeight=smooth(outward?1-progress:progress);
          avatar.update(1/hz,0,1,.4414914,contacts);
          const current=palms();
          current.forEach((p,i)=>{
            assert.ok(Math.abs(p.normal.y)>.94,'palm bones follow the calibrated skin plane without a wrist flip');
            if(previous) {
              maximumSpeed=Math.max(maximumSpeed,p.point.distanceTo(previous[i].point)*hz);
              maximumAngularSpeed=Math.max(maximumAngularSpeed,p.q.angleTo(previous[i].q)*hz);
            }
            if(contacts.handWeight===1)assert.ok(p.point.distanceTo(contacts.hands[i])<.001,'unchanged wrist targets are reached');
          });
          previous=current;
        }
      }
      assert.ok(maximumSpeed<1.8,'hand motion is bounded through reach and withdrawal');
      assert.ok(maximumAngularSpeed<4,'no abrupt wrist rotation or flip');
      context.diagnostic(JSON.stringify({hz,maximumSpeed,maximumAngularSpeed}));
    } finally {avatar.dispose();}
  }
});

test('walk and run steps match the ground covered, without a held pose at the loop seam', async context => {
  const avatar = createRocketboxAvatar(await load());
  try {
    const bone = name => { let found; avatar.root.traverse(o => { if (o.isBone && o.name.toLowerCase().replace(/[^a-z0-9]/g, '') === name) found = o; }); return found; };
    const toes = [bone('bip01ltoe0'), bone('bip01rtoe0')], ankles = [bone('bip01lfoot'), bone('bip01rfoot')];
    const read = (object, target) => object.getWorldPosition(target);
    for (const speed of [1.38, 3.35]) {
      avatar.resetMotion(); avatar.root.position.set(0, 0, 0); avatar.root.rotation.y = 0;
      const frames = [];
      for (let frame = 0; frame < 540; frame++) {
        avatar.root.position.z += speed / 60; avatar.update(1 / 60, speed, 0); avatar.root.updateMatrixWorld(true);
        if (frame >= 180) frames.push({ root: avatar.root.position.z, toes: toes.map(b => read(b, new THREE.Vector3())), ankles: ankles.map(b => read(b, new THREE.Vector3())) });
      }
      // A held source frame leaves both legs motionless relative to the moving body.
      let held = 0;
      for (let i = 1; i < frames.length; i++) {
        const moved = Math.max(...[0, 1].map(foot => Math.abs((frames[i].ankles[foot].z - frames[i].root) - (frames[i - 1].ankles[foot].z - frames[i - 1].root))));
        if (moved < .0005) held++;
      }
      assert.equal(held, 0, `${speed} m/s: the cycle must not freeze at its loop seam`);
      // While the ball of a shoe rests on the floor it must stay where it landed.
      const slides = [];
      for (const foot of [0, 1]) {
        const floor = Math.min(...frames.map(f => f.toes[foot].y));
        let start;
        frames.forEach((f, i) => {
          const contact = f.toes[foot].y < floor + .006;
          if (contact && start === undefined) start = i;
          if (!contact && start !== undefined) { if (start > 0 && i - 1 > start) slides.push(frames[i - 1].toes[foot].z - frames[start].toes[foot].z); start = undefined; }
        });
      }
      const worst = Math.max(...slides.map(Math.abs));
      assert.ok(slides.length >= 6, 'both shoes complete several contacts');
      assert.ok(worst < .03, `${speed} m/s: a supporting shoe slid ${(worst * 1000).toFixed(1)} mm`);
      context.diagnostic(JSON.stringify({ speed, contacts: slides.length, worstSlideMm: +(worst * 1000).toFixed(1) }));
    }
  } finally { avatar.dispose(); }
});

// A straight test flight along +z: floor, eight treads, landing. The root rides
// the mid-line ramp through the treads (as on the helical stair collider) or
// stands on the tread under it (as on the stone stairs).
const flight = { riser: .16, going: .30, start: 1, treads: 8 };
const treadAt = z => flight.riser * THREE.MathUtils.clamp(Math.ceil((z - flight.start) / flight.going), 0, flight.treads);
// How far a point has gone in through the riser of the tread it is over: a shoe is no deeper inside a tread than that.
const pastRiser = z => z < flight.start || z >= flight.start + flight.treads * flight.going ? Infinity : (z - flight.start) % flight.going;
const rampAt = z => THREE.MathUtils.clamp(flight.riser * ((z - flight.start) / flight.going + .5), 0, flight.riser * flight.treads);
function stairQuery(batched = true, spans = false) {
  const state = { queries: 0 };
  const sample = Object.assign((point, supportY) => { state.queries++; const y = treadAt(point.z); return y > supportY + .45 || y < supportY - .6 ? undefined : y; }, {
    isStair: () => true,
    clearance: () => { throw new Error('leg IK does not use the whole-model lift query'); },
  });
  if (batched) sample.heights = (points, count, minY, maxY, out) => { state.queries++; for (let k = 0; k < count; k++) { const y = treadAt(points[k].z); out[k] = y < minY || y > maxY ? NaN : y; } };
  // The tread under a point and how far it runs along a level direction: what stride scaling reads the going from.
  // Without it (spans = false) the stride stays the clip's own and the gait keeps time with an untouched avatar.
  if (spans) sample.span = (point, dirX, dirZ, minY, maxY, reach, out) => {
    const y = treadAt(point.z), tread = Math.round(y / flight.riser);
    if (y < minY || y > maxY) return false;
    const from = tread === 0 ? -Infinity : flight.start + (tread - 1) * flight.going, to = tread === flight.treads ? Infinity : flight.start + tread * flight.going;
    const a = Math.abs(dirZ) < 1e-6 ? -Infinity : (from - point.z) / dirZ, b = Math.abs(dirZ) < 1e-6 ? Infinity : (to - point.z) / dirZ;
    out[0] = y; out[1] = Math.max(-reach, Math.min(a, b)); out[2] = Math.min(reach, Math.max(a, b));
    return true;
  };
  return { sample, state };
}
function rigOf(avatar) {
  const bones = []; avatar.root.traverse(o => { if (o.isBone) bones.push(o); });
  const named = name => bones.find(b => b.name.toLowerCase().replace(/[^a-z0-9]/g, '') === name);
  const legs = ['l', 'r'].map(side => ({ hip: named(`bip01${side}thigh`), knee: named(`bip01${side}calf`), ankle: named(`bip01${side}foot`) }));
  const shoes = [[], []];
  avatar.root.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const w = mesh.geometry.attributes.skinWeight, j = mesh.geometry.attributes.skinIndex;
    for (let v = 0; v < w.count; v++) {
      let foot = 0, left = 0;
      for (let s = 0; s < 4; s++) { const name = mesh.skeleton.bones[j.getComponent(v, s)].name; if (/foot|toe/i.test(name)) { foot += w.getComponent(v, s); if (/_L_/i.test(name)) left += w.getComponent(v, s); } }
      if (foot > .95) shoes[left > foot / 2 ? 0 : 1].push([mesh, v]);
    }
  });
  return { bones, legs, shoes, pelvis: named('bip01pelvis'), world: o => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld) };
}
const sameLocal = (a, b) => a.position.distanceTo(b.position) < 1e-9
  && Math.max(Math.abs(a.quaternion.x - b.quaternion.x), Math.abs(a.quaternion.y - b.quaternion.y), Math.abs(a.quaternion.z - b.quaternion.z), Math.abs(a.quaternion.w - b.quaternion.w)) < 1e-12;

test('stairs: baked clips keep every shoe on the gallery treads, without pops; nothing changes away from flights', async () => {
  const locomotion = JSON.parse(fs.readFileSync(new URL('../public/assets/character/locomotion-v16.json', import.meta.url)));
  const { locateFlight } = await import(flightsURL);
  const { stairSpeed } = await import(locomotionURL);
  const avatar = createRocketboxAvatar(await load(), locomotion), plain = createRocketboxAvatar(await load(), locomotion);
  try {
    // Away from any flight the stair gate changes nothing.
    const bones = x => { const list = []; x.root.traverse(o => { if (o.isBone) list.push(o); }); return list; };
    const a = bones(avatar), b = bones(plain);
    for (let frame = 0; frame < 60; frame++) {
      for (const x of [avatar, plain]) x.root.position.set(0, 0, -8 + frame * 1.2 / 60);
      avatar.update(1 / 60, 1.2, 0, .55, undefined, { sprint: false, active: true }); plain.update(1 / 60, 1.2, 0);
    }
    for (let i = 0; i < a.length; i++) assert.ok(sameLocal(a[i], b[i]), a[i].name + ': untouched away from flights');
    // Up the gallery steps (17.5 cm risers, 29 cm treads) along a radius of their arcs, at the stair cadence.
    const centre = new THREE.Vector2(-6.489, -19.622), dir = new THREE.Vector2(7.5 - centre.x, -23 - centre.y).normalize().negate();
    const surface = (x, y, z) => { const hit = locateFlight(x, y, z, 4); return hit && hit.line(-.5) + hit.riser * THREE.MathUtils.clamp(Math.floor(hit.u) + 1, 0, hit.treads + 1); };
    const depth = (x, y, z) => { const hit = locateFlight(x, y, z, 4); if (!hit) return 0; const top = k => hit.line(-.5) + hit.riser * THREE.MathUtils.clamp(k, 0, hit.treads + 1); let best = Infinity;
      for (let j = Math.floor(hit.u) - 1; j <= Math.floor(hit.u) + 1; j++) best = Math.min(best, Math.hypot(Math.max(0, j * hit.going - hit.u * hit.going, hit.u * hit.going - (j + 1) * hit.going), Math.max(0, top(j + 1) - y)));
      return best; };
    const shoes = rigOf(avatar).shoes.flat(), v = new THREE.Vector3(), legs = ['L_Thigh', 'R_Thigh', 'L_Calf', 'R_Calf', 'L_Foot', 'R_Foot'].map(n => avatar.root.getObjectByName('Bip01_' + n));
    const previous = legs.map(o => o.getWorldQuaternion(new THREE.Quaternion())), q = new THREE.Quaternion();
    avatar.resetMotion();
    let s = 0, y = 3.675, deepest = 0, pop = 0, onStairs = 0;
    for (let frame = 0; frame < 600 && s < 6; frame++) {
      const x = centre.x - dir.x * (17.4 - s), z = centre.y - dir.y * (17.4 - s), hit = locateFlight(x, y, z);
      const speed = hit ? stairSpeed(hit, false) : 1.2;
      s += speed / 60; y = Math.max(surface(x, y + .3, z) ?? y, y - .02);
      avatar.root.position.set(x, y, z); avatar.root.rotation.y = Math.atan2(dir.x, dir.y);
      avatar.update(1 / 60, speed, 0, .55, undefined, { sprint: false, active: true }); avatar.root.updateMatrixWorld(true);
      onStairs = Math.max(onStairs, avatar.locomotion.stair);
      for (const [mesh, i] of shoes) { mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld); deepest = Math.max(deepest, depth(v.x, v.y, v.z)); }
      if (frame > 30) legs.forEach((o, i) => { o.getWorldQuaternion(q); pop = Math.max(pop, 2 * Math.acos(Math.min(1, Math.abs(q.dot(previous[i])))) * 180 / Math.PI); previous[i].copy(q); });
      else legs.forEach((o, i) => o.getWorldQuaternion(previous[i]));
    }
    assert.equal(onStairs, 1, 'the stair clips take over on the flight');
    // Measured 2.2-2.9 cm: the rounded heel meeting the tread at heel strike (was 10-17 cm before the fixes).
    assert.ok(deepest < .04, `no shoe goes more than 4 cm into a tread (${(deepest * 100).toFixed(1)} cm)`);
    assert.ok(pop < 15, `no leg joint turns more than 15 deg in a 60 Hz frame (${pop.toFixed(1)})`);
    assert.equal(avatar.locomotion.stair, 0, 'released on the landing');
  } finally { avatar.dispose(); plain.dispose(); }
});

test('sit and stand blending plants the feet while the body turns toward a source chair', async (context) => {
  const avatar = createRocketboxAvatar(await load());
  let minimum = Infinity, maximum = -Infinity;
  const point = new THREE.Vector3();
  try {
    for (let frame = 0; frame < 240; frame++) {
      const phase = frame < 60 ? frame / 60 : frame < 120 ? 1 : frame < 180 ? 1 - (frame - 120) / 60 : 0;
      const weight = phase * phase * phase * (phase * (phase * 6 - 15) + 10);
      avatar.root.rotation.y = weight * 2.3;
      avatar.update(1 / 60, 0, weight, seatHeightAboveFloor);
      updateSkeletons(avatar.root);
      avatar.root.traverse((object) => {
        if (object.isMesh) for (let i = 0; i < object.geometry.attributes.position.count; i++) {
          object.getVertexPosition(i, point); point.applyMatrix4(object.matrixWorld);
          assert.ok(Number.isFinite(point.x + point.y + point.z));
          minimum = Math.min(minimum, point.y); maximum = Math.max(maximum, point.y);
        }
      });
    }
    assert.ok(minimum > -0.002, `sit/stand transition stays above floor: ${minimum}`);
    assert.ok(maximum < 1.93, 'sit/stand does not increase avatar height unexpectedly');
    context.diagnostic(JSON.stringify({ frames: 240, minimumVertexY: minimum, maximumVertexY: maximum }));
  } finally { avatar.dispose(); }
});

test('body camera uses source eye calibration and hides only head/hair primitives, from its own camera only', async (context) => {
  const avatar = createRocketboxAvatar(await load());
  const meshes = [];
  avatar.root.traverse((object) => { if (object.isMesh) meshes.push(object); });
  const head = meshes.filter((mesh) => /m005_(head|opacity)/i.test(mesh.material.name));
  const body = meshes.filter((mesh) => /m005_body/i.test(mesh.material.name));
  try {
    assert.equal(head.length, 2); assert.equal(body.length, 1);
    assert.ok(avatar.view.eyeHeight > 1.55 && avatar.view.eyeHeight < 1.83);
    assert.ok(avatar.view.seatedEyeOffset > 0.70 && avatar.view.seatedEyeOffset < 1);
    avatar.setBodyView(true);
    // Hidden from the visitor's camera (layer 0), still drawn by the mirror (reflection-only layer 9).
    const hidden = (mesh) => mesh.visible && !mesh.layers.isEnabled(0) && mesh.layers.isEnabled(9);
    assert.ok(head.every(hidden)); assert.ok(body.every((mesh) => mesh.visible && mesh.layers.isEnabled(0)));
    avatar.update(1 / 60, 1.38, 0, seatHeightAboveFloor);
    assert.ok(head.every(hidden), 'animation must not restore the occluding head');
    avatar.setBodyView(false);
    assert.ok(meshes.every((mesh) => mesh.visible && mesh.layers.isEnabled(0)), 'third person restores the complete original character');
    context.diagnostic(JSON.stringify(avatar.view));
  } finally { avatar.dispose(); }
});
