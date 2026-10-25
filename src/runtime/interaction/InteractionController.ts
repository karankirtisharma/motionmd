import * as THREE from 'three';
import type { ChairDefinition, SceneManifest, RuntimeHint } from '../../types';
import { createCollisionWorld } from './CollisionWorld';
import { createGlassLift } from './GlassLift';
import { loadAvatar } from './Avatar';
import { applyLookInput, cameraLookDirection, cameraRelativeMove, cameraShortcut, damping, smoothEyeHeight, smoothSupportHeight, smootherStep, smoothAngle, locomotionHeading, turnSpeedFactor } from './movement';
import type { CameraView } from './movement';
import { createPresentationScreen } from '../presentation/PresentationScreen';
import { assetURL } from '../rendering/assets';
import { createWorkstation, type Workstation } from './Workstation';
import { createStairSurfaces } from './StairSurfaces';

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
  workstation?: Workstation;
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
  const workstation = createWorkstation(scene);
  const stairContact = { sample: createStairSurfaces(scene) };
  if (workstation) physics.configureWorkstation(workstation.collisionTransform.offset, workstation.collisionTransform.rotation, workstation.collisionTransform.height);
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
  if (workstation) chairs.push({ id: workstation.id, label: 'Work at desk', seat: workstation.seat.clone().setY(workstation.floor + workstation.height), approach: workstation.approach.clone(), approaches: [workstation.approach.clone(), workstation.approach.clone().setZ(-4.58)], forward: workstation.forward, floor: workstation.floor, height: workstation.height, workstation });
  const virtual = { x: 0, y: 0, sprint: false };
  const feet = new THREE.Vector3().fromArray(manifest.spawn.position);
  const previousFeet = feet.clone(), renderFeet = feet.clone();
  let supportHeight = feet.y, previousSupportHeight = feet.y;
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
  let inspectionDistance: number | undefined;
  let cameraBoom: number | undefined;
  let intentionalUnlock = false, pointerLockUnavailable = false, cameraFloor = feet.y, cameraBlendDuration = 1.15;
  let verticalVelocity = 0, accumulator = 0, transition = 0, seatWeight = 0, cameraBlend = 0;
  let approachTime = 0, lastPrompt = '', dragging = false;
  let chairPointer: { x: number; y: number; distance: number } | undefined;
  let actualSpeed = 0;
  const approachRoute: THREE.Vector3[] = [];
  let deskStage: 'entry-turn' | 'grip' | 'open' | 'ungrip' | 'seat-turn' | 'lower' | 'swivel-in' | 'reach' | 'work' | 'release' | 'swivel-out' | 'rise' | undefined;
  let deskTime = 0, handWeight = 0, stanceWeight = 0, balanceLean = 0;
  let chairAngle = Math.PI / 4, entryAngle = Math.PI / 4, entrySide = -1, gripWeight = 0, swivelFrom = 0;
  if (workstation) {
    workstation.setSwivel(chairAngle);
    physics.swivelWorkstation(workstation.pivot, chairAngle);
  }
  const deskFrom = new THREE.Vector3(), plantedFeet = [new THREE.Vector3(), new THREE.Vector3()];
  const turnFeet = [new THREE.Vector3(), new THREE.Vector3()], feetYaw = [0, 0];
  let turnStart = 0;
  let sideStep = -1;
  const swingStart = new THREE.Vector3();
  const swingGoal = new THREE.Vector3();
  let swingFoot = 0;
  let swingYawStart = 0;
  const transitionStart = new THREE.Vector3();
  const cameraStart = new THREE.Vector3(), cameraStartQuaternion = new THREE.Quaternion();
  const STEP = 1 / 60;

  function prompt(value: RuntimeHint | null) {
    const key = value ? `${value.text}:${value.target ?? ''}` : '';
    if (key !== lastPrompt) { lastPrompt = key; options.onPrompt?.(value); }
  }
  function resetInput() { keys.clear(); virtual.x = 0; virtual.y = 0; virtual.sprint = false; dragging = false; chairPointer = undefined; }
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
    if (!enabled || (mode !== 'explore' && !(mode === 'seated' && selected?.workstation))) return;
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
    else if (event.code === 'Escape') { releaseCursor(); if (mode === 'approach') { physics.setDeskClearance(false); mode = 'explore'; selected = undefined; } }
    else keys.add(event.code);
  }
  function keyUp(event: KeyboardEvent) { keys.delete(event.code); }
  function pointerDown(event: PointerEvent) {
    if (!enabled || event.button !== 0) return;
    if ((mode === 'explore' || mode === 'seated') && workstation) {
      const rect = canvas.getBoundingClientRect();
      const pointer = document.pointerLockElement === canvas ? new THREE.Vector2() : new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      const ray = new THREE.Raycaster(); ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObjects(workstation.meshes, false)[0];
      if (hit && physics.hasLineOfSight(camera.position, hit.point, 0.05) && (mode === 'seated' && selected?.workstation || mode === 'explore' && nearestChair()?.id === workstation.id)) {
        chairPointer = { x: event.clientX, y: event.clientY, distance: 0 }; dragging = true; return;
      }
    }
    if (event.pointerType === 'touch' || (mode !== 'explore' && !(mode === 'seated' && selected?.workstation))) return;
    canvas.focus({ preventScroll: true });
    dragging = event.button === 0; if (dragging) acquireCursor();
  }
  function pointerUp(event: PointerEvent) {
    const clickedChair = chairPointer && chairPointer.distance < 6 && event.target === canvas;
    dragging = false; chairPointer = undefined;
    if (clickedChair) handleInteract();
  }
  function pointerMove(event: PointerEvent) {
    if (chairPointer) {
      chairPointer.distance = Math.max(chairPointer.distance, Math.hypot(event.clientX - chairPointer.x, event.clientY - chairPointer.y));
      if (chairPointer.distance < 6) return;
    }
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
    deskStage = undefined; deskTime = 0; handWeight = 0;
    approachRoute.length = 0;
    if (chair.workstation && Math.abs(chairAngle) > .01) {
      const openSide = chairAngle > 0 ? -1 : 1;
      const openApproach = chair.workstation.approach.clone().setZ(chair.workstation.pivot.z + openSide * .72);
      const standingSpot = chair.workstation.pointAt(chair.workstation.aligned, chairAngle);
      if (feet.distanceTo(standingSpot) < .06) {
        // Already beside the open seat after standing: do not walk away to
        // the approach marker and back just to start the same interaction.
        chair.approach.copy(feet);
      } else if ((feet.z - chair.workstation.pivot.z) * openSide < 0) {
        // Walk around the back of an already open chair, never through its arms.
        approachRoute.push(new THREE.Vector3(14.5, chair.floor, feet.z), new THREE.Vector3(14.5, chair.floor, openApproach.z), openApproach);
        chair.approach.copy(approachRoute.shift()!);
      } else chair.approach.copy(openApproach);
    }
    prompt({ text: 'Approaching chair · Esc to cancel', target: chair.id }); resetInput();
  }
  function startDeskEntry() {
    deskStage = 'entry-turn'; deskTime = 0; deskFrom.copy(feet); turnStart = bodyYaw; sideStep = -1;
    stanceWeight = 0; balanceLean = 0;
    entrySide = selected!.approach.z < selected!.workstation!.pivot.z ? -1 : 1;
    entryAngle = -entrySide * Math.PI / 4; gripWeight = 0; swivelFrom = chairAngle;
    physics.setDeskClearance(true);
    avatar.root.updateMatrixWorld(true);
    for (let i = 0; i < 2; i++) {
      turnFeet[i].set(i === 0 ? .11 : -.11, 0, 0).applyAxisAngle(up, bodyYaw).add(feet);
      avatar.root.traverse(bone => { if (bone.name === `Bip01_${i === 0 ? 'L' : 'R'}_Foot`) bone.getWorldPosition(turnFeet[i]).setY(selected!.floor); });
      plantedFeet[i].copy(turnFeet[i]); feetYaw[i] = bodyYaw;
    }
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
    if (selected.workstation) { deskStage = 'release'; deskTime = 0; }
    display?.setActive(false); options.onScreenMode?.(false);
    prompt({ text: 'Standing up', target: selected.id });
  }
  let pendingNavigationClearance = false;
  function simulate() {
    if (pendingNavigationClearance && physics.restoreNavigationClearance(feet)) pendingNavigationClearance = false;
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
      if (cameraView === 'thirdPerson' && displacement.lengthSq() > 0.001) {
        displacement.multiplyScalar(turnSpeedFactor(bodyYaw, Math.atan2(displacement.x, displacement.z)));
      }
    } else if (mode === 'approach' && selected) {
      approachTime += STEP;
      displacement.copy(selected.approach).sub(feet); displacement.y = 0;
      const distance = displacement.length();
      if (selected.workstation && distance < .4) physics.setDeskClearance(true);
      if (distance < (selected.workstation ? .035 : .10)) {
        if (approachRoute.length) { selected.approach.copy(approachRoute.shift()!); approachTime = 0; return; }
        mode = 'sitting'; transition = 0; transitionStart.copy(feet); velocity.set(0, 0, 0);
        if (selected.workstation) startDeskEntry();
        else options.onStateChange?.('seated');
        releaseCursor(true);
        return;
      }
      if (approachTime > 7) { physics.setDeskClearance(false); mode = 'explore'; selected = undefined; prompt({ text: 'Move closer to the front of the chair' }); return; }
      displacement.multiplyScalar(Math.min(1.0, distance * 2.5) / distance);
    } else { if (lift) physics.world.step(); return; }
    velocity.x = THREE.MathUtils.lerp(velocity.x, displacement.x, damping(displacement.lengthSq() > 0.001 ? 8 : 12, STEP));
    velocity.z = THREE.MathUtils.lerp(velocity.z, displacement.z, damping(displacement.lengthSq() > 0.001 ? 8 : 12, STEP));
    if (displacement.lengthSq() < 0.000001 && Math.hypot(velocity.x, velocity.z) < 0.025) {
      velocity.x = 0; velocity.z = 0;
    }
    // A gentle downward component keeps ground snapping active without defeating autostep.
    verticalVelocity = grounded ? -0.5 : Math.max(-16, verticalVelocity - 9.81 * STEP);
    displacement.set(velocity.x * STEP, verticalVelocity * STEP, velocity.z * STEP);
    const oldX = feet.x, oldZ = feet.z;
    grounded = physics.move(displacement, STEP, feet);
    const achievedSpeed = Math.hypot(feet.x - oldX, feet.z - oldZ) / STEP;
    // Millimetre contact corrections at a blocked wall are not a walking gait.
    actualSpeed = THREE.MathUtils.lerp(actualSpeed, achievedSpeed < 0.06 ? 0 : achievedSpeed, damping(16, STEP));
    if (cameraView === 'bodyCam' && mode === 'explore') bodyYaw = smoothAngle(bodyYaw, yaw + Math.PI, damping(14, STEP));
    else if (achievedSpeed > 0.06) bodyYaw = locomotionHeading(bodyYaw, Math.atan2(feet.x - oldX, feet.z - oldZ), achievedSpeed, STEP);
    if (feet.y < -10) { feet.fromArray(manifest.spawn.position); feet.y = physics.groundAt(feet); physics.place(feet); previousFeet.copy(feet); renderFeet.copy(feet); previousSupportHeight = supportHeight = feet.y; verticalVelocity = 0; }
  }
  function updateCamera(dt: number) {
    cameraFloor = smoothEyeHeight(cameraFloor, renderFeet.y, dt);
    const seatedView = selected && (mode === 'seated' || mode === 'sitting' || mode === 'standing');
    const eyeHeight = selected ? THREE.MathUtils.lerp(avatar.view.eyeHeight, selected.height + avatar.view.seatedEyeOffset, seatWeight) : avatar.view.eyeHeight;
    const eyePosition = new THREE.Vector3(renderFeet.x, cameraFloor + eyeHeight, renderFeet.z);
    pivot.copy(renderFeet).setY(cameraFloor + (selected ? THREE.MathUtils.lerp(1.35, selected.height + 0.68, seatWeight) : 1.35));
    const followDistance = inspectionDistance ?? (lift?.inside(renderFeet) ? 1.05 : 2.45);
    desiredCamera.set(Math.sin(yaw) * Math.cos(pitch) * followDistance, Math.sin(pitch) * followDistance + 0.10, Math.cos(yaw) * Math.cos(pitch) * followDistance).add(pivot);
    // Obstructions shorten the follow boom below; only explicit V input changes
    // perspective. A corner must not trigger an eye-height/FOV transition.
    const firstPerson = cameraView === 'bodyCam';
    if (firstPerson) {
      const direction = cameraLookDirection(yaw, pitch);
      // The camera sits at calibrated eye height, inside the capsule. It does not
      // inherit the animated head's bob/roll, so looking still stays still.
      desiredCamera.copy(eyePosition).add(new THREE.Vector3(-Math.sin(yaw) * 0.075, 0, -Math.cos(yaw) * 0.075));
      lookTarget.copy(desiredCamera).add(new THREE.Vector3(direction.x, direction.y, direction.z));
      if (seatedView && selected) lookTarget.copy(selected.workstation?.screen ?? display?.getWorldCenter() ?? desiredCamera.clone().addScaledVector(selected.forward, 5));
    } else if (seatedView && selected && !selected.workstation) {
      const screenPosition = display?.getWorldCenter() ?? selected.seat.clone().add(new THREE.Vector3(0, 1, -5));
      const viewDirection = screenPosition.clone().sub(pivot); viewDirection.y = 0; viewDirection.normalize();
      desiredCamera.copy(pivot).addScaledVector(viewDirection, -1.25).addScaledVector(up, 0.46);
      lookTarget.copy(screenPosition).lerp(pivot.clone().addScaledVector(up, 0.35), 0.12);
    } else {
      lookTarget.copy(pivot).addScaledVector(up, 0.03);
    }
    if (!firstPerson) {
      const cameraDistance = physics.cameraDistance(pivot, desiredCamera);
      // Dampen boom recovery, not world-space position. Sideways position lag
      // cuts across wall corners and makes the camera trail behind a stair turn.
      cameraBoom = cameraBoom === undefined ? cameraDistance
        : Math.min(cameraDistance, THREE.MathUtils.lerp(cameraBoom, cameraDistance, damping(6, dt)));
      // Preserve the offset before mutating desiredCamera: copying pivot first
      // would zero the offset and put the camera inside the visitor's body.
      const offset = desiredCamera.clone().sub(pivot).normalize();
      desiredCamera.copy(pivot).addScaledVector(offset, cameraBoom);
    }
    cameraMatrix.lookAt(desiredCamera, lookTarget, up); desiredQuaternion.setFromRotationMatrix(cameraMatrix);
    cameraBlend = Math.min(1, cameraBlend + dt / cameraBlendDuration);
    if (cameraBlend < 1) {
      const alpha = smootherStep(cameraBlend);
      camera.position.lerpVectors(cameraStart, desiredCamera, alpha); camera.quaternion.slerpQuaternions(cameraStartQuaternion, desiredQuaternion, alpha);
    } else {
      // The interpolated player and smoothed support already provide follow
      // damping. Adding another positional filter creates avoidable input lag.
      camera.position.copy(desiredCamera);
      camera.quaternion.slerp(desiredQuaternion, damping(firstPerson ? 24 : 14, dt));
    }
    // Clamp the *smoothed* camera too, avoiding lag that slips behind furniture.
    // Collision retracts immediately; normal extension remains damped.
    if (!firstPerson || cameraBlend < 1) {
      const safeDistance = physics.cameraDistance(pivot, camera.position);
      const offset = camera.position.clone().sub(pivot);
      if (offset.length() > safeDistance) camera.position.copy(pivot).addScaledVector(offset.normalize(), safeDistance);
    }
    if (!firstPerson && cameraBlend >= 1) {
      // Aim from the final collision-corrected position, not the unclipped boom.
      camera.lookAt(lookTarget);
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
  function updateDesk(delta: number) {
    if (!selected?.workstation || !deskStage) return;
    const desk = selected.workstation;
    deskTime += delta;
    const ease = (value: number) => smootherStep(THREE.MathUtils.clamp(value, 0, 1));
    const footAt = (anchor: THREE.Vector3, angle: number, i: number) => new THREE.Vector3(i === 0 ? .11 : -.11, 0, 0).applyAxisAngle(up, angle).add(anchor).setY(desk.floor);
    const advance = (stage: typeof deskStage) => {
      deskStage = stage; deskTime = 0; deskFrom.copy(feet); turnStart = bodyYaw; sideStep = -1; swivelFrom = chairAngle;
      turnFeet.forEach((p, i) => p.copy(plantedFeet[i]));
    };
    const swivel = (angle: number) => {
      chairAngle = angle; desk.setSwivel(angle); physics.swivelWorkstation(desk.pivot, angle);
    };
    const seat = desk.pointAt(desk.seat, chairAngle), aligned = desk.pointAt(desk.aligned, chairAngle);
    if (deskStage === 'entry-turn' || deskStage === 'seat-turn') {
      const alreadyOpen = Math.abs(chairAngle - entryAngle) < .01;
      const enteringSeat = deskStage === 'seat-turn' || alreadyOpen;
      const targetYaw = enteringSeat ? Math.PI / 2 + entryAngle : entrySide < 0 ? 0 : Math.PI;
      const path = enteringSeat ? aligned.clone().sub(deskFrom).setY(0) : new THREE.Vector3();
      const turnAngle = Math.atan2(Math.sin(targetYaw - turnStart), Math.cos(targetYaw - turnStart));
      if (Math.abs(turnAngle) < .001 && path.length() < .005) {
        advance(enteringSeat ? 'lower' : 'grip');
        return;
      }
      // A deliberate step-and-close replaces the old rapid 30-degree shuffles.
      // Only unusually large arrival turns need another pair; knee hinge IK
      // continues to track each foot's heading throughout the weight transfer.
      const pairs = Math.max(1, Math.ceil(Math.abs(turnAngle) / (Math.PI * 5 / 12)));
      const steps = pairs * 2, duration = Math.max(.65, path.length() / pairs / .55), total = steps * duration;
      const t = Math.min(1, deskTime / total);
      stanceWeight = ease(deskTime / .25); actualSpeed = 0;
      const clock = Math.min(steps, deskTime / duration), index = Math.min(steps - 1, Math.floor(clock)), phase = Math.min(1, clock - index);
      const swinging = index % 2;
      if (sideStep !== index) {
        if (sideStep >= 0) { plantedFeet[swingFoot].copy(swingGoal); feetYaw[swingFoot] = turnStart + turnAngle * (Math.floor(sideStep / 2) + 1) / pairs; }
        sideStep = index; swingFoot = swinging; swingStart.copy(plantedFeet[swinging]); swingYawStart = feetYaw[swinging];
      }
      const landingYaw = turnStart + turnAngle * (Math.floor(index / 2) + 1) / pairs;
      // Finish each turning pair closer to the seat. The final turn lands in
      // the sitting stance, without a second, disconnected alignment shuffle.
      const landingProgress = ease((Math.floor(index / 2) + 1) / pairs);
      swingGoal.copy(footAt(deskFrom.clone().addScaledVector(path, landingProgress), landingYaw, swinging));
      plantedFeet[swinging].lerpVectors(swingStart, swingGoal, ease(phase));
      plantedFeet[swinging].y += Math.sin(Math.PI * phase) ** 2 * .035;
      feetYaw[swinging] = smoothAngle(swingYawStart, landingYaw, ease(phase));
      // Pelvis stays between the two foot headings: never wind a planted leg
      // through the whole turn while the other foot jumps to the final heading.
      bodyYaw = smoothAngle(feetYaw[0], feetYaw[1], .5);
      if (enteringSeat) {
        const movement = deskFrom.clone().addScaledVector(path, ease(t)).sub(feet).setY(0);
        physics.move(movement, delta, feet, true);
      }
      if (t === 1) {
        if (enteringSeat && Math.hypot(feet.x - aligned.x, feet.z - aligned.z) > .04) {
          physics.setDeskClearance(false); mode = 'explore'; selected = undefined; deskStage = undefined;
          prompt({ text: 'Move to the open side of the chair and try again' }); options.onStateChange?.('explore'); return;
        }
        advance(enteringSeat ? 'lower' : 'grip');
      }
    } else if (deskStage === 'grip' || deskStage === 'open' || deskStage === 'ungrip') {
      const t = Math.min(1, deskTime / (deskStage === 'open' ? 1.05 : deskStage === 'grip' ? .9 : .65));
      const bend = deskStage === 'ungrip' ? 1 - ease(t) : deskStage === 'grip' ? ease(t) : 1;
      seatWeight = .46 * bend; balanceLean = .65 * bend; gripWeight = bend; actualSpeed = 0;
      if (deskStage === 'open') swivel(THREE.MathUtils.lerp(swivelFrom, entryAngle, ease(t)));
      prompt({ text: 'Turning the chair', target: desk.id });
      if (t === 1) advance(deskStage === 'grip' ? 'open' : deskStage === 'open' ? 'ungrip' : 'seat-turn');
    } else if (deskStage === 'lower') {
      const t = Math.min(1, deskTime / 1.8), lower = ease((t - .18) / .64);
      balanceLean = .48 * ease(t / .28) * (1 - ease((t - .67) / .33));
      seatWeight = lower; feet.lerpVectors(deskFrom, seat, lower);
      prompt({ text: 'Taking a seat', target: desk.id });
      if (t === 1) advance('swivel-in');
    } else if (deskStage === 'swivel-in' || deskStage === 'swivel-out') {
      const steps = 4, duration = .48, total = steps * duration;
      const targetAngle = deskStage === 'swivel-in' ? 0 : entryAngle;
      const t = Math.min(1, deskTime / total);
      swivel(THREE.MathUtils.lerp(swivelFrom, targetAngle, ease(t)));
      feet.copy(desk.pointAt(desk.seat, chairAngle)); bodyYaw = Math.PI / 2 + chairAngle;
      seatWeight = 1; balanceLean = 0; actualSpeed = 0;
      const clock = Math.min(steps, deskTime / duration), index = Math.min(steps - 1, Math.floor(clock)), phase = Math.min(1, clock - index);
      const swinging = index % 2;
      if (sideStep !== index) {
        if (sideStep >= 0) { plantedFeet[swingFoot].copy(swingGoal); feetYaw[swingFoot] = turnStart; }
        sideStep = index; swingFoot = swinging; swingStart.copy(plantedFeet[swinging]); swingYawStart = feetYaw[swinging];
      }
      const pairEnd = Math.min(steps, index + (index % 2 === 0 ? 2 : 1));
      const landingAngle = THREE.MathUtils.lerp(swivelFrom, targetAngle, ease(pairEnd / steps));
      const goal = footAt(desk.pointAt(desk.aligned, landingAngle), Math.PI / 2 + landingAngle, swinging);
      swingGoal.copy(goal); plantedFeet[swinging].lerpVectors(swingStart, goal, ease(phase));
      plantedFeet[swinging].y += Math.sin(Math.PI * phase) ** 2 * .025;
      feetYaw[swinging] = smoothAngle(swingYawStart, Math.PI / 2 + landingAngle, ease(phase));
      turnStart = Math.PI / 2 + landingAngle;
      prompt({ text: deskStage === 'swivel-in' ? 'Turning toward the desk' : 'Turning to stand', target: desk.id });
      if (t === 1) {
        for (let i = 0; i < 2; i++) { plantedFeet[i].copy(footAt(desk.pointAt(desk.aligned, targetAngle), Math.PI / 2 + targetAngle, i)); feetYaw[i] = Math.PI / 2 + targetAngle; }
        advance(deskStage === 'swivel-in' ? 'reach' : 'rise');
      }
    } else if (deskStage === 'reach') {
      const t = Math.min(1, deskTime / 1.2);
      feet.copy(seat); seatWeight = 1; handWeight = ease(t);
      if (t === 1) { advance('work'); mode = 'seated'; options.onStateChange?.('seated'); prompt({ text: 'E \u2014 Stand up \u00b7 Drag to look \u00b7 V \u2014 Change view', target: desk.id }); }
    } else if (deskStage === 'work') {
      feet.copy(seat); seatWeight = handWeight = 1;
    } else if (deskStage === 'release') {
      const t = Math.min(1, deskTime / 1.2); handWeight = 1 - ease(t); feet.copy(seat);
      if (t === 1) advance('swivel-out');
    } else if (deskStage === 'rise') {
      const t = Math.min(1, deskTime / 1.9), lift = ease((t - .26) / .66);
      const forward = .28 * ease(t / .3) + .72 * lift;
      balanceLean = .52 * ease(t / .28) * (1 - ease((t - .42) / .58));
      seatWeight = 1 - lift; feet.lerpVectors(deskFrom, aligned, forward);
      stanceWeight = 1 - ease((t - .72) / .28);
      if (t === 1) {
        // End where the feet supported the rise. No automatic walk-away pair:
        // the next horizontal movement belongs to the user's movement input.
        pendingNavigationClearance = !physics.restoreNavigationClearance(feet); physics.place(feet);
        mode = 'explore'; selected = undefined; deskStage = undefined;
        seatWeight = handWeight = stanceWeight = balanceLean = actualSpeed = 0;
        previousFeet.copy(feet); velocity.set(0, 0, 0); grounded = true; verticalVelocity = 0;
        nearestSamplePosition.set(Infinity, Infinity, Infinity); options.onStateChange?.('explore'); prompt(null);
      }
    }
  }
  function update(dt: number) {
    if (!enabled || disposed || dt <= 0) return false;
    const delta = Math.min(Math.max(dt, 0), 0.08);
    let fixedStepPose = false;
    if (selected?.workstation && deskStage) {
      updateDesk(delta);
    } else if (mode === 'sitting' && selected) {
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
        previousSupportHeight = supportHeight;
        simulate(); accumulator -= STEP;
        supportHeight = smoothSupportHeight(supportHeight, feet.y, STEP,
          mode === 'explore' && !lift?.state.riding && verticalVelocity > -2);
      }
      fixedStepPose = mode === 'explore' || mode === 'approach';
      if (mode === 'explore') {
        // Chairs and collision geometry are fixed. Keep prompts responsive to input
        // focus, but avoid repeating LOS queries when the feet have not moved at all.
        if (!feet.equals(nearestSamplePosition)) {
          nearest = nearestChair(); nearestSamplePosition.copy(feet);
        }
        prompt(lift?.hint(feet) ?? (nearest ? { text: nearest.workstation ? 'E — Work at desk · or click the chair' : pointerLockUnavailable ? 'E — Sit · Drag to look' : 'E — Sit', target: nearest.id } : document.pointerLockElement === canvas ? null : { text: pointerLockUnavailable ? 'Drag to look · V — Change view' : 'L — Lock mouse · Drag to look · V — Change view' }));
      }
    }
    if (fixedStepPose) {
      // Physics remains deterministic at 60 Hz. Draw the character AND follow
      // target at the same interpolated instant on 90/120/144/165 Hz displays.
      const alpha = THREE.MathUtils.clamp(accumulator / STEP, 0, 1);
      renderFeet.lerpVectors(previousFeet, feet, alpha);
      renderFeet.y = THREE.MathUtils.lerp(previousSupportHeight, supportHeight, alpha);
      renderBodyYaw = smoothAngle(previousBodyYaw, bodyYaw, alpha);
    } else {
      previousFeet.copy(feet); renderFeet.copy(feet);
      previousSupportHeight = supportHeight = feet.y;
      previousBodyYaw = renderBodyYaw = bodyYaw; accumulator = 0;
    }
    lift?.render(fixedStepPose ? THREE.MathUtils.clamp(accumulator / STEP, 0, 1) : 1);
    avatar.root.position.copy(renderFeet); avatar.root.rotation.y = renderBodyYaw;
    const deskContacts = selected?.workstation && deskStage  ? { hands: selected.workstation.wrists, feet: plantedFeet, handWeight, footWeight: 1, upright: seatWeight, stanceWeight, balanceLean, deskHeight: selected.workstation.deskHeight, deskFront: selected.workstation.deskFront, hipOffset: 0.125, feetYaw, grip: gripWeight > 0 ? { hand: entrySide < 0 ? 1 : 0, point: selected.workstation.grip(chairAngle, entrySide), forward: selected.workstation.forward.clone().applyAxisAngle(up, chairAngle), weight: gripWeight } : undefined } : undefined;
    avatar.update(delta, mode === 'explore' || mode === 'approach' ? actualSpeed : 0, seatWeight, selected?.height ?? 0.55, deskContacts,
      mode === 'explore' && !lift?.state.riding && verticalVelocity > -2 ? stairContact : undefined);
    updateCamera(delta); display?.update();
    return true;
  }
  function enterExplore(pose?: { position?: THREE.Vector3; quaternion?: THREE.Quaternion }, inspectionSpawn?: { position: [number, number, number]; yaw: number }) {
    if (disposed) return;
    cameraStart.copy(pose?.position ?? camera.position); cameraStartQuaternion.copy(pose?.quaternion ?? camera.quaternion);
    cameraBlend = 0; cameraBoom = undefined; cameraBlendDuration = 1.15; mode = 'explore'; selected = undefined; seatWeight = 0;
    physics.setDeskClearance(false); pendingNavigationClearance = false; deskStage = undefined; handWeight = 0; inspectionDistance = undefined;
    nearestSamplePosition.set(Infinity, Infinity, Infinity);
    feet.fromArray(inspectionSpawn?.position ?? manifest.spawn.position); feet.y = physics.groundAt(feet, 3);
    physics.place(feet); velocity.set(0, 0, 0); actualSpeed = 0; verticalVelocity = 0; accumulator = 0; grounded = false;
    cameraFloor = feet.y;
    previousSupportHeight = supportHeight = feet.y;
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(cameraStartQuaternion);
    yaw = inspectionSpawn?.yaw ?? Math.atan2(-direction.x, -direction.z); pitch = 0.16; bodyYaw = yaw + Math.PI;
    previousFeet.copy(feet); renderFeet.copy(feet); previousBodyYaw = renderBodyYaw = bodyYaw;
    avatar.root.position.copy(feet); avatar.root.rotation.y = bodyYaw; avatar.root.visible = true;
    enabled = true; resetInput(); display?.setActive(false); options.onStateChange?.('explore');
    options.onCameraViewChange?.(cameraView);
    canvas.tabIndex = 0; canvas.focus({ preventScroll: true });
  }
  function exitExplore() {
    physics.setDeskClearance(false); enabled = false; releaseCursor(); avatar.root.visible = false; lift?.reset();
    avatar.setBodyView(false);
    display?.setActive(false); options.onScreenMode?.(false); prompt(null);
  }
  return {
    player: avatar.root, update, enterExplore, exitExplore, handleInteract, leaveSeat, togglePointerLock, toggleCameraView,
    inspectDeskView(view: 'third-person' | 'side' | 'front') {
      cameraView = 'thirdPerson'; yaw = view === 'side' ? Math.PI : view === 'front' ? Math.PI / 2 : -Math.PI / 2;
      pitch = view === 'side' ? 0.04 : 0.16; inspectionDistance = view === 'third-person' ? undefined : 3.6;
      options.onCameraViewChange?.(cameraView);
    },
    setCinematicLiftPose(pose: { height: number; openness: number; floor: number }) { return lift?.setCinematicPose(pose) ?? false; },
    get cameraView() { return cameraView; },
    consumeIntentionalUnlock() { const value = intentionalUnlock; intentionalUnlock = false; return value; },
    setEnabled(value: boolean) {
      enabled = value; resetInput();
      display?.setActive(value && mode === 'seated' && !selected?.workstation);
      if (value) canvas.focus({ preventScroll: true });
    },
    setScreenAction(action: string) { display?.setAction(action); },
    setVirtualInput(moveX: number, moveY: number, lookX = 0, lookY = 0, sprint = false) {
      virtual.x = THREE.MathUtils.clamp(moveX, -1, 1); virtual.y = THREE.MathUtils.clamp(moveY, -1, 1); virtual.sprint = sprint; look(lookX, lookY);
    },
    diagnostics: { get state() { return { mode, deskStage, deskTime, feet: feet.toArray(), footContacts: deskStage ? plantedFeet.map(p => p.toArray()) : undefined, bodyYaw, seatWeight, handWeight, chairAngle, gripWeight, chairPosition: workstation?.group.position.toArray() }; }, get lift() { return lift?.state; }, collisionMeshes: physics.meshCount, collisionTriangles: physics.triangleCount, characterAnimations: avatar.animations, screenMeshes: display?.meshes.length ?? 0, chairs: chairs.length, chairApproaches: chairs.map((chair) => ({ id: chair.id, position: chair.approach.toArray(), clear: physics.canStandAt(chair.approach) })) },
    dispose() {
      if (disposed) return; exitExplore(); disposed = true;
      window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', blur);
      canvas.removeEventListener('pointerdown', pointerDown); window.removeEventListener('pointerup', pointerUp); window.removeEventListener('pointermove', pointerMove);
      document.removeEventListener('pointerlockerror', pointerLockFallback);
      avatar.root.removeFromParent(); avatar.dispose(); lift?.dispose(); physics.dispose(); display?.dispose();
    },
  };
}
