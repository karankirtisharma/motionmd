import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Vector3, PerspectiveCamera } from 'three';
import { CINEMATIC_SECONDS, CinematicPath, cinematicDistance } from '../src/runtime/rendering/cinematic.ts';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/assets/scene-manifest.json', import.meta.url), 'utf8'));
const original = JSON.stringify(manifest.tour);
const path = new CinematicPath(manifest);

test('the cinematic is a short continuous source-route edit with the original handoff', () => {
  assert.equal(JSON.stringify(manifest.tour), original, 'the source inspection route must remain intact');
  assert.ok(CINEMATIC_SECONDS >= 45 && CINEMATIC_SECONDS <= 60);
  assert.ok(path.curve.getLength() < 55, 'avoid reinstating the long studio/founder detour');
  const handoff = manifest.tour.find(frame => frame.id === 'Explore handoff');
  const final = path.sample(1);
  assert.ok(final.position.distanceTo(new Vector3(...handoff.position)) < 1e-6);
  const camera = new PerspectiveCamera();
  camera.position.fromArray(handoff.position); camera.lookAt(new Vector3(...handoff.target));
  assert.ok(final.quaternion.angleTo(camera.quaternion) < 1e-6);
});

test('the cinematic starts and stops gently and removes source camera turn spikes', () => {
  const rate = 60, steps = CINEMATIC_SECONDS * rate;
  let previous = path.sample(0), previousVelocity, maxSpeed = 0, maxAcceleration = 0, maxAngularSpeed = 0;
  for (let index = 1; index <= steps; index++) {
    const pose = path.sample(index / steps);
    const velocity = pose.position.clone().sub(previous.position).multiplyScalar(rate);
    maxSpeed = Math.max(maxSpeed, velocity.length());
    maxAngularSpeed = Math.max(maxAngularSpeed, pose.quaternion.angleTo(previous.quaternion) * rate);
    if (previousVelocity) maxAcceleration = Math.max(maxAcceleration, velocity.clone().sub(previousVelocity).length() * rate);
    assert.ok([...pose.position.toArray(), ...pose.quaternion.toArray(), pose.fov].every(Number.isFinite));
    previous = pose; previousVelocity = velocity;
  }
  assert.ok(maxSpeed < 1.05, `camera speed ${maxSpeed} m/s exceeds the cinematic limit`);
  assert.ok(maxAngularSpeed < 20 * Math.PI / 180, `camera turn speed ${maxAngularSpeed} rad/s is too abrupt`);
  assert.ok(maxAcceleration < 2.2, `camera acceleration ${maxAcceleration} m/s² contains a route discontinuity`);
  assert.ok(cinematicDistance(1 / steps) < 1e-7);
  assert.ok(1 - cinematicDistance(1 - 1 / steps) < 1e-7);
});
