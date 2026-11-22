// Offline only. Replaces locomotion channel definitions, appending buffers;
// source mesh, skin, material, node definitions, Idle and Sit remain unchanged.
import fs from 'node:fs';import crypto from 'node:crypto';import path from 'node:path';
import * as T from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {load,pack} from './glb-utils.mjs';
const [input,fbxDirectory,output,metadataDirectory]=process.argv.slice(2);
if(!input||!fbxDirectory||!output||!metadataDirectory)throw new Error('Usage: node scripts/retarget-locomotion.mjs <original-character.glb> <FBX-directory> <candidate.glb> <metadata-directory>');
if(path.resolve(input).toLowerCase()===path.resolve(output).toLowerCase() || (fs.existsSync(output)&&fs.realpathSync(input).toLowerCase()===fs.realpathSync(output).toLowerCase()))throw new Error('Refusing to overwrite source character. Use a separate candidate path.');
fs.mkdirSync(metadataDirectory,{recursive:true});
const {json,bin,gltf,bytes}=await load(input);
if(json.animations.some(a=>a.extras?.locomotion?.phaseAligned))throw new Error('Input is already retargeted. Use the original character checkpoint.');
const target=gltf.scene;target.updateMatrixWorld(true);
const rest=[];target.traverse(o=>{if(o.isBone)rest.push({b:o,q:o.quaternion.clone(),p:o.position.clone()});});
const reset=()=>{for(const r of rest){r.b.quaternion.copy(r.q);r.b.position.copy(r.p);}target.updateMatrixWorld(true);};
const get=n=>target.getObjectByName('Bip01_'+n),wp=b=>b.getWorldPosition(new T.Vector3()),wq=b=>b.getWorldQuaternion(new T.Quaternion());
const setQ=(b,q)=>{b.quaternion.copy(wq(b.parent).invert().multiply(q));b.updateWorldMatrix(false,true);};
const nativeMixer=new T.AnimationMixer(target);nativeMixer.clipAction(gltf.animations.find(c=>c.name==='Idle')).play();nativeMixer.update(0);target.updateMatrixWorld(true);
const nativeFootFrames=['L','R'].map(side=>({foot:wq(get(side+'_Foot')),toe:wq(get(side+'_Toe0'))}));
const gazeLocal=new T.Vector3(0,0,1).applyQuaternion(wq(get('Head')).invert());
nativeMixer.stopAllAction();reset();
const map={Pelvis:'Hips',Spine:'Spine',Spine1:'Spine1',Spine2:'Spine2',Neck:'Neck',Head:'Head'};
for(const [side,word] of [['L','Left'],['R','Right']]){for(const [a,b] of Object.entries({Clavicle:'Shoulder',UpperArm:'Arm',Forearm:'ForeArm',Hand:'Hand',Thigh:'UpLeg',Calf:'Leg',Foot:'Foot',Toe0:'ToeBase'}))map[`${side}_${a}`]=word+b;for(const [digit,wordDigit]of ['Thumb','Index','Middle','Ring','Pinky'].entries())for(let segment=0;segment<3;segment++)map[`${side}_Finger${digit}${segment?segment:''}`]=`${word}Hand${wordDigit}${segment+1}`;}
let chunks=[bin],length=bin.length;
function accessor(values,size){const data=Buffer.from(new Float32Array(values).buffer),view=json.bufferViews.length;json.bufferViews.push({buffer:0,byteOffset:length,byteLength:data.length});chunks.push(data);length+=data.length;const index=json.accessors.length,entry={bufferView:view,componentType:5126,count:values.length/size,type:size===1?'SCALAR':size===3?'VEC3':'VEC4'};if(size===1){entry.min=[Math.min(...values)];entry.max=[Math.max(...values)];}json.accessors.push(entry);return index;}
const report={sourceSha256:crypto.createHash('sha256').update(bytes).digest('hex'),unchanged:['nodes','meshes','skins','materials','textures','images','Idle','Sit'],rejected:['Descending Stairs.fbx','Descending Stairs (1).fbx: hips descend ~50cm while ankles are clamped to original floor, producing a deep crouch.'],clips:[]};
const configs=[{file:'Walking',name:'Walk',touch:.333333,right:.833333},{file:'Running',name:'Run',touch:.266667,right:.666667},{file:'Ascending Stairs',name:'StairUp',touch:.233333,right:.966667},{file:'Walking',name:'StairDown',touch:.333333,right:.833333},{file:'Running Up Stairs',name:'StairRunUp',touch:.166667,right:.466667}];
for(const cfg of configs){
 reset();const data=fs.readFileSync(path.join(fbxDirectory,`${cfg.file}.fbx`)),source=new FBXLoader().parse(data.buffer.slice(data.byteOffset,data.byteOffset+data.length),'');source.updateMatrixWorld(true);
 const sb=n=>source.getObjectByName('mixamorig'+n),sp=n=>wp(sb(n));
 const legLength=wp(get('L_Thigh')).distanceTo(wp(get('L_Calf')))+wp(get('L_Calf')).distanceTo(wp(get('L_Foot'))),sourceLeg=sp('LeftUpLeg').distanceTo(sp('LeftLeg'))+sp('LeftLeg').distanceTo(sp('LeftFoot')),scale=legLength/sourceLeg;
 // Match the anatomical reference directions before obtaining rest-space offsets.
 // Keep the destination skin rest matrices intact: this is a retarget reference,
 // not an applied rest-pose modification.
 for(const side of ['L','R'])for(const [a,b] of [['Thigh','Calf'],['Calf','Foot'],['Foot','Toe0'],['UpperArm','Forearm'],['Forearm','Hand'],['Hand','Finger2']]){
  const bone=get(`${side}_${a}`),end=get(`${side}_${b}`),from=wp(end).sub(wp(bone)).normalize(),to=sp(map[`${side}_${b}`]).sub(sp(map[`${side}_${a}`])).normalize();setQ(bone,new T.Quaternion().setFromUnitVectors(from,to).multiply(wq(bone)));
 }
 // Direction-only toe matching left an 8 degree sole-roll error. The source
 // flat reference must map to the target's full flat-foot orientation, not just
 // its ankle-to-toe vector. Preserve the target's natural outward foot yaw.
 for(const [index,side] of ['L','R'].entries()){setQ(get(side+'_Foot'),nativeFootFrames[index].foot);setQ(get(side+'_Toe0'),nativeFootFrames[index].toe);}
 const bindings=[];target.traverse(b=>{const suffix=b.name.replace(/^Bip01_/,''),s=sb(map[suffix]);if(b.isBone&&s)bindings.push({b,s,offset:wq(s).invert().multiply(wq(b)),q:[],p:[],position:b.position.clone()});});
 const pelvis=get('Pelvis'),pelvisRest=wp(pelvis),pelvisQ=wq(pelvis),sourceHipRest=sp('Hips'),hipAnchors=['L','R'].map(side=>wp(get(`${side}_Thigh`)).sub(pelvisRest).applyQuaternion(pelvisQ.clone().invert()));
 const chest=get('Spine2'),shoulderAnchors=['L','R'].map(side=>wp(get(side+'_Clavicle')).sub(wp(chest)).applyQuaternion(wq(chest).invert()));
 const clip=source.animations[0],duration=clip.duration,mixer=new T.AnimationMixer(source),action=mixer.clipAction(clip);action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();
 const at=t=>{mixer.setTime(Math.min(duration-1e-7,Math.max(0,t)));source.updateMatrixWorld(true);return sp('Hips');};
 const headBinding=bindings.find(b=>b.b===get('Head'));
 let meanGaze=0;for(let i=0;i<60;i++){at(i/60*duration);const direction=gazeLocal.clone().applyQuaternion(wq(headBinding.s).multiply(headBinding.offset));meanGaze+=Math.asin(T.MathUtils.clamp(direction.y,-1,1))/60;}
 // Match the neutral look direction across locomotion clips. A 40 degree gaze
 // difference between the source stair walk/run was visible as a neck snap.
 // Keep all source oscillation; remove only the constant per-clip offset.
 const gazeCorrection=cfg.name==='Walk'||cfg.name==='StairDown'?0:meanGaze;
 const start=at(0),end=at(duration),drift=end.clone().sub(start),samples=[],frames=60,times=[];
 const raw=(phase)=>{const f=phase<.5?cfg.touch+phase*2*(cfg.right-cfg.touch):cfg.right+(phase-.5)*2*(duration-(cfg.right-cfg.touch));return {time:f%duration,wrap:Math.floor(f/duration)};};
 for(let i=0;i<=frames;i++){
  const phase=i/frames,{time}=raw(phase===1?0:phase),hip=at(time),trend=start.clone().addScaledVector(drift,time/duration);
  // Remove global root displacement. Keep authored vertical/lateral weight transfer.
  const offset=hip.clone().sub(trend).multiplyScalar(scale);offset.z=0;
  // Retain the authored baseline crouch as well as bob. Subtracting the first
  // sample here would erase the run's 11cm hip compression and float the feet.
  offset.y=(hip.y-sourceHipRest.y-drift.y*time/duration)*scale;
  // Stay near the native rig's upright baseline; contact adaptation handles treads.
  const worldHip=pelvisRest.clone().add(offset);
  pelvis.position.copy(pelvis.parent.worldToLocal(worldHip));pelvis.updateWorldMatrix(false,true);
  for(const b of bindings){let desired=wq(b.s).multiply(b.offset);if(b.b===get('Neck')||b.b===get('Head'))desired.premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),gazeCorrection*(b.b===get('Neck')?.6:1)));setQ(b.b,desired);if(/Bip01_[LR]_Clavicle/.test(b.b.name)){const side=b.b.name.includes('_L_')?0:1;const goal=shoulderAnchors[side].clone().applyQuaternion(wq(chest)).add(wp(chest));b.b.position.copy(b.b.parent.worldToLocal(goal));b.b.updateWorldMatrix(false,true);}if(/Bip01_[LR]_Thigh/.test(b.b.name)){const side=b.b.name.includes('_L_')?0:1;const goal=hipAnchors[side].clone().applyQuaternion(wq(pelvis)).add(wp(pelvis));b.b.position.copy(b.b.parent.worldToLocal(goal));b.b.updateWorldMatrix(false,true);}b.b.quaternion.toArray(b.q,b.q.length);b.b.position.toArray(b.p,b.p.length);}
  times.push(phase*duration);samples.push({phase,hip:wp(pelvis).toArray(),left:wp(get('L_Foot')).toArray(),right:wp(get('R_Foot')).toArray(),toeL:wp(get('L_Toe0')).toArray(),toeR:wp(get('R_Toe0')).toArray()});
 }
 const stanceFraction=cfg.name==='Run'?.30:cfg.name==='StairRunUp'?.38:.50;
 const animation={name:cfg.name,extras:{locomotion:{stride:Math.abs(drift.z)*scale,stanceFraction,phaseAligned:true}},samplers:[],channels:[]},ta=accessor(times,1);
 for(const b of bindings){const node=json.nodes.findIndex(n=>n.name?.replace(/[^a-zA-Z0-9_]/g,'_')===b.b.name);if(node<0)throw new Error(`Missing ${b.b.name}`);for(const [path,values,size]of [['rotation',b.q,4],['translation',b.p,3]]){const sampler=animation.samplers.length;animation.samplers.push({input:ta,output:accessor(values,size),interpolation:'LINEAR'});animation.channels.push({sampler,target:{node,path}});}}
 json.animations=json.animations.filter(a=>a.name!==cfg.name);json.animations.push(animation);
 const entry={name:cfg.name,file:`${cfg.file}.fbx`,sha256:crypto.createHash('sha256').update(data).digest('hex'),duration,cycleStride:Math.abs(drift.z)*scale,sourceRise:drift.y*scale,gazeCorrectionDegrees:gazeCorrection*180/Math.PI,sourceTouchdown:[cfg.touch,cfg.right],phaseTouchdown:[0,.5],scale,legLength,sourceLeg};report.clips.push(entry);
 fs.writeFileSync(path.join(metadataDirectory,`${cfg.name}-samples.json`),JSON.stringify(samples));
}
json.buffers[0].byteLength=length;const candidate=pack(json,Buffer.concat(chunks));fs.writeFileSync(output,candidate);fs.writeFileSync(path.join(metadataDirectory,'locomotion-metadata.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
