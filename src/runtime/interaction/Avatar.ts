import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { damping } from './movement';
import { createRocketboxAvatar, type DeskPose } from './RocketboxAvatar';
import { createAssetLoadGuard } from '../rendering/loadingGuard';
import { resolveAssetDependency } from '../rendering/assets';

/** Licensed rigged character. Architecture is always loaded separately from the user's export. */
export async function loadAvatar(url = '/assets/character/RocketboxVisitor.glb') {
  const guard = createAssetLoadGuard(resolveAssetDependency);
  const gltf = await new GLTFLoader(guard.manager).loadAsync(url);
  try { guard.assertLoaded(); }
  catch (error) {
    // No scene lighting has been injected yet: these resources belong entirely
    // to this failed GLTF load, including any secondary scenes sharing them.
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>(), skeletons = new Set<THREE.Skeleton>();
    for (const scene of gltf.scenes) scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      geometries.add(mesh.geometry);
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material) => {
        materials.add(material);
        Object.values(material).forEach((value) => { if (value instanceof THREE.Texture) textures.add(value); });
      });
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) skeletons.add((mesh as THREE.SkinnedMesh).skeleton);
    });
    geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose());
    textures.forEach((texture) => texture.dispose()); skeletons.forEach((skeleton) => skeleton.dispose());
    throw error;
  }
  let rocketbox = false;
  gltf.scene.traverse((object) => { if (object.name.toLowerCase().replace(/[^a-z0-9]/g, '') === 'bip01pelvis') rocketbox = true; });
  if (rocketbox) return createRocketboxAvatar(gltf);
  const root = new THREE.Group(); root.name = 'MD visitor';
  const model = gltf.scene; root.add(model);
  const ownedTextures = new Set<THREE.Texture>();
  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material) => {
        Object.values(material).forEach((value) => { if (value instanceof THREE.Texture) ownedTextures.add(value); });
      });
    }
    if (/pistol|sword|weapon/i.test(object.name)) object.visible = false;
  });
  const mixer = new THREE.AnimationMixer(model);
  const clips = gltf.animations;
  const find = (pattern: RegExp) => clips.find((clip) => pattern.test(clip.name));
  const idleClip = find(/^idle_neutral$/i) ?? find(/^idle$/i);
  const walkClip = find(/^walk$/i);
  const runClip = find(/^run$/i) ?? find(/^sprint$/i);
  const actions = {
    idle: idleClip ? mixer.clipAction(idleClip) : undefined,
    walk: walkClip ? mixer.clipAction(walkClip) : undefined,
    run: runClip ? mixer.clipAction(runClip) : undefined,
  };
  Object.values(actions).forEach((action) => action?.play().setEffectiveWeight(0));
  actions.idle?.setEffectiveWeight(1);
  mixer.update(0);
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  model.scale.multiplyScalar(1.76 / Math.max(0.1, bounds.max.y - bounds.min.y));
  model.updateMatrixWorld(true);
  model.position.y -= new THREE.Box3().setFromObject(model).min.y;
  const baseline = model.position.y;
  model.updateMatrixWorld(true);
  let bodyView = false;
  let head: THREE.Bone | undefined;
  model.traverse((object) => { if ((object as THREE.Bone).isBone && /^head$/i.test(object.name)) head = object as THREE.Bone; });
  const headScale = head?.scale.clone();
  type PoseBone = { bone: THREE.Bone; rest: THREE.Quaternion; target: THREE.Quaternion };
  const seatedBones: PoseBone[] = [];
  const footBindings: { foot: THREE.Bone; lower: THREE.Bone; offset: THREE.Vector3; rotation: THREE.Quaternion }[] = [];
  for (const suffix of ['L', 'R']) {
    const foot = model.getObjectByName(`Foot${suffix}`) ?? model.getObjectByName(`Foot.${suffix}`);
    const lower = model.getObjectByName(`LowerLeg${suffix}`) ?? model.getObjectByName(`LowerLeg.${suffix}`);
    if (foot && lower) footBindings.push({ foot: foot as THREE.Bone, lower: lower as THREE.Bone, offset: lower.worldToLocal(foot.getWorldPosition(new THREE.Vector3())), rotation: foot.quaternion.clone() });
  }
  let hipHeight = 0.93;
  model.traverse((object) => {
    const bone = object as THREE.Bone;
    if (!bone.isBone) return;
    const name = bone.name.toLowerCase();
    let direction: THREE.Vector3 | undefined;
    if (/hips|pelvis/.test(name)) hipHeight = bone.getWorldPosition(new THREE.Vector3()).y;
    if (/(upperleg|upleg|thigh)/.test(name)) direction = new THREE.Vector3(0, -0.08, 1).normalize();
    else if (/(lowerleg|calf|shin)/.test(name)) direction = new THREE.Vector3(0, -1, 0.06).normalize();
    else if (/(upperarm|arm_l|arm_r)/.test(name) && !/fore|lower|hand/.test(name)) {
      direction = new THREE.Vector3(/left|_l|\.l/.test(name) ? 0.1 : -0.1, -1, 0.23).normalize();
    } else if (/forearm|lowerarm/.test(name)) direction = new THREE.Vector3(0, -0.65, 0.76).normalize();
    if (direction) {
      const rest = bone.quaternion.clone();
      const world = bone.getWorldQuaternion(new THREE.Quaternion());
      const currentDirection = new THREE.Vector3(0, 1, 0).applyQuaternion(world).normalize();
      const rotation = new THREE.Quaternion().setFromUnitVectors(currentDirection, direction);
      const parentWorld = bone.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
      const target = parentWorld.invert().multiply(rotation).multiply(world);
      seatedBones.push({ bone, rest, target });
      // Descendants must be solved with their parent's seated orientation.
      bone.quaternion.copy(target); bone.updateWorldMatrix(false, true);
    }
  });
  seatedBones.forEach(({ bone, rest }) => bone.quaternion.copy(rest));
  model.updateMatrixWorld(true);
  let seatWeight = 0, currentSpeed = 0;
  return {
    root,
    animations: clips.map((clip) => clip.name),
    view: { eyeHeight: 1.64, seatedEyeOffset: 0.84 },
    setBodyView(active: boolean) { bodyView = active; if (head && headScale) head.scale.copy(headScale).multiplyScalar(active ? 0.001 : 1); },
    update(dt: number, speed: number, seated: number, seatHeight = 0.55, _contacts?: DeskPose) {
      currentSpeed = THREE.MathUtils.lerp(currentSpeed, speed, damping(10, dt));
      seatWeight = seated;
      const running = THREE.MathUtils.smoothstep(currentSpeed, 1.8, 3.4);
      const walking = THREE.MathUtils.smoothstep(currentSpeed, 0.02, 0.6);
      actions.idle?.setEffectiveWeight(1 - walking * (1 - seatWeight));
      actions.walk?.setEffectiveWeight(walking * (1 - running) * (1 - seatWeight));
      actions.run?.setEffectiveWeight(walking * running * (1 - seatWeight));
      actions.walk?.setEffectiveTimeScale(Math.max(0.6, currentSpeed / 1.35));
      actions.run?.setEffectiveTimeScale(Math.max(0.8, currentSpeed / 3.35));
      mixer.update(dt);
      if (head && headScale) head.scale.copy(headScale).multiplyScalar(bodyView ? 0.001 : 1);
      // Seating is an additive pose over the rig, blended during the approach/stand state.
      // A bespoke motion-captured sit clip can replace this without changing chair anchors.
      for (const item of seatedBones) item.bone.quaternion.slerp(item.target, seatWeight);
      model.position.y = baseline + (seatHeight + 0.10 - hipHeight) * seatWeight;
      model.updateWorldMatrix(true, true);
      for (const binding of footBindings) {
        // This rig's foot controls are siblings of the body, so they must follow the posed shins.
        const world = binding.lower.localToWorld(binding.offset.clone());
        const local = binding.foot.parent!.worldToLocal(world);
        binding.foot.position.lerp(local, seatWeight);
        binding.foot.quaternion.slerp(binding.rotation, seatWeight);
      }
    },
    dispose() {
      mixer.stopAllAction(); mixer.uncacheRoot(model);
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), skeletons = new Set<THREE.Skeleton>();
      model.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh) {
          geometries.add(mesh.geometry);
          (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material) => materials.add(material));
          if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) skeletons.add((mesh as THREE.SkinnedMesh).skeleton);
        }
      });
      geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose());
      skeletons.forEach((skeleton) => skeleton.dispose()); ownedTextures.forEach((texture) => texture.dispose());
    },
  };
}
