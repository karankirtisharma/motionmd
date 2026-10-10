import * as THREE from 'three';
import type { ChairDefinition, SceneManifest, RuntimeHint } from '../../types';
import { createCollisionWorld } from './CollisionWorld';
import { createGlassLift } from './GlassLift';
import { loadAvatar } from './Avatar';
import { applyLookInput, cameraLookDirection, cameraRelativeMove, cameraShortcut, damping, smoothEyeHeight, smootherStep, smoothAngle } from './movement';
import type { CameraView } from './movement';
import { createPresentationScreen } from '../presentation/PresentationScreen';
import { assetURL } from '../rendering/assets';

type ExtendedChair = ChairDefinition & { seatPosition?: [number, number, number]; forward?: [number, number, number] };
type Options = {
  scene: THREE.Object3D; camera: THREE.PerspectiveCamera;
  renderer?: unknown; canvas: HTMLCanvasElement; manifest: SceneManifest;
  signal?: AbortSignal;
  onStateChange?: (mode: 'explore' | 'seated') => void;
  onPrompt?: (prompt: RuntimeHint | null) => void;
  onScreenMode?: (active: boolean) => void;
  onCameraViewChange?: (view: CameraView) => void;
};
type Chair = {
  id: string; label: string; seat: THREE.Vector3; approach: THREE.Vector3;
  approaches: THREE.Vector3[]; forward: THREE.Vector3; floor: number; height: number;
};

/** One persistent camera is shared with the tour. Simulation stays on a fixed 60 Hz step. */
export async function createInteractionController(options: Options) {
  const { scene, camera, canvas, manifest } = options;
  options.signal?.throwIfAborted();
  const resources = await Promise.allSettled([
    createCollisionWorld(scene, manifest.collisions?.url ? assetURL(manifest.collisions.url) : undefined, undefined, manifest.collisions?.additionalUrls?.map(assetURL) ?? [], manifest.explorationBounds),
    loadAvatar(assetURL(manifest.character?.url ?? '/assets/character/RocketboxVisitor.glb')),
  ]);
  if (options.signal?.aborted || resources.some((result) => result.status === 'rejected')) {
    resources.forEach((result) => { if (result.status === 'fulfilled') result.value.dispose(); });
    options.signal?.throwIfAborted();
    const failure = resources.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    throw failure.reason;
  }
  const physics = (resources[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof createCollisionWorld>>>).value;
  const avatar = (resources[1] as PromiseFulfilledResult<Awaited<ReturnType<typeof loadAvatar>>>).value;
  scene.add(avatar.root); avatar.root.visible = false;
  const lift = manifest.lift ? createGlassLift(scene, physics, manifest.lift) : undefined;
  const display = manifest.screen ? createPresentationScreen({ scene, camera, canvas, objectName: manifest.screen.objectName }) : undefined;
  const chairs: Chair[] = (manifest.chairs as ExtendedChair[]).map((item) => {
    const position = new THREE.Vector3().fromArray(item.position);
    const forward = item.forward ? new THREE.Vector3().fromArray(item.forward) : new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion().fromArray(item.quaternion));
    forward.y = 0; forward.normalize();
    const seat = item.seatPosition ? new THREE.Vector3().fromArray(item.seatPosition) : position.clone().setY(item.seatHeight);
    const floor = position.y;
    let approach = item.approachPosition ? new THREE.Vector3().fromArray(item.approachPosition) : seat.clone().addScaledVector(forward, 0.55).setY(floor);
    // The round table is close to the chairs. Approach a free front corner rather than its tabletop.
    const side = new THREE.Vector3(forward.z, 0, -forward.x);
    const candidates = [approach, ...[0.65, -0.65, 0.85, -0.85, 1.05, -1.05].map((offset) => seat.clone().addScaledVector(forward, 0.45).addScaledVector(side, offset).setY(floor))];
    const approaches = candidates.filter((candidate) => physics.canStandAt(candidate));
    approach = approaches[0]?.clone() ?? approach;
    return { id: item.id, label: item.label ?? `Chair ${item.id.match(/\d+/)?.[0] ?? ''}`, seat, approach, approaches, forward, floor, height: seat.y - floor };
  });
  const keys = new Set<string>();
  const virtual = { x: 0, y: 0, sprint: false };
  const feet = new THREE.Vector3().fromArray(manifest.spawn.position);
  const previousFeet = feet.clone(), renderFeet = feet.clone();
  const velocity = new THREE.Vector3();
  const displacement = new THREE.Vector3();
  const pivot = new THREE.Vector3(), desiredCamera = new THREE.Vector3();
  const lookTarget = new THREE.Vector3(), desiredQuaternion = new THREE.Quaternion();
  const cameraMatrix = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0);
  let enabled = false, disposed = false, grounded = false;
  let mode: 'explore' | 'approach' | 'sitting' | 'seated' | 'standing' = 'explore';
  let selected: Chair | undefined, nearest: Chair | undefined;
  const nearestSamplePosition = new THREE.Vector3(Infinity, Infinity, Infinity);
  let yaw = manifest.spawn.yaw ?? 0, pitch = 0.16, bodyYaw = yaw + Math.PI;
  let previousBodyYaw = bodyYaw, renderBodyYaw = bodyYaw;
  let cameraView: CameraView = 'thirdPerson';
  let closeCamera = false;
  let intentionalUnlock = false, pointerLockUnavailable = false, cameraFloor = feet.y, cameraBlendDuration = 1.15;
  let verticalVelocity = 0, accumulator = 0, transition = 0, seatWeight = 0, cameraBlend = 0;
  let approachTime = 0, lastPrompt = '', dragging = false;
  let actualSpeed = 0;
  const transitionStart = new THREE.Vector3();
  const cameraStart = new THREE.Vector3(), cameraStartQuaternion = new THREE.Quaternion();
  const STEP = 1 / 60;

  function prompt(value: RuntimeHint | null) {
    const key = value ? `${value.text}:${value.target ?? ''}` : '';
    if (key !== lastPrompt) { lastPrompt = key; options.onPrompt?.(value); }
  }
  function resetInput() { keys.clear(); virtual.x = 0; virtual.y = 0; virtual.sprint = false; dragging = false; }
  function releaseCursor(intentional = false) {
    if (document.pointerLockElement === canvas) { intentionalUnlock = intentional; document.exitPointerLock(); }
    resetInput();
  }
  function acquireCursor() {
    if (!enabled || mode !== 'explore' || matchMedia('(pointer: coarse)').matches) return;
    if (!canvas.requestPointerLock) { pointerLockFallback(); return; }
    pointerLockUnavailable = false;
    try { const request = canvas.requestPointerLock(); request?.catch(pointerLockFallback); }
    catch { pointerLockFallback(); }
  }
  function pointerLockFallback() {
    pointerLockUnavailable = true;
    if (enabled && mode === 'explore') prompt({ text: 'Mouse lock unavailable here · Drag to look · V — Change view' });
  }
  function look(dx: number, dy: number) {
    if (!enabled || mode !== 'explore') return;
    const next = applyLookInput(yaw, pitch, dx, dy, cameraView);
    yaw = next.yaw; pitch = next.pitch;
  }
  function togglePointerLock() {
    if (!enabled || disposed || mode !== 'explore') return;
    if (document.pointerLockElement === canvas) releaseCursor(true);
    else { canvas.focus({ preventScroll: true }); acquireCursor(); }
  }
  function toggleCameraView() {
    if (!enabled || disposed || (mode !== 'explore' && mode !== 'seated')) return;
    cameraView = cameraView === 'thirdPerson' ? 'bodyCam' : 'thirdPerson';
    cameraStart.copy(camera.position); cameraStartQuaternion.copy(camera.quaternion);
    cameraBlend = 0; cameraBlendDuration = 0.36;
    const direction = camera.getWorldDirection(new THREE.Vector3());
    const angles = applyLookInput(Math.atan2(-direction.x, -direction.z), Math.asin(THREE.MathUtils.clamp(-direction.y, -1, 1)), 0, 0, cameraView);
    yaw = angles.yaw; pitch = angles.pitch;
    options.onCameraViewChange?.(cameraView);
  }
  function isInput(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    return target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName) || target.closest('[role="dialog"]'));
  }
  function keyDown(event: KeyboardEvent) {
    if (!enabled || isInput(event)) return;
    if (/^(Key[WASDELV]|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Space)$/.test(event.code)) event.preventDefault();
    const shortcut = cameraShortcut(event.code, event.repeat, false);
    if (shortcut === 'pointerLock') togglePointerLock();
    else if (shortcut === 'cameraView') toggleCameraView();
    else if (event.code === 'KeyE' && !event.repeat) handleInteract();
    else if (event.code === 'Escape') { releaseCursor(); if (mode === 'approach') { mode = 'explore'; selected = undefined; } }
    else keys.add(event.code);
  }
  function keyUp(event: KeyboardEvent) { keys.delete(event.code); }
  function pointerDown(event: PointerEvent) {
    if (!enabled || mode !== 'explore' || event.pointerType === 'touch') return;
    canvas.focus({ preventScroll: true });
    dragging = event.button === 0; if (dragging) acquireCursor();
  }
  function pointerUp() { dragging = false; }
  function pointerMove(event: PointerEvent) {
    if (document.pointerLockElement === canvas || dragging) look(event.movementX, event.movementY);
  }
  function blur() { resetInput(); }
  window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp);
  window.addEventListener('blur', blur); canvas.addEventListener('pointerdown', pointerDown);
  window.addEventListener('pointerup', pointerUp); window.addEventListener('pointermove', pointerMove);
  document.addEventListener('pointerlockerror', pointerLockFallback);

  function nearestChair() {
    let closest: Chair | undefined, distance = 1.65;
    for (const chair of chairs) {
      for (const approach of chair.approaches) {
        const delta = approach.clone().sub(feet);
        if (Math.abs(delta.y) > 0.7) continue;
        delta.y = 0;
        const length = delta.length();
        if (length < distance && physics.hasLineOfSight(feet.clone().addScaledVector(up, 0.55), approach.clone().addScaledVector(up, 0.55))) {
          closest = chair; distance = length; chair.approach.copy(approach);
        }
      }
    }
    return closest;
  }
  function beginSit(chair: Chair) {
    selected = chair; mode = 'approach'; approachTime = 0; velocity.set(0, 0, 0);
    prompt({ text: 'Approaching chair · Esc to cancel', target: chair.id }); resetInput();
  }
  function handleInteract() {
    if (!enabled) return;
    if (mode === 'seated') { leaveSeat(); return; }
    if (mode !== 'explore') return;
    if (lift?.interact(feet)) return;
    const chair = nearestChair(); if (chair) beginSit(chair);
  }
  function leaveSeat() {
    if (!enabled || mode !== 'seated' || !selected) return;
    mode = 'standing'; transition = 0; transitionStart.copy(feet);
    display?.setActive(false); options.onScreenMode?.(false);
    prompt({ text: 'Standing up', target: selected.id });
  }
  function simulate() {
    if (lift?.step(STEP, feet)) {
      velocity.set(0, 0, 0); actualSpeed = 0; verticalVelocity = 0; grounded = true; physics.place(feet); return;
    }
    let moveX = 0, moveY = 0, speed = 0;
    if (mode === 'explore') {
      moveX = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')) + virtual.x;
      moveY = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown')) + virtual.y;
      const relative = cameraRelativeMove(moveX, moveY, yaw);
      speed = keys.has('ShiftLeft') || keys.has('ShiftRight') || virtual.sprint ? 3.35 : 1.38;
      displacement.set(relative.x * speed, 0, relative.z * speed);
    } else if (mode === 'approach' && selected) {
      approachTime += STEP;
      displacement.copy(selected.approach).sub(feet); displacement.y = 0;
      const distance = displacement.length();
      if (distance < 0.10) {
        mode = 'sitting'; transition = 0; transitionStart.copy(feet); velocity.set(0, 0, 0);
        options.onStateChange?.('seated'); releaseCursor();
        return;
      }
      if (approachTime > 7) { mode = 'explore'; selected = undefined; prompt({ text: 'Move closer to the front of the chair' }); return; }
      displacement.multiplyScalar(Math.min(1.0, distance * 2.5) / distance);
    } else { if (lift) physics.world.step(); return; }
    velocity.x = THREE.MathUtils.lerp(velocity.x, displacement.x, damping(displacement.lengthSq() > 0.001 ? 8 : 12, STEP));
    velocity.z = THREE.MathUtils.lerp(velocity.z, displacement.z, damping(displacement.lengthSq() > 0.001 ? 8 : 12, STEP));
    // A gentle downward component keeps ground snapping active without defeating autostep.
    verticalVelocity = grounded ? -0.5 : Math.max(-16, verticalVelocity - 9.81 * STEP);
    displacement.set(velocity.x * STEP, verticalVelocity * STEP, velocity.z * STEP);
    const oldX = feet.x, oldZ = feet.z;
    grounded = physics.move(displacement, STEP, feet);
    const achievedSpeed = Math.hypot(feet.x - oldX, feet.z - oldZ) / STEP;
    // Millimetre contact corrections at a blocked wall are not a walking gait.
    actualSpeed = THREE.MathUtils.lerp(actualSpeed, achievedSpeed < 0.06 ? 0 : achievedSpeed, damping(16, STEP));
    if (cameraView === 'bodyCam' && mode === 'explore') bodyYaw = smoothAngle(bodyYaw, yaw + Math.PI, damping(14, STEP));
    else if (velocity.lengthSq() > 0.004) bodyYaw = smoothAngle(bodyYaw, Math.atan2(velocity.x, velocity.z), damping(10, STEP));
    if (feet.y < -10) { feet.fromArray(manifest.spawn.position); feet.y = physics.groundAt(feet); physics.place(feet); previousFeet.copy(feet); renderFeet.copy(feet); verticalVelocity = 0; }
  }
  function updateCamera(dt: number) {
    cameraFloor = smoothEyeHeight(cameraFloor, renderFeet.y, dt);
    const seatedView = selected && (mode === 'seated' || mode === 'sitting' || mode === 'standing');
    const eyeHeight = selected ? THREE.MathUtils.lerp(avatar.view.eyeHeight, selected.height + avatar.view.seatedEyeOffset, seatWeight) : avatar.view.eyeHeight;
    const eyePosition = new THREE.Vector3(renderFeet.x, cameraFloor + eyeHeight, renderFeet.z);
    pivot.copy(renderFeet).setY(cameraFloor + (selected ? THREE.MathUtils.lerp(1.35, selected.height + 0.68, seatWeight) : 1.35));
    const followDistance = lift?.inside(renderFeet) ? 1.05 : 2.45;
    desiredCamera.set(Math.sin(yaw) * Math.cos(pitch) * followDistance, Math.sin(pitch) * followDistance + 0.10, Math.cos(yaw) * Math.cos(pitch) * followDistance).add(pivot);
    const clearance = physics.cameraDistance(pivot, desiredCamera);
    const useCloseCamera = !seatedView && cameraView === 'thirdPerson' && clearance < (closeCamera ? 1.7 : 1.4);
    if (useCloseCamera !== closeCamera) {
      closeCamera = useCloseCamera;
      cameraStart.copy(camera.position); cameraStartQuaternion.copy(camera.quaternion);
      cameraBlend = 0; cameraBlendDuration = 0.3;
    }
    const firstPerson = cameraView === 'bodyCam' || closeCamera;
    if (firstPerson) {
      const direction = cameraLookDirection(yaw, pitch);
      // The camera sits at calibrated eye height, inside the capsule. It does not
      // inherit the animated head's bob/roll, so looking still stays still.
      desiredCamera.copy(eyePosition).add(new THREE.Vector3(-Math.sin(yaw) * 0.075, 0, -Math.cos(yaw) * 0.075));
      lookTarget.copy(desiredCamera).add(new THREE.Vector3(direction.x, direction.y, direction.z));
      if (seatedView && selected) lookTarget.copy(display?.getWorldCenter() ?? desiredCamera.clone().addScaledVector(selected.forward, 5));
    } else if (seatedView && selected) {
      const screenPosition = display?.getWorldCenter() ?? selected.seat.clone().add(new THREE.Vector3(0, 1, -5));
      const viewDirection = screenPosition.clone().sub(pivot); viewDirection.y = 0; viewDirection.normalize();
      desiredCamera.copy(pivot).addScaledVector(viewDirection, -1.25).addScaledVector(up, 0.46);
      lookTarget.copy(screenPosition).lerp(pivot.clone().addScaledVector(up, 0.35), 0.12);
    } else {
      lookTarget.copy(pivot).addScaledVector(up, 0.03);
    }
    if (!firstPerson) {
      const cameraDistance = physics.cameraDistance(pivot, desiredCamera);
      // Preserve the offset before mutating desiredCamera: copying pivot first
      // would zero the offset and put the camera inside the visitor's body.
      const offset = desiredCamera.clone().sub(pivot).normalize();
      desiredCamera.copy(pivot).addScaledVector(offset, cameraDistance);
    }
    cameraMatrix.lookAt(desiredCamera, lookTarget, up); desiredQuaternion.setFromRotationMatrix(cameraMatrix);
    cameraBlend = Math.min(1, cameraBlend + dt / cameraBlendDuration);
    if (cameraBlend < 1) {
      const alpha = smootherStep(cameraBlend);
      camera.position.lerpVectors(cameraStart, desiredCamera, alpha); camera.quaternion.slerpQuaternions(cameraStartQuaternion, desiredQuaternion, alpha);
    } else {
      // First person stays attached to the body; third person follows gently.
      camera.position.lerp(desiredCamera, firstPerson ? 1 : damping(12, dt));
      camera.quaternion.slerp(desiredQuaternion, damping(firstPerson ? 24 : 14, dt));
    }
    // Clamp the *smoothed* camera too, avoiding lag that slips behind furniture.
    // Collision retracts immediately; normal extension remains damped.
    if (!firstPerson || cameraBlend < 1) {
      const safeDistance = physics.cameraDistance(pivot, camera.position);
      const offset = camera.position.clone().sub(pivot);
      if (offset.length() > safeDistance) camera.position.copy(pivot).addScaledVector(offset.normalize(), safeDistance);
    }
    // Keep the head visible while the camera is still travelling toward the body.
    // Proximity also restores it safely when returning to third person.
    avatar.setBodyView(camera.position.distanceTo(eyePosition) < 0.45);
    camera.updateMatrixWorld();
    const targetFov = firstPerson ? 68 : selected ? 51 : lift?.inside(renderFeet) ? 68 : 54;
    if (camera.fov !== targetFov) {
      camera.fov = Math.abs(camera.fov - targetFov) < 0.0001 ? targetFov : THREE.MathUtils.lerp(camera.fov, targetFov, damping(8, dt));
      camera.updateProjectionMatrix();
    }
  }
  function update(dt: number) {
    if (!enabled || disposed || dt <= 0) return false;
    const delta = Math.min(Math.max(dt, 0), 0.08);
    let fixedStepPose = false;
    if (mode === 'sitting' && selected) {
      transition = Math.min(1, transition + delta / 1.05); seatWeight = smootherStep(transition);
      feet.lerpVectors(transitionStart, selected.seat.clone().setY(selected.floor), seatWeight);
      bodyYaw = smoothAngle(bodyYaw, Math.atan2(selected.forward.x, selected.forward.z), damping(12, delta));
      if (transition === 1) {
        mode = 'seated'; display?.setActive(true); options.onStateChange?.('seated'); options.onScreenMode?.(true);
        prompt({ text: 'Click the screen to explore · E to stand', target: selected.id });
      }
    } else if (mode === 'standing' && selected) {
      transition = Math.min(1, transition + delta / 1.05); seatWeight = 1 - smootherStep(transition);
      feet.lerpVectors(transitionStart, selected.approach, smootherStep(transition));
      if (transition === 1) {
        feet.y = physics.groundAt(feet, 2); physics.place(feet); mode = 'explore'; selected = undefined;
        nearestSamplePosition.set(Infinity, Infinity, Infinity);
        grounded = true; verticalVelocity = 0; options.onStateChange?.('explore'); prompt(null);
      }
    } else {
      accumulator += delta;
      while (accumulator >= STEP) {
        previousFeet.copy(feet); previousBodyYaw = bodyYaw;
        simulate(); accumulator -= STEP;
      }
      fixedStepPose = mode === 'explore' || mode === 'approach';
      if (mode === 'explore') {
        // Chairs and collision geometry are fixed. Keep prompts responsive to input
        // focus, but avoid repeating LOS queries when the feet have not moved at all.
        if (!feet.equals(nearestSamplePosition)) {
          nearest = nearestChair(); nearestSamplePosition.copy(feet);
        }
        prompt(lift?.hint(feet) ?? (nearest ? { text: pointerLockUnavailable ? 'E — Sit · Drag to look' : 'E — Sit', target: nearest.id } : document.pointerLockElement === canvas ? null : { text: pointerLockUnavailable ? 'Drag to look · V — Change view' : 'L — Lock mouse · Drag to look · V — Change view' }));
      }
    }
    if (fixedStepPose) {
      // Physics remains deterministic at 60 Hz. Draw the character AND follow
      // target at the same interpolated instant on 90/120/144/165 Hz displays.
      const alpha = THREE.MathUtils.clamp(accumulator / STEP, 0, 1);
      renderFeet.lerpVectors(previousFeet, feet, alpha);
      renderBodyYaw = smoothAngle(previousBodyYaw, bodyYaw, alpha);
    } else {
      previousFeet.copy(feet); renderFeet.copy(feet);
      previousBodyYaw = renderBodyYaw = bodyYaw; accumulator = 0;
    }
    lift?.render(fixedStepPose ? THREE.MathUtils.clamp(accumulator / STEP, 0, 1) : 1);
    avatar.root.position.copy(renderFeet); avatar.root.rotation.y = renderBodyYaw;
    avatar.update(delta, mode === 'explore' || mode === 'approach' ? actualSpeed : 0, seatWeight, selected?.height ?? 0.55);
    updateCamera(delta); display?.update();
    return true;
  }
  function enterExplore(pose?: { position?: THREE.Vector3; quaternion?: THREE.Quaternion }, inspectionSpawn?: { position: [number, number, number]; yaw: number }) {
    if (disposed) return;
    cameraStart.copy(pose?.position ?? camera.position); cameraStartQuaternion.copy(pose?.quaternion ?? camera.quaternion);
    cameraBlend = 0; cameraBlendDuration = 1.15; closeCamera = false; mode = 'explore'; selected = undefined; seatWeight = 0;
    nearestSamplePosition.set(Infinity, Infinity, Infinity);
    feet.fromArray(inspectionSpawn?.position ?? manifest.spawn.position); feet.y = physics.groundAt(feet, 3);
    physics.place(feet); velocity.set(0, 0, 0); actualSpeed = 0; verticalVelocity = 0; accumulator = 0; grounded = false;
    cameraFloor = feet.y;
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(cameraStartQuaternion);
    yaw = inspectionSpawn?.yaw ?? Math.atan2(-direction.x, -direction.z); pitch = 0.16; bodyYaw = yaw + Math.PI;
    previousFeet.copy(feet); renderFeet.copy(feet); previousBodyYaw = renderBodyYaw = bodyYaw;
    avatar.root.position.copy(feet); avatar.root.rotation.y = bodyYaw; avatar.root.visible = true;
    enabled = true; resetInput(); display?.setActive(false); options.onStateChange?.('explore');
    options.onCameraViewChange?.(cameraView);
    canvas.tabIndex = 0; canvas.focus({ preventScroll: true });
  }
  function exitExplore() {
    enabled = false; releaseCursor(); avatar.root.visible = false; lift?.reset();
    avatar.setBodyView(false);
    display?.setActive(false); options.onScreenMode?.(false); prompt(null);
  }
  return {
    player: avatar.root, update, enterExplore, exitExplore, handleInteract, leaveSeat, togglePointerLock, toggleCameraView,
    setCinematicLiftPose(pose: { height: number; openness: number; floor: number }) { return lift?.setCinematicPose(pose) ?? false; },
    get cameraView() { return cameraView; },
    consumeIntentionalUnlock() { const value = intentionalUnlock; intentionalUnlock = false; return value; },
    setEnabled(value: boolean) {
      enabled = value; resetInput();
      display?.setActive(value && mode === 'seated');
      if (value) canvas.focus({ preventScroll: true });
    },
    setScreenAction(action: string) { display?.setAction(action); },
    setVirtualInput(moveX: number, moveY: number, lookX = 0, lookY = 0, sprint = false) {
      virtual.x = THREE.MathUtils.clamp(moveX, -1, 1); virtual.y = THREE.MathUtils.clamp(moveY, -1, 1); virtual.sprint = sprint; look(lookX, lookY);
    },
    diagnostics: { get lift() { return lift?.state; }, collisionMeshes: physics.meshCount, collisionTriangles: physics.triangleCount, characterAnimations: avatar.animations, screenMeshes: display?.meshes.length ?? 0, chairs: chairs.length, chairApproaches: chairs.map((chair) => ({ id: chair.id, position: chair.approach.toArray(), clear: physics.canStandAt(chair.approach) })) },
    dispose() {
      if (disposed) return; exitExplore(); disposed = true;
      window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', blur);
      canvas.removeEventListener('pointerdown', pointerDown); window.removeEventListener('pointerup', pointerUp); window.removeEventListener('pointermove', pointerMove);
      document.removeEventListener('pointerlockerror', pointerLockFallback);
      avatar.root.removeFromParent(); avatar.dispose(); lift?.dispose(); physics.dispose(); display?.dispose();
    },
  };
}
