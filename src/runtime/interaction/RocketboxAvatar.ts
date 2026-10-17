import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { damping } from './movement';

export type DeskPose = {
  hands: THREE.Vector3[]; feet: THREE.Vector3[]; handWeight: number; footWeight: number;
  upright: number; deskHeight: number; deskFront?: number;
  hipOffset?: number;
  feetYaw?: number[];
};

/** MIT Rocketbox source motions, with local root drift removed in the export. */
export function createRocketboxAvatar(gltf: GLTF) {
  const root = new THREE.Group(); root.name = 'MD visitor';
  const model = gltf.scene; root.add(model);
  const ownedTextures = new Set<THREE.Texture>();
  const headMeshes: Array<{ mesh: THREE.Mesh; visible: boolean }> = [];
  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
      // Capture ownership before the renderer adds its shared PMREM environment.
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material) => {
        Object.values(material).forEach((value) => { if (value instanceof THREE.Texture) ownedTextures.add(value); });
      });
      if ((Array.isArray(mesh.material) ? mesh.material : [mesh.material]).every((material) => /m005_(head|opacity)/i.test(material.name))) {
        headMeshes.push({ mesh, visible: mesh.visible });
      }
    }
  });
  const mixer = new THREE.AnimationMixer(model);
  const action = (name: string) => {
    const clip = gltf.animations.find((value) => value.name.toLowerCase() === name.toLowerCase());
    if (!clip) throw new Error(`The visitor character is missing its ${name} animation.`);
    return mixer.clipAction(clip).play().setEffectiveWeight(0);
  };
  const actions = { idle: action('Idle'), walk: action('Walk'), run: action('Run'), sit: action('Sit') };
  actions.idle.setEffectiveWeight(1); mixer.update(0); model.updateMatrixWorld(true);
  let bounds = new THREE.Box3().setFromObject(model);
  model.scale.multiplyScalar(1.86 / Math.max(0.1, bounds.max.y - bounds.min.y));
  model.updateMatrixWorld(true); bounds = new THREE.Box3().setFromObject(model);
  model.position.y -= bounds.min.y;
  const baseline = model.position.y;
  model.updateMatrixWorld(true);
  const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
  function bone(name: string) {
    let found: THREE.Bone | undefined;
    model.traverse((object) => { if ((object as THREE.Bone).isBone && normalize(object.name) === normalize(name)) found = object as THREE.Bone; });
    if (!found) throw new Error(`The visitor rig is missing ${name}.`);
    return found;
  }
  const pelvis = bone('Bip01 Pelvis');
  const spine = bone('Bip01 Spine');
  const eyes = [bone('Bip01 LEye'), bone('Bip01 REye')];
  const eyeHeight = eyes.reduce((sum, eye) => sum + eye.getWorldPosition(new THREE.Vector3()).y, 0) / eyes.length;
  const legs = ['L', 'R'].map((side) => {
    const upper = bone(`Bip01 ${side} Thigh`), lower = bone(`Bip01 ${side} Calf`), foot = bone(`Bip01 ${side} Foot`);
    return { upper, lower, foot, ankleHeight: foot.getWorldPosition(new THREE.Vector3()).y };
  });
  const uprightSpine = [spine, bone('Bip01 Spine1'), bone('Bip01 Spine2')].map(b => ({ bone: b, orientation: b.getWorldQuaternion(new THREE.Quaternion()) }));
  const arms = ['L', 'R'].map((side, index) => {
    const upper = bone(`Bip01 ${side} UpperArm`), lower = bone(`Bip01 ${side} Forearm`), hand = bone(`Bip01 ${side} Hand`);
    const middle = bone(`Bip01 ${side} Finger2`), first = bone(`Bip01 ${side} Finger1`), little = bone(`Bip01 ${side} Finger4`);
    const handQ = hand.getWorldQuaternion(new THREE.Quaternion());
    const forward = middle.getWorldPosition(new THREE.Vector3()).sub(hand.getWorldPosition(new THREE.Vector3())).normalize();
    const across = first.getWorldPosition(new THREE.Vector3()).sub(little.getWorldPosition(new THREE.Vector3()));
    across.addScaledVector(forward, -across.dot(forward)).normalize();
    const normal = new THREE.Vector3().crossVectors(forward, across).normalize();
    const sourceBasis = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, normal, forward));
    const localBasis = handQ.invert().multiply(sourceBasis);
    const fingers = [0, 1, 2, 3, 4].map(f => ['', '1', '2'].map(suffix => bone(`Bip01 ${side} Finger${f}${suffix}`)));
    return { upper, lower, hand, localBasis, fingers, sign: index === 0 ? 1 : -1 };
  });
  actions.idle.setEffectiveWeight(0); actions.sit.setEffectiveWeight(1); mixer.update(0); model.updateMatrixWorld(true);
  const seatedHipHeight = pelvis.getWorldPosition(new THREE.Vector3()).y;
  const seatedEyeOffset = eyes.reduce((sum, eye) => sum + eye.getWorldPosition(new THREE.Vector3()).y, 0) / eyes.length - seatedHipHeight + 0.075;
  actions.sit.setEffectiveWeight(0); actions.idle.setEffectiveWeight(1); mixer.update(0);
  const animatedPose: Array<{ bone: THREE.Bone; quaternion: THREE.Quaternion; position: THREE.Vector3; scale: THREE.Vector3 }> = [];
  model.traverse(object => { if ((object as THREE.Bone).isBone) animatedPose.push({ bone: object as THREE.Bone, quaternion: object.quaternion.clone(), position: object.position.clone(), scale: object.scale.clone() }); });
  let speedSmoothed = 0, gaitPhase = 0, previousYaw = root.rotation.y;
  let forwardLean = 0, sideLean = 0;
  const walkDuration = actions.walk.getClip().duration, runDuration = actions.run.getClip().duration;
  // Source left-foot forward peaks are at .242 (walk) and .292 (run).
  // Drive both loops from one distance-based phase so sprint blends keep the same supporting leg.
  actions.walk.paused = true; actions.run.paused = true;
  const parentRotation = new THREE.Quaternion(), localRotation = new THREE.Quaternion();
  const worldRotation = new THREE.Quaternion(), leanRotation = new THREE.Quaternion();
  const rightAxis = new THREE.Vector3(), forwardAxis = new THREE.Vector3();

  function setWorldQuaternion(object: THREE.Object3D, quaternion: THREE.Quaternion) {
    const parent = object.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
    object.quaternion.copy(parent.invert().multiply(quaternion));
    object.updateWorldMatrix(false, true);
  }
  function plantFeet(weight: number) {
    if (weight < 0.001) return;
    const floor = root.getWorldPosition(new THREE.Vector3()).y;
    for (const { upper, lower, foot, ankleHeight } of legs) {
      const hip = upper.getWorldPosition(new THREE.Vector3());
      const knee = lower.getWorldPosition(new THREE.Vector3());
      const ankle = foot.getWorldPosition(new THREE.Vector3());
      const footOrientation = foot.getWorldQuaternion(new THREE.Quaternion());
      const goal = ankle.clone().setY(Math.max(floor + ankleHeight, THREE.MathUtils.lerp(ankle.y, floor + ankleHeight, weight)));
      const upperLength = hip.distanceTo(knee), lowerLength = knee.distanceTo(ankle);
      const axis = goal.clone().sub(hip);
      const distance = THREE.MathUtils.clamp(axis.length(), Math.abs(upperLength - lowerLength) + 0.001, upperLength + lowerLength - 0.001);
      axis.normalize();
      const bend = knee.clone().sub(hip).addScaledVector(axis, -knee.clone().sub(hip).dot(axis));
      if (bend.lengthSq() < 0.000001) bend.set(0, 0, 1).applyQuaternion(root.quaternion);
      bend.normalize();
      const along = (upperLength * upperLength + distance * distance - lowerLength * lowerLength) / (2 * distance);
      const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
      const solvedKnee = hip.clone().addScaledVector(axis, along).addScaledVector(bend, height);
      const rotateUpper = new THREE.Quaternion().setFromUnitVectors(knee.clone().sub(hip).normalize(), solvedKnee.clone().sub(hip).normalize());
      setWorldQuaternion(upper, rotateUpper.multiply(upper.getWorldQuaternion(new THREE.Quaternion())));
      const currentKnee = lower.getWorldPosition(new THREE.Vector3());
      const currentAnkle = foot.getWorldPosition(new THREE.Vector3());
      const rotateLower = new THREE.Quaternion().setFromUnitVectors(currentAnkle.sub(currentKnee).normalize(), goal.clone().sub(currentKnee).normalize());
      setWorldQuaternion(lower, rotateLower.multiply(lower.getWorldQuaternion(new THREE.Quaternion())));
      setWorldQuaternion(foot, footOrientation);
    }
  }
  function solveLimb(upper: THREE.Bone, lower: THREE.Bone, end: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3) {
    const a = upper.getWorldPosition(new THREE.Vector3()), b = lower.getWorldPosition(new THREE.Vector3()), c = end.getWorldPosition(new THREE.Vector3());
    const l1 = a.distanceTo(b), l2 = b.distanceTo(c), axis = target.clone().sub(a);
    const distance = THREE.MathUtils.clamp(axis.length(), Math.abs(l1 - l2) + 0.0001, l1 + l2 - 0.0001);
    axis.normalize();
    const bend = pole.clone().sub(a); bend.addScaledVector(axis, -bend.dot(axis)).normalize();
    const along = (l1 * l1 + distance * distance - l2 * l2) / (2 * distance);
    const knee = a.clone().addScaledVector(axis, along).addScaledVector(bend, Math.sqrt(Math.max(0, l1 * l1 - along * along)));
    setWorldQuaternion(upper, new THREE.Quaternion().setFromUnitVectors(b.sub(a).normalize(), knee.sub(a).normalize()).multiply(upper.getWorldQuaternion(new THREE.Quaternion())));
    lower.getWorldPosition(b); end.getWorldPosition(c);
    setWorldQuaternion(lower, new THREE.Quaternion().setFromUnitVectors(c.sub(b).normalize(), target.clone().sub(b).normalize()).multiply(lower.getWorldQuaternion(new THREE.Quaternion())));
  }
  function deskPose(pose: DeskPose) {
    const rootQ = root.getWorldQuaternion(new THREE.Quaternion());
    const front = new THREE.Vector3(0, 0, 1).applyQuaternion(rootQ), left = new THREE.Vector3(1, 0, 0).applyQuaternion(rootQ);
    // Remove the source relaxed chair slouch, keeping a slight working inclination.
    const incline = new THREE.Quaternion().setFromAxisAngle(left, 0.24 * pose.handWeight);
    for (const item of uprightSpine) {
      const q = incline.clone().multiply(rootQ).multiply(item.orientation);
      setWorldQuaternion(item.bone, item.bone.getWorldQuaternion(new THREE.Quaternion()).slerp(q, pose.upright));
    }
    legs.forEach((leg, i) => {
      if (pose.footWeight <= 0) return;
      const current = leg.foot.getWorldPosition(new THREE.Vector3());
      const target = current.lerp(pose.feet[i].clone().add(new THREE.Vector3(0, leg.ankleHeight, 0)), pose.footWeight);
      const pole = root.getWorldPosition(new THREE.Vector3()).addScaledVector(front, 1).addScaledVector(left, i === 0 ? 0.15 : -0.15);
      const q = leg.foot.getWorldQuaternion(new THREE.Quaternion());
      solveLimb(leg.upper, leg.lower, leg.foot, target, pole);
      // Feet retain the source's calibrated sole orientation, with toe roll removed below.
      const footQ = pose.feetYaw ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pose.feetYaw[i]) : rootQ.clone();
      setWorldQuaternion(leg.foot, q.slerp(footQ.multiply(standingFootRotations[i]), pose.footWeight));
    });
    arms.forEach((arm, i) => {
      const beforeQ = arm.hand.getWorldQuaternion(new THREE.Quaternion());
      const start = arm.hand.getWorldPosition(new THREE.Vector3());
      // Tuck the desk-side hand during the narrow walking/turning approach.
      if (pose.deskFront !== undefined) start.x = Math.min(start.x, pose.deskFront - 0.15 - 0.10 * pose.upright);
      const goal = pose.hands[i], t = pose.handWeight, r = 1 - t;
      // A lifted Bezier path reaches OVER the edge before the palms settle.
      // The same path runs backwards before standing.
      const c1 = start.clone().setY(Math.max(start.y + 0.24, pose.deskHeight + 0.18));
      const c2 = goal.clone().addScaledVector(front, -0.12).add(new THREE.Vector3(0, 0.18, 0));
      const target = start.clone().multiplyScalar(r * r * r).addScaledVector(c1, 3 * r * r * t).addScaledVector(c2, 3 * r * t * t).addScaledVector(goal, t * t * t);
      const pole = arm.upper.getWorldPosition(new THREE.Vector3()).addScaledVector(left, arm.sign * 0.27).addScaledVector(front, -0.08).add(new THREE.Vector3(0, -0.5, 0));
      solveLimb(arm.upper, arm.lower, arm.hand, target, pole);
      const across = left.clone().multiplyScalar(-arm.sign), normal = new THREE.Vector3().crossVectors(front, across);
      const desired = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, normal, front)).multiply(arm.localBasis.clone().invert());
      setWorldQuaternion(arm.hand, beforeQ.slerp(desired, pose.handWeight));
      // Aim existing finger phalanges along the desktop. Keep thumb opposition and a small spread.
      arm.fingers.forEach((chain, digit) => chain.forEach((joint, segment) => {
        const child = chain[segment + 1] ?? joint.children.find(o => (o as THREE.Bone).isBone);
        if (!child) return;
        const origin = joint.getWorldPosition(new THREE.Vector3());
        const direction = child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
        const desiredDirection = front.clone().addScaledVector(left, digit === 0 ? -arm.sign * 0.6 : arm.sign * (digit - 2.5) * 0.035).normalize();
        const q = joint.getWorldQuaternion(new THREE.Quaternion());
        const goal = new THREE.Quaternion().setFromUnitVectors(direction, desiredDirection).multiply(q);
        setWorldQuaternion(joint, q.slerp(goal, pose.handWeight));
      }));
    });
  }
  const standingFootRotations = legs.map(l => l.foot.getWorldQuaternion(new THREE.Quaternion()));
  return {
    root,
    animations: gltf.animations.map((clip) => clip.name),
    view: { eyeHeight, seatedEyeOffset },
    get locomotion() {
      return { phase: gaitPhase, speed: speedSmoothed, forwardLean, sideLean,
        weights: Object.fromEntries(Object.entries(actions).map(([name, value]) => [name, value.getEffectiveWeight()])) };
    },
    setBodyView(active: boolean) {
      // The source GLB has separate head/hair primitives. Hide only these locally;
      // torso, arms, legs, source rig and the immutable asset stay intact.
      headMeshes.forEach(({ mesh, visible }) => { mesh.visible = active ? false : visible; });
    },
    update(dt: number, speed: number, seated: number, seatHeight = 0.55, contacts?: DeskPose) {
      dt = THREE.MathUtils.clamp(dt, 0, 0.1);
      seated = THREE.MathUtils.clamp(seated, 0, 1);
      const oldSpeed = speedSmoothed;
      speedSmoothed = THREE.MathUtils.lerp(speedSmoothed, Math.max(0, speed), damping(speed < speedSmoothed ? 14 : 9, dt));
      const running = THREE.MathUtils.smoothstep(speedSmoothed, 1.8, 3.4);
      const walking = THREE.MathUtils.smoothstep(speedSmoothed, 0.02, 0.6);
      actions.idle.setEffectiveWeight((1 - walking) * (1 - seated));
      actions.walk.setEffectiveWeight(walking * (1 - running) * (1 - seated));
      actions.run.setEffectiveWeight(walking * running * (1 - seated));
      actions.sit.setEffectiveWeight(seated);
      const stride = THREE.MathUtils.lerp(1.35 * walkDuration, 3.35 * runDuration, running);
      gaitPhase = (gaitPhase + speedSmoothed * (1 - seated) * dt / stride) % 1;
      actions.walk.time = gaitPhase * walkDuration;
      actions.run.time = ((gaitPhase + 0.05) % 1) * runDuration;
      // PropertyMixer skips unchanged tracks. Restore the previous animated pose
      // before sampling, otherwise procedural corrections accumulate on static keys.
      for (const pose of animatedPose) { pose.bone.quaternion.copy(pose.quaternion); pose.bone.position.copy(pose.position); pose.bone.scale.copy(pose.scale); }
      mixer.update(dt);
      for (const pose of animatedPose) { pose.quaternion.copy(pose.bone.quaternion); pose.position.copy(pose.bone.position); pose.scale.copy(pose.bone.scale); }
      const turnRate = dt > 0 ? Math.atan2(Math.sin(root.rotation.y - previousYaw), Math.cos(root.rotation.y - previousYaw)) / dt : 0;
      previousYaw = root.rotation.y;
      const acceleration = dt > 0 ? (speedSmoothed - oldSpeed) / dt : 0;
      const moving = walking * (1 - seated);
      const pitchTarget = THREE.MathUtils.clamp(acceleration * 0.008 + running * 0.035, -0.035, 0.065) * moving;
      const bankTarget = THREE.MathUtils.clamp(-turnRate * speedSmoothed * 0.009, -0.07, 0.07) * moving;
      forwardLean = THREE.MathUtils.lerp(forwardLean, pitchTarget, damping(9, dt));
      sideLean = THREE.MathUtils.lerp(sideLean, bankTarget, damping(9, dt));
      // Add small upper-body weight shifts after the source motion. Feet and collision capsule stay upright.
      // Suppress the layer immediately during sitting; the source sitting/foot IK owns that pose.
      root.getWorldQuaternion(worldRotation);
      rightAxis.set(1, 0, 0).applyQuaternion(worldRotation);
      forwardAxis.set(0, 0, 1).applyQuaternion(worldRotation);
      leanRotation.setFromAxisAngle(rightAxis, forwardLean * (1 - seated));
      localRotation.setFromAxisAngle(forwardAxis, sideLean * (1 - seated));
      leanRotation.multiply(localRotation);
      spine.parent!.getWorldQuaternion(parentRotation);
      localRotation.copy(parentRotation).invert().multiply(leanRotation).multiply(parentRotation);
      spine.quaternion.premultiply(localRotation);
      // The bone pivot sits inside the pelvis, above the actual cushion contact.
      model.position.y = baseline + (seatHeight + (contacts?.hipOffset ?? 0.075) - seatedHipHeight) * seated;
      model.updateWorldMatrix(true, true);
      plantFeet(seated);
      if (contacts) deskPose(contacts);
    },
    dispose() {
      mixer.stopAllAction(); mixer.uncacheRoot(model);
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), skeletons = new Set<THREE.Skeleton>();
      model.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        geometries.add(mesh.geometry);
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material) => materials.add(material));
        if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) skeletons.add((mesh as THREE.SkinnedMesh).skeleton);
      });
      geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose());
      skeletons.forEach((skeleton) => skeleton.dispose()); ownedTextures.forEach((texture) => texture.dispose());
    },
  };
}
