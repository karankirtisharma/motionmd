import fs from 'node:fs';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const raw = fs.readFileSync('public/assets/character/RocketboxVisitor.glb');
const length = raw.readUInt32LE(12), json = JSON.parse(raw.subarray(20, 20 + length));
delete json.images; delete json.textures; delete json.samplers;
json.materials = json.materials.map(m => ({name:m.name}));
let encoded = Buffer.from(JSON.stringify(json));
encoded = Buffer.concat([encoded, Buffer.alloc((4 - encoded.length % 4) % 4, 32)]);
const header = Buffer.from(raw.subarray(0,20)); header.writeUInt32LE(20+encoded.length+raw.length-20-length,8); header.writeUInt32LE(encoded.length,12);
const b = Buffer.concat([header,encoded,raw.subarray(20+length)]);
const gltf = await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.length),'');
const mixer = new T.AnimationMixer(gltf.scene);
const foot = gltf.scene.getObjectByName('Bip01_L_Foot');
const bones=[]; gltf.scene.traverse(o=>{if(o.isBone)bones.push(o.name)});
const actualFoot = foot ?? gltf.scene.getObjectByName(bones.find(n=>n.toLowerCase().replace(/[^a-z0-9]/g,'')==='bip01lfoot'));
const results=[];
for(const clip of gltf.animations){
 mixer.stopAllAction(); const a=mixer.clipAction(clip).play();
 const samples=[];
 for(let i=0;i<120;i++){a.time=i/120*clip.duration;mixer.update(0);gltf.scene.updateMatrixWorld(true);samples.push(actualFoot.getWorldPosition(new T.Vector3()).toArray())}
 const z=samples.map(s=>s[2]), y=samples.map(s=>s[1]);
 results.push({name:clip.name,duration:clip.duration,forwardPeakPhase:z.indexOf(Math.max(...z))/120,minY:Math.min(...y),maxY:Math.max(...y),minZ:Math.min(...z),maxZ:Math.max(...z)});
}
console.log(JSON.stringify({bones: bones.filter(n=>/spine|pelvis/i.test(n)),clips:results},null,2));
