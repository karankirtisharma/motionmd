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
  .replace("from './movement'", `from ${JSON.stringify(movementURL)}`)
  .replace("from './GlassLift'", `from ${JSON.stringify(new URL('../src/runtime/interaction/GlassLift.ts', import.meta.url).href)}`)
  .replace("from './CollisionWorld'", `from ${JSON.stringify(dataModule(`export const createCollisionWorld=async()=>globalThis.${fixtureKey}.physics;`))}`)
  .replace("from './Avatar'", `from ${JSON.stringify(dataModule(`export const loadAvatar=async()=>globalThis.${fixtureKey}.avatar;`))}`)
  .replace("from '../presentation/PresentationScreen'", `from ${JSON.stringify(dataModule(`export const createPresentationScreen=()=>globalThis.${fixtureKey}.screen;`))}`)
  .replace("from '../rendering/assets'", `from ${JSON.stringify(new URL('../src/runtime/rendering/assets.ts', import.meta.url).href)}`);
const { createInteractionController } = await import(dataModule(controllerSource));

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
    controller.enterExplore(undefined,{position:[-1.3,4.2,-17],yaw:-Math.PI/2});
    controller.setVirtualInput(0,1);advance(180);controller.setVirtualInput(0,0);advance(120);
    assert.ok(controller.player.position.x < -.70, 'bridge glass stops the avatar');
    assert.ok(horizontalDistance() < .12, 'tight follow clearance uses a comfortable eye view');
    assert.equal(controller.cameraView,'thirdPerson','automatic clearance preserves the explicit V-key preference');
    controller.setVirtualInput(0,0,-Math.PI/2/.0021,0);advance(180);
    assert.ok(horizontalDistance()>1.8,'looking along the clear walkway restores third-person follow');
    capture('bridge follow restored');
    context.diagnostic(JSON.stringify(poses));
  } finally {
    controller.dispose();
    lounge.traverse(object => { if (object.isMesh) { object.geometry.dispose(); (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose()); } });
    collisionRoot.traverse(object => { if (object.isMesh) { object.geometry.dispose(); (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose()); } });
    globalThis.document = priorDocument; globalThis.window = priorWindow; globalThis.matchMedia = priorMatchMedia; delete globalThis[fixtureKey];
  }
});
