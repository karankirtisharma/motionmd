import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { RectAreaLightNode } from 'three/webgpu';
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js';
import type { createCollisionWorld } from './CollisionWorld';
import type { RuntimeHint, SceneManifest } from '../../types';

/** A two-stop, interlocked lift. Static enclosure is supplied by the source GLB. */
export function createGlassLift(scene: THREE.Object3D, physics: Awaited<ReturnType<typeof createCollisionWorld>>, config: NonNullable<SceneManifest['lift']>) {
  const roles = new Map<string, THREE.Object3D>();
  scene.traverse(object => { if (object.userData.liftRole) roles.set(object.userData.liftRole, object); });
  const required = ['cabin', 'cabinDoorLeft', 'cabinDoorRight', 'landing0Left', 'landing0Right', 'landing1Left', 'landing1Right', 'hydraulicHead', 'hydraulicRod', 'anchorCable', 'carriageCable'];
  for (const role of required) if (!roles.has(role)) throw new Error(`Lift visual group missing: ${role}`);
  const { base, top, centerX } = config, travel = top - base;
  // One broad moving practical gives soft metal highlights and cabin illumination.
  // No extra shadow-map pass, and no changes to the building's sunset/GI setup.
  let cabinLight: THREE.RectAreaLight | undefined;
  if (config.cabinLight) {
    RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
    cabinLight = new THREE.RectAreaLight(new THREE.Color().setRGB(1, .82, .64), 3.2, 1.22, 1.45);
    cabinLight.name = 'LF102 warm cabin practical';
    cabinLight.position.set(13.235, base + 2.44, 1.15);
    cabinLight.rotation.x = -Math.PI / 2;
    roles.get('cabin')!.add(cabinLight);
  }
  const world = physics.world, car = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(13.235, 0, 1.15));
  const owned: RAPIER.Collider[] = [];
  function box(name: string, x: number, y: number, z: number, hx: number, hy: number, hz: number, moving = false) {
    const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(moving ? x - 13.235 : x, y, moving ? z - 1.15 : z).setFriction(.6), moving ? car : undefined);
    owned.push(collider); physics.colliderNames.set(collider.handle, `LF102 ${name}`); return collider;
  }
  box('cabin floor', 13.235, base - .05, 1.15, .885, .05, .98, true);
  box('cabin rear', 13.235, base + 1.24, 2.10, .865, 1.24, .012, true);
  for (const x of [12.37, 14.10]) box('cabin side', x, base + 1.24, 1.15, .012, 1.24, .94, true);
  box('cabin ceiling', 13.235, base + 2.52, 1.15, .885, .03, .98, true);
  const carDoor = box('cabin door', centerX, base + 1.25, .16, .54, 1.25, .03, true);
  const landingDoors = [base, top].map((floor, i) => box(`landing ${i} door`, centerX, floor + 1.27, .03, .54, 1.27, .03));
  let floor = 0, target = 0, height = 0, previousHeight = 0, openness = 1, previousOpen = 1, elapsed = 0;
  let phase: 'idle' | 'closing' | 'travel' | 'opening' = 'idle', riding = false, footOffset = 0, fromHeight = 0, openingStart = 0;
  const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  function inside(p: THREE.Vector3) {
    return p.x > 12.61 && p.x < 13.86 && p.z > .47 && p.z < 1.86 && Math.abs(p.y - (base + height)) < .25;
  }
  function nearFloor(p: THREE.Vector3) {
    if (Math.abs(p.x - centerX) > 1.1 || p.z < -1.8 || p.z > .5) return -1;
    return Math.abs(p.y - base) < .45 ? 0 : Math.abs(p.y - top) < .45 ? 1 : -1;
  }
  function obstructed(p: THREE.Vector3) {
    return Math.abs(p.x - centerX) < .79 && p.z > -.27 && p.z < .47 && Math.abs(p.y - (base + height)) < .5;
  }
  function interlock() {
    const open = (phase === 'idle' || phase === 'opening') && openness > .985;
    carDoor.setEnabled(!open);
    landingDoors.forEach((door, i) => door.setEnabled(!(open && i === floor)));
  }
  function render(alpha: number) {
    const h = THREE.MathUtils.lerp(previousHeight, height, alpha), o = THREE.MathUtils.lerp(previousOpen, openness, alpha);
    roles.get('cabin')!.position.y = h;
    for (const [side, sign] of [['Left', -1], ['Right', 1]] as const) {
      roles.get(`cabinDoor${side}`)!.position.x = sign * .54 * o;
      for (let i = 0; i < 2; i++) roles.get(`landing${i}${side}`)!.position.x = sign * .54 * (i === floor ? o : 0);
    }
    // A 2:1 roped hydraulic drive: ram/sheave travel half the cabin distance.
    roles.get('hydraulicHead')!.position.y = h / 2;
    roles.get('hydraulicRod')!.scale.y = .27 + h / 2;
    roles.get('anchorCable')!.scale.y = 2.45 + h / 2;
    roles.get('carriageCable')!.position.y = base + .10 + h;
    roles.get('carriageCable')!.scale.y = 2.47 - base - .10 - h / 2;
  }
  function interact(p: THREE.Vector3) {
    const stop = nearFloor(p), boarded = inside(p);
    if (!boarded && stop < 0) return false;
    if (phase !== 'idle') return true;
    if (!boarded && stop === floor) return true;
    target = boarded ? 1 - floor : stop;
    riding = boarded; footOffset = p.y - base - height; elapsed = 0; fromHeight = height; phase = 'closing';
    return true;
  }
  function step(dt: number, feet: THREE.Vector3) {
    previousHeight = height; previousOpen = openness;
    const attached = riding;
    if (phase === 'closing') {
      if (obstructed(feet)) { phase = 'opening'; openingStart = openness; elapsed = 0; riding = false; }
      else {
        elapsed += dt; openness = 1 - ease(Math.min(1, elapsed));
        if (elapsed >= 1) { openness = 0; phase = 'travel'; elapsed = 0; }
      }
    } else if (phase === 'travel') {
      elapsed += dt; height = THREE.MathUtils.lerp(fromHeight, target * travel, ease(Math.min(1, elapsed / 8.5)));
      if (elapsed >= 8.5) { height = target * travel; floor = target; phase = 'opening'; openingStart = 0; elapsed = 0; }
    } else if (phase === 'opening') {
      elapsed += dt; openness = THREE.MathUtils.lerp(openingStart, 1, ease(Math.min(1, elapsed)));
      if (elapsed >= 1) { phase = 'idle'; openness = 1; riding = false; }
    }
    // Park as fixed geometry: Rapier otherwise repeats zero-time floor contacts
    // when walking onto a stationary kinematic cabin. Travel stays kinematic.
    const bodyType = phase === 'travel' ? RAPIER.RigidBodyType.KinematicPositionBased : RAPIER.RigidBodyType.Fixed;
    if (car.bodyType() !== bodyType) {
      car.setBodyType(bodyType, true);
      car.setTranslation({ x: 13.235, y: height, z: 1.15 }, true);
    }
    if (phase === 'travel') car.setNextKinematicTranslation({ x: 13.235, y: height, z: 1.15 });
    interlock();
    if (attached) feet.y = base + height + footOffset;
    return attached;
  }
  function hint(p: THREE.Vector3): RuntimeHint | null {
    if (riding) return { text: phase === 'travel' ? (target ? 'Rising · Founder room' : 'Descending · Presentation room') : 'Lift doors · Please wait', target: 'glass-lift' };
    const stop = nearFloor(p), boarded = inside(p);
    if (!boarded && stop < 0) return null;
    if (phase !== 'idle') return { text: 'Lift arriving · Please wait', target: 'glass-lift' };
    return { text: boarded ? (floor ? 'E — Presentation room' : 'E — Founder room') : stop === floor ? 'Step inside the lift' : 'E — Call lift', target: 'glass-lift' };
  }
  function reset() {
    floor = target = 0; height = previousHeight = 0; openness = previousOpen = 1; phase = 'idle'; riding = false; elapsed = 0;
    car.setBodyType(RAPIER.RigidBodyType.Fixed, true);
    car.setTranslation({ x: 13.235, y: 0, z: 1.15 }, true); car.setNextKinematicTranslation({ x: 13.235, y: 0, z: 1.15 }); interlock(); render(1);
  }
  reset(); world.step();
  return {
    inside, interact, step, render, hint, reset,
    get state() { return { floor, target, height, openness, phase, riding, doorLocked: landingDoors.map(d => d.isEnabled()) }; },
    dispose() { cabinLight?.removeFromParent(); cabinLight?.dispose(); for (const c of owned) { physics.colliderNames.delete(c.handle); world.removeCollider(c, false); } world.removeRigidBody(car); },
  };
}
