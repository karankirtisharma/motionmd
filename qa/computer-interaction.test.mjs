import { desktopLayout } from '../src/runtime/interaction/desktopLayout.ts';
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
  .replace("from '../presentation/FounderCRM'", `from ${JSON.stringify(dataModule(`export const createFounderCRM=()=>globalThis.${fixtureKey}.crm;`))}`)
  .replace("from './ComputerScreens'", `from ${JSON.stringify(dataModule(`export const createComputerScreens=()=>globalThis.${fixtureKey}.desktop;`))}`)
  .replace("from './Workstation'", `from ${JSON.stringify(new URL('../src/runtime/interaction/Workstation.ts', import.meta.url).href)}`)
  .replace("from './StairSurfaces'", `from ${JSON.stringify(new URL('../src/runtime/interaction/StairSurfaces.ts', import.meta.url).href)}`)
  .replace("from './movement'", `from ${JSON.stringify(movementURL)}`)
  .replace("from './GlassLift'", `from ${JSON.stringify(new URL('../src/runtime/interaction/GlassLift.ts', import.meta.url).href)}`)
  .replace("from './CollisionWorld'", `from ${JSON.stringify(dataModule(`export const createCollisionWorld=async()=>globalThis.${fixtureKey}.physics;`))}`)
  .replace("from './Avatar'", `from ${JSON.stringify(dataModule(`export const loadAvatar=async()=>globalThis.${fixtureKey}.avatar;`))}`)
  .replace("from '../presentation/PresentationScreen'", `from ${JSON.stringify(dataModule(`export const createPresentationScreen=()=>globalThis.${fixtureKey}.screen;`))}`)
  .replace("from '../rendering/assets'", `from ${JSON.stringify(new URL('../src/runtime/rendering/assets.ts', import.meta.url).href)}`);
const { createInteractionController } = await import(dataModule(controllerSource));


test('all 18 measured computer chairs enter, reserve app keys, and exit through clear aisles', async context => {
  const collisionRoot = new THREE.Group();
  for (const url of [manifest.collisions.url, ...manifest.collisions.additionalUrls]) collisionRoot.add((await load(url)).scene);
  const physics = await createCollisionWorld(new THREE.Scene(), undefined, collisionRoot);
  const avatar = createRocketboxAvatar(await load(manifest.character.url, true));
  const listeners = new Map();
  const prior = { document: globalThis.document, window: globalThis.window, matchMedia: globalThis.matchMedia };
  globalThis.document = { pointerLockElement: null, addEventListener(){}, removeEventListener(){}, exitPointerLock(){} };
  globalThis.window = { addEventListener(name, fn){ listeners.set(name, fn); }, removeEventListener(){} };
  globalThis.matchMedia = () => ({ matches: false });
  const computers = desktopLayout.map((item, index) => {
    const seat = new THREE.Vector3().fromArray(item.seat), corners = item.corners.map(p => new THREE.Vector3().fromArray(p));
    const center = corners[0].clone().add(corners[2]).multiplyScalar(.5);
    return { id: `studio-computer-${index+1}`, seat, corners, center, forward: center.clone().sub(seat).setY(0).normalize() };
  });
  let active, clicked, opens = 0;
  const desktop = { computers, pick(){return clicked;}, open(c){ assert.equal(active, undefined, 'one live computer at a time'); active=c; opens++; }, close(){active=undefined;}, setEnabled(){}, update(){return false;}, dispose(){} };
  let crmEnabled = false;
  const crm = { collision: { vertices: [100,100,100,101,100,100,100,101,100], indices: [0,1,2] }, setEnabled(value){crmEnabled=value;}, setSeated(){}, update(){return false;}, dispose(){} };
  globalThis[fixtureKey] = { physics, avatar, desktop, crm };
  const camera = new THREE.PerspectiveCamera(54,16/9,.1,1800);
  const controller = await createInteractionController({ scene:new THREE.Scene(), camera, canvas:{addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(){},focus(){},getBoundingClientRect(){return {left:0,top:0,width:1000,height:700};}}, manifest:{spawn:manifest.spawn,chairs:[]} });
  const runUntil = (target, seconds=26) => {
    for(let frame=0;frame<seconds*60;frame++){controller.update(1/60); if(controller.diagnostics.state.mode===target)return;}
    assert.fail(`did not reach ${target}: ${JSON.stringify(controller.diagnostics.state)}`);
  };
  try {
    for(const computer of computers) {
      controller.setEnabled(false);
      const start=computer.seat.clone().addScaledVector(computer.forward,-.8).setY(.015);
      controller.enterExplore(undefined,{position:start.toArray(),yaw:Math.atan2(-computer.forward.x,-computer.forward.z)});
      assert.equal(crmEnabled,true,'direct exploration re-enables native founder display');
      for(let frame=0;frame<90;frame++)controller.update(1/60);
      controller.handleInteract(); controller.handleInteract(); // repeated entry cannot restart
      runUntil('seated');
      assert.equal(active?.id,computer.id);
      for(let frame=0;frame<150;frame++)controller.update(1/60);
      const settled=controller.diagnostics.state.feet;
      for(const code of ['Space','KeyG','KeyR','KeyS','KeyX','Delete','KeyI','Tab','Digit1','Digit3','Digit7','ArrowLeft','ArrowRight','BracketLeft','BracketRight','Enter','Escape']) {
        listeners.get('keydown')({code,repeat:false,target:null,preventDefault(){assert.fail(`room captured desktop key ${code}`);}});
      }
      controller.update(1/60);
      assert.equal(controller.diagnostics.state.mode,'seated');
      assert.deepEqual(controller.diagnostics.state.feet,settled);
      // Same world plane must fit portrait and landscape: no cropped native dock.
      for(const aspect of [16/9, .9]) {
        camera.aspect=aspect;
        for(let frame=0;frame<150;frame++)controller.update(1/60);
        camera.updateMatrixWorld();
        for(const point of computer.corners) { const ndc=point.clone().project(camera); assert.ok(Math.abs(ndc.x)<.98 && Math.abs(ndc.y)<.98, `${computer.id} monitor cropped at ${aspect}: ${ndc.toArray()}`); }
      }
      camera.aspect=16/9;
      controller.leaveSeat(); assert.equal(active,undefined,'unmount immediately when leaving');
      runUntil('explore');
      const exit=new THREE.Vector3().fromArray(controller.diagnostics.state.feet);
      assert.ok(exit.distanceTo(start)<.08,`${computer.id} returned to clear aisle`);
      assert.ok(physics.canStandAt(exit),`${computer.id}: full navigation capsule restored`);
    }
    assert.equal(opens,18);
    // The pointer-selected screen owns the chair, even beside another seat.
    // Starting at its side aisle must not first backtrack to the rear centre.
    for(const computer of computers) {
      const side=new THREE.Vector3(computer.forward.z,0,-computer.forward.x);
      const start=computer.seat.clone().addScaledVector(computer.forward,-.8).addScaledVector(side,.477).setY(.015);
      controller.enterExplore(undefined,{position:start.toArray(),yaw:Math.atan2(-computer.forward.x,-computer.forward.z)});
      for(let frame=0;frame<90;frame++)controller.update(1/60);
      clicked=computer;
      camera.position.copy(computer.center).addScaledVector(computer.forward,-.5);
      listeners.get('pointerdown')({button:0,clientX:500,clientY:350,pointerType:'mouse'});
      assert.equal(controller.diagnostics.state.selectedChair,computer.id,'clicked monitor retains its own seat');
      const first=new THREE.Vector3().fromArray(controller.diagnostics.state.approachTarget);
      const rear=computer.seat.clone().addScaledVector(computer.forward,-.8).setY(0);
      assert.ok(Math.hypot(first.x-rear.x,first.z-rear.z)>.35,'side entry skips redundant rear-centre waypoint');
      runUntil('seated'); assert.equal(active?.id,computer.id);
      controller.leaveSeat();runUntil('explore');
    }
    assert.equal(opens,36);
    context.diagnostic('18/18 real collision routes, both monitor orientations, portrait/landscape fit, reserved app keys and exits passed');
  } finally { controller.dispose(); Object.assign(globalThis,prior); delete globalThis[fixtureKey]; }
});
