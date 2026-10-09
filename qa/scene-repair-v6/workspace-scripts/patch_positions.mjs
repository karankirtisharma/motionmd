import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {Matrix4,Vector3,Quaternion} from '../../outputs/md-lounge-web/node_modules/three/build/three.module.js';
import {MeshoptDecoder,MeshoptEncoder} from '../../outputs/md-lounge-web/node_modules/meshoptimizer/index.js';
await Promise.all([MeshoptDecoder.ready,MeshoptEncoder.ready]);
const root=process.cwd(),work=path.join(root,'work/scene-repair-v6'),out=path.join(root,'outputs/scene-repair-v6');
const file=path.join(root,'outputs/md-lounge-web/public/assets/precision-v3/geometry/studio.glb');
const raw=fs.readFileSync(file),n=raw.readUInt32LE(12),j=JSON.parse(raw.subarray(20,20+n)),bin=raw.subarray(28+n);
const src=fs.readFileSync(path.join(work,'moved-source-world.f32'));const points=new Float32Array(src.buffer,src.byteOffset,src.length/4);const cells=new Map(),scale=10000;
const key=(x,y,z)=>`${x},${y},${z}`;
for(let i=0;i<points.length;i+=3){const p=[points[i],points[i+2],-points[i+1]];const k=key(...p.map(v=>Math.round(v*scale)));const arr=cells.get(k)??[];arr.push(p);cells.set(k,arr);}
const matched=(p)=>{let [x,y,z]=p.toArray().map(v=>Math.round(v*scale));for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++){const a=cells.get(key(x+dx,y+dy,z+dz));if(a?.some(q=>Math.hypot(q[0]-p.x,q[1]-p.y,q[2]-p.z)<.000025))return true;}return false;};
const changed=new Map(),records=[];
for(const node of j.nodes.filter(n=>n.mesh!==undefined)){
 const matrix=node.matrix?new Matrix4().fromArray(node.matrix):new Matrix4().compose(new Vector3(...(node.translation??[0,0,0])),new Quaternion(...(node.rotation??[0,0,0,1])),new Vector3(...(node.scale??[1,1,1])));const inverse=matrix.clone().invert();
 for(const primitive of j.meshes[node.mesh].primitives){
  const a=j.accessors[primitive.attributes.POSITION],view=j.bufferViews[a.bufferView],ext=view.extensions.EXT_meshopt_compression;if(ext.filter&&ext.filter!=='NONE')throw Error('Position quantization not permitted');
  const bytes=new Uint8Array(ext.count*ext.byteStride);MeshoptDecoder.decodeGltfBuffer(bytes,ext.count,ext.byteStride,bin.subarray(ext.byteOffset,ext.byteOffset+ext.byteLength),ext.mode,ext.filter);
  const data=new DataView(bytes.buffer),p=new Vector3();let moved=0;const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<a.count;i++){const o=(a.byteOffset??0)+i*ext.byteStride;p.set(data.getFloat32(o,true),data.getFloat32(o+4,true),data.getFloat32(o+8,true));const local=p.clone();p.applyMatrix4(matrix);
   if(p.x>17.3&&p.x<20&&p.z< -31&&p.z> -35&&p.y<2&&matched(p)){p.z+=2.35;p.applyMatrix4(inverse);data.setFloat32(o,p.x,true);data.setFloat32(o+4,p.y,true);data.setFloat32(o+8,p.z,true);moved++;}else p.copy(local);
   for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],data.getFloat32(o+k*4,true));hi[k]=Math.max(hi[k],data.getFloat32(o+k*4,true));}
  }
  a.min=lo;a.max=hi;
  if(moved){const encoded=MeshoptEncoder.encodeGltfBuffer(bytes,ext.count,ext.byteStride,ext.mode);const roundtrip=new Uint8Array(bytes.length);MeshoptDecoder.decodeGltfBuffer(roundtrip,ext.count,ext.byteStride,encoded,ext.mode);if(!Buffer.from(roundtrip).equals(Buffer.from(bytes)))throw Error('Lossless encode failed');changed.set(a.bufferView,encoded);}
  records.push({material:j.materials[primitive.material].name,vertices:a.count,moved});
 }
}
if(records.reduce((s,r)=>s+r.moved,0)<210000)throw Error('Unexpectedly small ownership match');
const parts=[];let length=0;const append=(b)=>{const pad=(4-length%4)%4;if(pad){parts.push(Buffer.alloc(pad));length+=pad;}const offset=length;parts.push(b);length+=b.length;return offset;};
for(let i=0;i<j.bufferViews.length;i++){const v=j.bufferViews[i],e=v.extensions?.EXT_meshopt_compression;if(e){const b=changed.get(i)??bin.subarray(e.byteOffset,e.byteOffset+e.byteLength);e.byteOffset=append(b);e.byteLength=b.length;}else if(v.buffer===0){const b=bin.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength);v.byteOffset=append(b);}}
const pad=(4-length%4)%4;if(pad){parts.push(Buffer.alloc(pad));length+=pad;}j.buffers[0].byteLength=length;
const json=Buffer.from(JSON.stringify(j)),padded=Buffer.alloc(Math.ceil(json.length/4)*4,32);json.copy(padded);const h=Buffer.alloc(20),bh=Buffer.alloc(8);h.writeUInt32LE(0x46546c67);h.writeUInt32LE(2,4);h.writeUInt32LE(28+padded.length+length,8);h.writeUInt32LE(padded.length,12);h.writeUInt32LE(0x4e4f534a,16);bh.writeUInt32LE(length);bh.writeUInt32LE(0x004e4942,4);
const result=Buffer.concat([h,padded,bh,...parts]);fs.writeFileSync(path.join(work,'studio-v6.glb'),result);
const report={source:file,bytes:result.length,sha256:createHash('sha256').update(result).digest('hex'),movedVertices:records.reduce((s,r)=>s+r.moved,0),records,uvNormalIndexMaterialPayloads:'unchanged bytes; only owned source vertex positions translated',deltaWeb:[0,0,2.35]};fs.writeFileSync(path.join(out,'web-layout-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({bytes:report.bytes,movedVertices:report.movedVertices,materials:records.length}));
