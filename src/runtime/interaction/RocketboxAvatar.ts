import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { damping } from './movement';

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
  model.scale.multiplyScalar(1.76 / Math.max(0.1, bounds.max.y - bounds.min.y));
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
  const eyes = [bone('Bip01 LEye'), bone('Bip01 REye')];
  const eyeHeight = eyes.reduce((sum, eye) => sum + eye.getWorldPosition(new THREE.Vector3()).y, 0) / eyes.length;
  const legs = ['L', 'R'].map((side) => {
    const upper = bone(`Bip01 ${side} Thigh`), lower = bone(`Bip01 ${side} Calf`), foot = bone(`Bip01 ${side} Foot`);
    return { upper, lower, foot, ankleHeight: foot.getWorldPosition(new THREE.Vector3()).y };
  });
  actions.idle.setEffectiveWeight(0); actions.sit.setEffectiveWeight(1); mixer.update(0); model.updateMatrixWorld(true);
  const seatedHipHeight = pelvis.getWorldPosition(new THREE.Vector3()).y;
  const seatedEyeOffset = eyes.reduce((sum, eye) => sum + eye.getWorldPosition(new THREE.Vector3()).y, 0) / eyes.length - seatedHipHeight + 0.075;
  actions.sit.setEffectiveWeight(0); actions.idle.setEffectiveWeight(1); mixer.update(0);
  let speedSmoothed = 0;

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
  return {
    root,
    animations: gltf.animations.map((clip) => clip.name),
    view: { eyeHeight, seatedEyeOffset },
    setBodyView(active: boolean) {
      // The source GLB has separate head/hair primitives. Hide only these locally;
      // torso, arms, legs, source rig and the immutable asset stay intact.
      headMeshes.forEach(({ mesh, visible }) => { mesh.visible = active ? false : visible; });
    },
    update(dt: number, speed: number, seated: number, seatHeight = 0.55) {
      speedSmoothed = THREE.MathUtils.lerp(speedSmoothed, speed, damping(10, dt));
      const running = THREE.MathUtils.smoothstep(speedSmoothed, 1.8, 3.4);
      const walking = THREE.MathUtils.smoothstep(speedSmoothed, 0.02, 0.6);
      actions.idle.setEffectiveWeight((1 - walking) * (1 - seated));
      actions.walk.setEffectiveWeight(walking * (1 - running) * (1 - seated));
      actions.run.setEffectiveWeight(walking * running * (1 - seated));
      actions.sit.setEffectiveWeight(seated);
      actions.walk.setEffectiveTimeScale(Math.max(0.5, speedSmoothed / 1.35));
      actions.run.setEffectiveTimeScale(Math.max(0.65, speedSmoothed / 3.35));
      mixer.update(dt);
      // The bone pivot sits inside the pelvis, above the actual cushion contact.
      model.position.y = baseline + (seatHeight + 0.075 - seatedHipHeight) * seated;
      model.updateWorldMatrix(true, true);
      plantFeet(seated);
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
