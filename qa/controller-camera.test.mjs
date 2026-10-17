import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createCollisionWorld } from '../src/runtime/interaction/CollisionWorld.ts';
import { CinematicPath, CINEMATIC_HANDOFF } from '../src/runtime/rendering/cinematic.ts';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json', import.meta.url), 'utf8'));
delete manifest.lift; // This fixture isolates existing avatar/camera tests; lift has its own integration suite.
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const transpile = relative => ts.transpileModule(fs.readFileSync(new URL(relative, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const movementURL = new URL('../src/runtime/interaction/movement.ts', import.meta.url).href;
const rocketboxSource = transpile('../src/runtime/interaction/RocketboxAvatar.ts')
  .replace("from 'three'", `from ${JSON.stringify(import.meta.resolve('three'))}`)
  .replace("from './movement'", `from ${JSON.stringify(movementURL)}`);
const { createRocketboxAvatar } = await import(dataModule(rocketboxSource));

async function load(url, omitImages = false) {
  assert.ok(url.startsWith('/assets/'));
  let bytes = fs.readFileSync(new URL(`../public${url}`, import.meta.url));
  if (omitImages) {
    const length = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + length));
    delete json.images; delete json.textures; delete json.samplers;
    json.materials = json.materials.map(material => ({ name: material.name }));
    let encoded = Buffer.from(JSON.stringify(json));
    encoded = Buffer.concat([encoded, Buffer.alloc((4 - encoded.length % 4) % 4, 32)]);
    const header = Buffer.alloc(20);
    header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
    header.writeUInt32LE(20 + encoded.length + bytes.length - 20 - length, 8);
    header.writeUInt32LE(encoded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
    bytes = Buffer.concat([header, encoded, bytes.subarray(20 + length)]);
  }
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), '');
}

// Replace only asset/browser adapters. All controller state, camera math, actual
// source collision meshes, Rocketbox skin/animation and fixed-step simulation run.
const fixtureKey = '__mdControllerCameraQA';
const controllerSource = transpile('../src/runtime/interaction/InteractionController.ts')
  .replace("from 'three'", `from ${JSON.stringify(import.meta.resolve('three'))}`)
  .replace("from './Workstation'", `from ${JSON.stringify(new URL('../src/runtime/interaction/Workstation.ts', import.meta.url).href)}`)
  .replace("from './movement'", `from ${JSON.stringify(movementURL)}`)
  .replace("from './GlassLift'", `from ${JSON.stringify(new URL('../src/runtime/interaction/GlassLift.ts', import.meta.url).href)}`)
  .replace("from './CollisionWorld'", `from ${JSON.stringify(dataModule(`export const createCollisionWorld=async()=>globalThis.${fixtureKey}.physics;`))}`)
  .replace("from './Avatar'", `from ${JSON.stringify(dataModule(`export const loadAvatar=async()=>globalThis.${fixtureKey}.avatar;`))}`)
  .replace("from '../presentation/PresentationScreen'", `from ${JSON.stringify(dataModule(`export const createPresentationScreen=()=>globalThis.${fixtureKey}.screen;`))}`)
  .replace("from '../rendering/assets'", `from ${JSON.stringify(new URL('../src/runtime/rendering/assets.ts', import.meta.url).href)}`);
const { createInteractionController } = await import(dataModule(controllerSource));

test('founder desk completes collision-aware approach, contact IK, repeated input and stand', async context => {
  const collisionRoot = new THREE.Group();
  for (const url of [manifest.collisions.url,...manifest.collisions.additionalUrls]) collisionRoot.add((await load(url)).scene);
  const scene = new THREE.Scene(); scene.add((await load(manifest.chunks.find(c=>c.id==='founder').url,true)).scene);
  const physics = await createCollisionWorld(scene,undefined,collisionRoot);
  const avatar = createRocketboxAvatar(await load(manifest.character.url,true));
  const prior = {document:globalThis.document,window:globalThis.window,matchMedia:globalThis.matchMedia};
  globalThis.document={pointerLockElement:null,addEventListener(){},removeEventListener(){},exitPointerLock(){}};
  globalThis.window={addEventListener(){},removeEventListener(){}};globalThis.matchMedia=()=>({matches:false});
  globalThis[fixtureKey]={physics,avatar};
  const camera=new THREE.PerspectiveCamera(54,16/9,.1,1800); camera.position.set(12,6,-6);camera.lookAt(16,5.5,-5.3);
  let hint;
  const controller=await createInteractionController({scene,camera,canvas:{addEventListener(){},removeEventListener(){},focus(){},getBoundingClientRect(){return {left:0,top:0,width:1000,height:700};}},manifest:{...manifest,screen:undefined},onPrompt:p=>{hint=p;}});
  const stages=new Set(); let maximumStep=0;
  const lateralMotion=[];
  const chair=scene.getObjectByName('Founder interactive desk chair');
  const fixedChairMatrix=chair.matrixWorld.toArray();
  const handVertices=[];
  avatar.root.traverse(mesh=>{
    if(!mesh.isSkinnedMesh)return;
    const indices=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight;
    const vertices=[];
    for(let v=0;v<indices.count;v++) {
      let weight=0;
      for(let k=0;k<4;k++)if(/Bip01_[LR]_(Hand|Finger)/.test(mesh.skeleton.bones[indices.getComponent(v,k)].name))weight+=weights.getComponent(v,k);
      if(weight>.8)vertices.push(v);
    }
    handVertices.push({mesh,vertices});
  });
  let edgePenetration=0,edgeWorst;
  const checkTransition=()=>{
    assert.deepEqual(chair.matrixWorld.toArray(),fixedChairMatrix,'chair stays fixed throughout sitting and standing');
    avatar.root.updateMatrixWorld(true);
    for(const {mesh,vertices} of handVertices) {
      mesh.skeleton.update();const p=new THREE.Vector3();
      for(const v of vertices) {
        mesh.getVertexPosition(v,p);p.applyMatrix4(mesh.matrixWorld);
        if(p.x>16.126&&p.x<17.275&&p.z>-6.85&&p.z<-3.75&&p.y>5.02&&p.y<5.05799985){if(5.05799985-p.y>edgePenetration)edgeWorst={point:p.toArray(),state:controller.diagnostics.state};edgePenetration=Math.max(edgePenetration,5.05799985-p.y);}
      }
    }
  };
  try {
    controller.enterExplore(undefined,{position:[14.8,4.265,-6.1],yaw:-Math.PI/2});
    for(let i=0;i<120;i++)controller.update(1/60);
    assert.equal(hint?.target,'founder-desk');
    controller.handleInteract();
    for(let i=0;i<1200;i++) {
      const before=controller.player.position.clone(); controller.update(1/60);
      const state=controller.diagnostics.state; stages.add(state.deskStage ?? state.mode);
      maximumStep=Math.max(maximumStep,controller.player.position.distanceTo(before));
      if(state.deskStage==='align') lateralMotion.push({distance:controller.player.position.distanceTo(before), walk:avatar.locomotion.weights.walk});
      checkTransition();
      if(i===120||i===240)controller.handleInteract();
      if(state.mode==='seated')break;
    }
    context.diagnostic(JSON.stringify({stages:[...stages],state:controller.diagnostics.state,maximumStep,hint}));
    assert.equal(controller.diagnostics.state.mode,'seated');
    assert.ok(maximumStep<0.06,'root has no teleportation');
    assert.ok(lateralMotion.length / 60 < 2.5,'the short entry does not become a prolonged shuffle');
    const middleSteps=lateralMotion.slice(Math.floor(lateralMotion.length*.2),Math.floor(lateralMotion.length*.8));
    context.diagnostic(JSON.stringify({lateralFrames:lateralMotion.length,minimumMidStep:Math.min(...middleSteps.map(f=>f.distance)),maximumMidStep:Math.max(...middleSteps.map(f=>f.distance))}));
    assert.ok(middleSteps.every(frame=>frame.distance>.004),'body carries through footfalls without repeatedly stopping');
    assert.ok(middleSteps.some(frame=>frame.walk>.25),'existing upper-body motion remains active during lateral entry');
    for (const stage of ['entry-turn','align','lower','reach','work']) assert.ok(stages.has(stage),stage);
    const hands=[]; avatar.root.traverse(o=>{if(o.isBone&&/Bip01_[LR]_Hand$/.test(o.name))hands.push(o.getWorldPosition(new THREE.Vector3()).toArray());});
    context.diagnostic(JSON.stringify({hands}));
    avatar.root.updateMatrixWorld(true);
    let handMin=Infinity,handMax=-Infinity,seatMin=Infinity,soleMin=Infinity;
    const palms=[Infinity,Infinity],thighSamples=[];
    let seatSample;
    avatar.root.traverse(o=>{
      if(!o.isSkinnedMesh)return;o.skeleton.update();
      const indices=o.geometry.attributes.skinIndex,weights=o.geometry.attributes.skinWeight,p=new THREE.Vector3();
      for(let v=0;v<indices.count;v++) {
        let handWeight=0;for(let k=0;k<4;k++)if(/Bip01_[LR]_(Hand|Finger)/.test(o.skeleton.bones[indices.getComponent(v,k)].name))handWeight+=weights.getComponent(v,k);
        o.getVertexPosition(v,p);p.applyMatrix4(o.matrixWorld);
        let pelvisWeight=0;for(let k=0;k<4;k++)if(/Pelvis|Thigh/.test(o.skeleton.bones[indices.getComponent(v,k)].name))pelvisWeight+=weights.getComponent(v,k);
        if(pelvisWeight>.8&&p.x>controller.player.position.x-.15&&p.x<controller.player.position.x+.1&&Math.abs(p.z+5.3)<.2&&p.y>4.6&&p.y<seatMin){seatMin=p.y;seatSample={p:p.toArray(),mesh:o.name,weights:Array.from({length:4},(_,k)=>[o.skeleton.bones[indices.getComponent(v,k)].name,weights.getComponent(v,k)])};}
        soleMin=Math.min(soleMin,p.y);
        if(handWeight>.8) {o.getVertexPosition(v,p);p.applyMatrix4(o.matrixWorld);if(p.x>16.125){handMin=Math.min(handMin,p.y);handMax=Math.max(handMax,p.y);}}
        for(let k=0;k<4;k++) {const name=o.skeleton.bones[indices.getComponent(v,k)].name;if(/Bip01_[LR]_Hand$/.test(name)&&weights.getComponent(v,k)>.8)palms[name.includes('_L_')?0:1]=Math.min(palms[name.includes('_L_')?0:1],p.y);}
        if(p.x>15.55&&p.x<16.02&&Math.abs(p.z+5.3)<.21&&p.y>4.57&&p.y<4.95)thighSamples.push(p.clone());
      }
    });
    context.diagnostic(JSON.stringify({handMin,handMax,palms,seatMin,seatSample,soleMin,deskTop:5.05799985}));
    const leather=[];scene.traverse(o=>{if(o.isMesh&&/FC91.*fine ivory leather/.test(o.material.name))leather.push(o);});
    const surface=new THREE.Raycaster(new THREE.Vector3(seatSample.p[0],5,seatSample.p[2]),new THREE.Vector3(0,-1,0)).intersectObjects(leather,false).map(hit=>hit.point.toArray());
    context.diagnostic(JSON.stringify({cushionSurface:surface}));
    assert.ok(surface.length>0,'the pelvis is supported by the actual cushion geometry');
    assert.ok(Math.abs(seatMin-surface[0][1])<.004,'hips contact the cushion');
    let penetration=0,worst;
    for(const p of thighSamples){const hit=new THREE.Raycaster(new THREE.Vector3(p.x,5.06,p.z),new THREE.Vector3(0,-1,0)).intersectObjects(leather,false)[0];if(hit&&hit.point.y-p.y>penetration){penetration=hit.point.y-p.y;worst=p.toArray();}}
    context.diagnostic(JSON.stringify({sampledSeatPenetration:penetration,worst,samples:thighSamples.length}));
    assert.ok(handMin>=5.05799985-.001&&handMin<=5.05799985+.003,'actual palm skin contacts the tabletop without penetration or floating');
    assert.ok(Math.abs(palms[0]-palms[1])<.001,'both palms share the desk plane');
    assert.ok(penetration<.004,'cushion does not cut through the sampled thigh skin');
    assert.ok(Math.abs(soleMin-4.265)<.002,'actual shoe sole rests on the rug');
    for(const hand of hands) {assert.ok(Math.abs(hand[0]-16.145)<.001,'wrist reaches desk');assert.ok(Math.abs(hand[1]-5.0976)<.001,'wrist contact height');}
    controller.handleInteract();
    const exitMotion=[];
    for(let i=0;i<900;i++) {
      const before=controller.player.position.clone(); controller.update(1/60);checkTransition();
      if(controller.diagnostics.state.deskStage==='exit')exitMotion.push(controller.player.position.distanceTo(before));
      if(controller.diagnostics.state.mode==='explore')break;
    }
    assert.ok(exitMotion.slice(Math.floor(exitMotion.length*.2),Math.floor(exitMotion.length*.8)).every(distance=>distance>.004),'lateral exit also clears the rug without contact stalls');
    context.diagnostic(JSON.stringify({maximumHandDeskPenetration:edgePenetration,edgeWorst}));
    assert.ok(edgePenetration<.002,'hands clear the desk edge during both reach and withdrawal');
    assert.equal(controller.diagnostics.state.mode,'explore');
    assert.equal(controller.diagnostics.state.seatWeight,0);
    context.diagnostic(JSON.stringify({stood:controller.diagnostics.state}));
    assert.ok(physics.canStandAt(controller.player.position),'stand exits to a clear capsule location');
    controller.setVirtualInput(0,-1);const before=controller.player.position.clone();for(let i=0;i<60;i++)controller.update(1/60);
    assert.ok(controller.player.position.distanceTo(before)>.3,'movement resumes');
    // The reported failure starts inside the narrow channel. Also enter from
    // the opposite armrest at a different display rate.
    controller.setVirtualInput(0,0);
    for(const [position,hz] of [[[15.98,4.265,-5.9],60],[[15.7,4.265,-4.1],144]]) {
      controller.enterExplore(undefined,{position,yaw:0});
      for(let i=0;i<hz;i++)controller.update(1/hz);
      controller.handleInteract();
      for(let i=0;i<hz*18;i++) {
        controller.update(1/hz);checkTransition();
        if(controller.diagnostics.state.deskStage==='align')assert.ok(Math.abs(controller.diagnostics.state.bodyYaw-Math.PI/2)<.001,'entry keeps torso facing desk');
        if(controller.diagnostics.state.mode==='seated')break;
      }
      assert.equal(controller.diagnostics.state.mode,'seated',`entry from ${position} at ${hz} Hz`);
      controller.handleInteract();
      for(let i=0;i<hz*15;i++){controller.update(1/hz);checkTransition();if(controller.diagnostics.state.mode==='explore')break;}
      assert.equal(controller.diagnostics.state.mode,'explore');
    }
    assert.ok(edgePenetration<.002,'alternate entries also clear the desk');
  } finally {controller.dispose();Object.assign(globalThis,prior);delete globalThis[fixtureKey];}
});

test('actual controller carries and renders the visitor with the cabin, then allows disembarking', async () => {
  const actual = JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json', import.meta.url)));
  const saved = { document: globalThis.document, window: globalThis.window, matchMedia: globalThis.matchMedia };
  try {
    for (const hz of [60, 90, 144, 165]) {
      globalThis.document=saved.document; globalThis.window=saved.window; globalThis.matchMedia=saved.matchMedia;
      const root=new THREE.Group(); for(const url of [actual.collisions.url,...actual.collisions.additionalUrls])root.add((await load(url)).scene);
      const scene=(await load(actual.chunks.find(c=>c.id==='founder-lift').url,true)).scene;
      scene.add((await load(actual.chunks.find(c=>c.id==='shell').url,true)).scene);
      const physics=await createCollisionWorld(scene,undefined,root,[],actual.explorationBounds);
      globalThis.document={pointerLockElement:null,addEventListener(){},removeEventListener(){},exitPointerLock(){}};
      globalThis.window={addEventListener(){},removeEventListener(){}};globalThis.matchMedia=()=>({matches:false});
      const avatar={root:new THREE.Group(),view:{eyeHeight:1.64,seatedEyeOffset:.82},animations:[],update(){},setBodyView(){},dispose(){}};
      globalThis[fixtureKey]={physics,avatar};
      const camera=new THREE.PerspectiveCamera(54,16/9,.1,1800);camera.position.set(13.35,1.8,-5);camera.lookAt(13.35,1.4,-3);
      const controller=await createInteractionController({scene,camera,canvas:{addEventListener(){},removeEventListener(){},focus(){}},manifest:{...actual,screen:undefined,chairs:[]}});
      try {
        controller.enterExplore(undefined,{position:[13.35,.035,-3.35],yaw:Math.PI});for(let i=0;i<hz*2;i++)controller.update(1/hz);controller.setVirtualInput(0,1);
        for(let i=0;i<hz*3.3;i++)controller.update(1/hz);
        controller.setVirtualInput(0,0);for(let i=0;i<hz/2;i++)controller.update(1/hz);
        controller.handleInteract(); assert.equal(controller.diagnostics.lift.riding,true);
        let cabin;scene.traverse(o=>{if(o.userData.liftRole==='cabin')cabin=o;});
        const offset=controller.player.position.y-.035;let maxError=0;
        // Held movement must not push the passenger out of a travelling cabin.
        controller.setVirtualInput(0,1);
        for(let i=0;i<hz*10;i++) {
          controller.update(1/hz);
          if(i===hz*3) {
            controller.setEnabled(false);const held=controller.diagnostics.lift.height;
            for(let pause=0;pause<hz;pause++)controller.update(1/hz);
            assert.equal(controller.diagnostics.lift.height,held,'pause freezes cabin and passenger together');
            controller.setEnabled(true);controller.setVirtualInput(0,1);
          }
          maxError=Math.max(maxError,Math.abs(controller.player.position.y-(.035+cabin.position.y)-offset));
        }
        assert.ok(maxError<.002,`${hz} Hz cabin/passenger interpolation mismatch ${maxError}`);
        controller.setVirtualInput(0,0);for(let i=0;i<hz;i++)controller.update(1/hz);
        assert.equal(controller.diagnostics.lift.floor,1);assert.equal(controller.diagnostics.lift.phase,'idle');
        controller.setVirtualInput(0,-1);for(let i=0;i<hz*2.3;i++)controller.update(1/hz);
        assert.ok(controller.player.position.z<-.8,'walk out into founder room');assert.ok(Math.abs(controller.player.position.y-4.23)<.035);
        controller.exitExplore();assert.equal(controller.diagnostics.lift.height,0);
      } finally { controller.dispose(); }
    }
  } finally { Object.assign(globalThis,saved);delete globalThis[fixtureKey]; }
});

test('fixed-step locomotion renders uniformly at 60, 90, 144 and 165 Hz', async context => {
  const priorDocument=globalThis.document, priorWindow=globalThis.window, priorMatchMedia=globalThis.matchMedia;
  const results=[];
  try {
    for(const hz of [60,90,144,165]) {
      globalThis.document=priorDocument;globalThis.window=priorWindow;globalThis.matchMedia=priorMatchMedia;
      const floor=new THREE.Mesh(new THREE.BoxGeometry(30,.2,30),new THREE.MeshBasicMaterial());floor.position.y=-.1;floor.name='floor';
      const fixture=new THREE.Group().add(floor);
      const physics=await createCollisionWorld(fixture,undefined,fixture);
      globalThis.document={pointerLockElement:null,addEventListener(){},removeEventListener(){},exitPointerLock(){}};
      globalThis.window={addEventListener(){},removeEventListener(){}};globalThis.matchMedia=()=>({matches:false});
      const avatar={root:new THREE.Group(),view:{eyeHeight:1.64,seatedEyeOffset:.82},animations:[],update(){},setBodyView(){},dispose(){}};
      globalThis[fixtureKey]={physics,avatar};
      const camera=new THREE.PerspectiveCamera(54,16/9,.1,1800);camera.position.set(0,1.8,2.4);camera.lookAt(0,1.4,0);
      const controller=await createInteractionController({scene:new THREE.Scene(),camera,canvas:{addEventListener(){},removeEventListener(){},focus(){}},manifest:{spawn:{position:[0,0,0],yaw:0},chairs:[]}});
      try {
        controller.enterExplore();controller.setVirtualInput(0,1);
        for(let i=0;i<2*hz;i++)controller.update(1/hz);
        const deltas=[],positions=[];let previous=controller.player.position.clone();
        for(let i=0;i<hz;i++) {controller.update(1/hz);deltas.push(controller.player.position.distanceTo(previous));positions.push(controller.player.position.toArray());previous.copy(controller.player.position);}
        const expected=1.38/hz,min=Math.min(...deltas),max=Math.max(...deltas);
        if(min<expected*.97)context.diagnostic(JSON.stringify({hz,bad:deltas.map((d,i)=>({d,i,p:positions[i]})).filter(r=>r.d<expected*.97)}));
        assert.ok(min>expected*.97&&max<expected*1.03,`${hz} Hz translation must have no repeated zero-step frames or doubled steps: ${min}..${max}`);
        controller.toggleCameraView();for(let i=0;i<hz;i++)controller.update(1/hz);
        let previousCamera=camera.position.clone();const cameraDeltas=[];
        for(let i=0;i<hz;i++){controller.update(1/hz);cameraDeltas.push(camera.position.distanceTo(previousCamera));previousCamera.copy(camera.position);}
        assert.ok(Math.min(...cameraDeltas)>expected*.97&&Math.max(...cameraDeltas)<expected*1.03,'body camera must share the interpolated pose');
        results.push({hz,expected,min,max});
      } finally {controller.dispose();floor.geometry.dispose();floor.material.dispose();}
    }
    context.diagnostic(JSON.stringify(results));
  } finally {globalThis.document=priorDocument;globalThis.window=priorWindow;globalThis.matchMedia=priorMatchMedia;delete globalThis[fixtureKey];}
});

test('actual handoff controller keeps third-person outside the body and preserves usable body/seated views', async context => {
  const collisionRoot = new THREE.Group();
  for (const url of [manifest.collisions.url, ...(manifest.collisions.additionalUrls ?? [])]) collisionRoot.add((await load(url)).scene);
  const physics = await createCollisionWorld(collisionRoot, undefined, collisionRoot);
  const avatar = createRocketboxAvatar(await load(manifest.character.url, true));
  const headMeshes = [];
  avatar.root.traverse(object => {
    if (object.isMesh && (Array.isArray(object.material) ? object.material : [object.material]).every(material => /m005_(head|opacity)/i.test(material.name))) headMeshes.push(object);
  });
  assert.ok(headMeshes.length > 0, 'use the actual head and hair primitives');
  const lounge = (await load(manifest.chunks.find(chunk => chunk.id === 'lounge').url, true)).scene;
  lounge.updateMatrixWorld(true);
  let screenMesh;
  lounge.traverse(object => { if (object.isMesh && (object.userData.sourceName === manifest.screen.objectName || object.name === manifest.screen.objectName)) screenMesh ??= object; });
  assert.ok(screenMesh, 'use the actual source presentation screen geometry');
  const screenCenter = new THREE.Box3().setFromObject(screenMesh).getCenter(new THREE.Vector3());
  const priorDocument = globalThis.document, priorWindow = globalThis.window, priorMatchMedia = globalThis.matchMedia;
  globalThis.document = { pointerLockElement: null, addEventListener() {}, removeEventListener() {}, exitPointerLock() {} };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis[fixtureKey] = { physics, avatar, screen: { meshes: [screenMesh], setActive() {}, update() {}, getWorldCenter: () => screenCenter.clone(), dispose() {} } };
  const canvas = { addEventListener() {}, removeEventListener() {}, focus() {}, style: {} };
  const camera = new THREE.PerspectiveCamera(54, 16 / 9, 0.04, 2000);
  const handoff = manifest.tour.find(frame => frame.id === 'Explore handoff');
  camera.position.fromArray(handoff.position); camera.lookAt(new THREE.Vector3(...handoff.target));
  let state, hint;
  const controller = await createInteractionController({ scene: new THREE.Scene(), camera, canvas, manifest, onStateChange: value => { state = value; }, onPrompt: value => { hint = value; } });
  const advance = count => { for (let i = 0; i < count; i++) controller.update(1 / 60); };
  const horizontalDistance = () => Math.hypot(camera.position.x - controller.player.position.x, camera.position.z - controller.player.position.z);
  const direction = () => camera.getWorldDirection(new THREE.Vector3());
  const finitePose = () => assert.ok([...camera.position.toArray(), ...camera.quaternion.toArray(), camera.fov].every(Number.isFinite));
  const poses = [];
  const capture = label => poses.push({ label, camera: camera.position.toArray(), direction: direction().toArray(), feet: controller.player.position.toArray(), horizontalBodyDistance: horizontalDistance() });
  try {
    controller.enterExplore({ position: camera.position.clone(), quaternion: camera.quaternion.clone() }); advance(180);
    assert.ok(horizontalDistance() > 2, 'third-person camera must not collapse into the body pivot');
    assert.ok(camera.position.distanceTo(new THREE.Vector3(...handoff.position)) < 0.05, 'open-space follow should preserve the source handoff');
    assert.ok(direction().y < 0 && direction().y > -0.4, 'handoff looks gently down, not into the ceiling');
    assert.equal(hint.target, 'chair-03'); finitePose(); capture('third');
    const thirdDirection = direction();
    assert.ok(headMeshes.every(mesh => mesh.visible));
    controller.toggleCameraView();
    assert.ok(headMeshes.every(mesh => mesh.visible), 'V must not reveal a headless body before the camera moves');
    advance(10);
    assert.ok(horizontalDistance() > 1, 'the early transition still shows the visitor from outside');
    assert.ok(headMeshes.every(mesh => mesh.visible), 'head and hair stay visible during the distant part of the blend');
    advance(110);
    assert.ok(headMeshes.every(mesh => !mesh.visible), 'settled eye view hides the local head and hair');
    assert.ok(direction().angleTo(thirdDirection) < 0.001, 'body view inherits a valid heading');
    assert.ok(Math.abs(camera.position.y - controller.player.position.y - avatar.view.eyeHeight) < 0.01);
    assert.ok(horizontalDistance() < 0.1); finitePose(); capture('body');
    controller.toggleCameraView();
    assert.ok(headMeshes.every(mesh => !mesh.visible), 'the return transition must not reveal the head while still inside it');
    advance(120);
    assert.ok(headMeshes.every(mesh => mesh.visible), 'third-person restores the head and hair');
    assert.ok(horizontalDistance() > 2, 'switching back restores third-person distance'); finitePose(); capture('third again');
    controller.handleInteract(); advance(360);
    assert.equal(state, 'seated'); assert.ok(horizontalDistance() > 1, 'seated third-person must stay outside the torso/chair');
    assert.ok(direction().angleTo(screenCenter.clone().sub(camera.position).normalize()) < 0.12);
    finitePose(); capture('seated third');
    controller.toggleCameraView(); advance(120);
    assert.ok(direction().angleTo(screenCenter.clone().sub(camera.position).normalize()) < 0.001, 'seated body view faces the physical screen');
    const chair = manifest.chairs.find(item => item.id === 'chair-03');
    assert.ok(Math.abs(camera.position.y - chair.seatPosition[1] - avatar.view.seatedEyeOffset) < 0.01);
    finitePose(); capture('seated body');
    if (controller.cameraView === 'bodyCam') controller.toggleCameraView();
    controller.exitExplore();
    const final = new CinematicPath(manifest).sample(1);
    camera.position.copy(final.position); camera.quaternion.copy(final.quaternion);
    controller.enterExplore(final, CINEMATIC_HANDOFF); advance(180);
    assert.ok(physics.canStandAt(controller.player.position), 'founder handoff must fit the full avatar');
    assert.ok(Math.abs(controller.player.position.y - 4.23) < .035, 'handoff remains on upper floor');
    assert.ok(camera.position.distanceTo(final.position) < .1, 'final cinematic blends into the nearby follow camera: '+JSON.stringify({camera:camera.position.toArray(),final:final.position.toArray(),feet:controller.player.position.toArray()}));
    let animationSpeed = Infinity;
    const updateAvatar = avatar.update.bind(avatar);
    avatar.update = (dt, speed, ...rest) => { animationSpeed = speed; return updateAvatar(dt, speed, ...rest); };
    controller.enterExplore(undefined, { position: [16, 4.23, -8.7], yaw: 0 });
    controller.setVirtualInput(0, 1); advance(240);
    assert.ok(controller.player.position.z > -9.63, 'founder cabinet blocks walking');
    assert.ok(animationSpeed < .02, 'blocked locomotion must settle into idle instead of walking through the cabinet: '+animationSpeed);
    capture('founder cabinet stop');
    controller.setVirtualInput(0,0);
    // The entrance-side glass was retired when the full-width slab was added.
    // Exercise tight follow clearance against the retained gallery guard instead.
    controller.enterExplore(undefined,{position:[12,3.675,-24.05],yaw:0});
    controller.setVirtualInput(0,1);advance(180);controller.setVirtualInput(0,0);advance(120);
    assert.ok(controller.player.position.z > -24.65, 'gallery glass stops the avatar');
    assert.ok(horizontalDistance() > .4 && horizontalDistance() < 1.5, 'tight follow clearance retracts the boom without switching to eye view');
    assert.ok(Math.abs(camera.fov - 54) < .01, 'obstruction must not trigger a first-person FOV change');
    assert.equal(controller.cameraView,'thirdPerson','automatic clearance preserves the explicit V-key preference');
    controller.setVirtualInput(0,0,-Math.PI/2/.0021,0);advance(180);
    assert.ok(horizontalDistance()>1.8,'looking along the clear walkway restores third-person follow');
    capture('gallery follow restored');
    context.diagnostic(JSON.stringify(poses));
  } finally {
    controller.dispose();
    lounge.traverse(object => { if (object.isMesh) { object.geometry.dispose(); (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose()); } });
    collisionRoot.traverse(object => { if (object.isMesh) { object.geometry.dispose(); (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose()); } });
    globalThis.document = priorDocument; globalThis.window = priorWindow; globalThis.matchMedia = priorMatchMedia; delete globalThis[fixtureKey];
  }
});
