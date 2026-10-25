/** Restore original leaf textures without modifying geometry, atlases or the source blend. */
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import{fileURLToPath}from'node:url';
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),root=path.resolve(app,'../..'),assets=path.join(app,'public/assets');
const json=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const manifestPath=path.join(assets,'scene-manifest.json'),manifest=json(manifestPath),extracted=json(path.join(root,'outputs/extracted-textures/manifest.json'));
const sourceParameters=json(path.join(root,'work/foliage-source-parameters.json'));
const outputDir=path.join(assets,'source-materials');fs.mkdirSync(outputDir,{recursive:true});
const definitions=[{name:'potted_plant_01_leaves',prefix:'potted-leaves',images:{map:'potted_plant_01_leaves_diff.png',normalMap:'potted_plant_01_leaves_nor_gl.png',roughnessMap:'potted_plant_01_leaves_rough.png'}},{name:'shrub_01',prefix:'shrub',images:{map:'shrub_01_diff',normalMap:'shrub_01_nor_gl',roughnessMap:'shrub_01_rough'}}];
const report={sourceSHA256:manifest.source.sha256,geometryChanged:false,originalImagesReencoded:false,sourceUVChannel:0,materials:[],limitations:['Source subsurface scattering is recorded but not replaced with invented transmission.','Room reflection probes approximate leaf diffuse illumination; no per-leaf unique lightmap is used.']};
for(const definition of definitions){
 const source=sourceParameters.find(x=>x.name===definition.name);if(!source)throw Error('Missing exact Blender material probe');
 const principled=source.nodes.find(n=>n.type==='ShaderNodeBsdfPrincipled');const val=name=>principled.inputs.find(s=>s.name===name).value;
 const metallic=source.nodes.find(n=>n.name==='Math.002');if(metallic.operation!=='MULTIPLY'||metallic.inputs[1].value!==0)throw Error('Unexpected metallic source graph');
 const maps={},records=[];
 for(const [slot,imageName]of Object.entries(definition.images)){
  const image=extracted.find(x=>x.image===imageName);if(!image)throw Error(`Missing extracted source ${imageName}`);
  const data=fs.readFileSync(path.join(root,'outputs/extracted-textures',image.file));if(sha(data)!==image.sha256)throw Error(`Source texture hash mismatch ${imageName}`);
  if(data[0]!==255||data[1]!==216||data[2]!==255)throw Error('Expected actual JPEG payload');
  const filename=`${definition.prefix}-${slot}.jpg`;fs.writeFileSync(path.join(outputDir,filename),data);maps[slot]=`/assets/source-materials/${filename}`;
  records.push({slot,sourceImage:imageName,url:maps[slot],sha256:image.sha256,bytes:data.length,size:image.size,colorSpace:slot==='map'?'sRGB':'linear data'});
 }
 const entries=manifest.materials.filter(entry=>entry.name.endsWith(`__${definition.name}`));if(!entries.length)throw Error(`Material not used ${definition.name}`);
 for(const entry of entries){
  const chunkId=entry.name.split('__')[0],chunk=manifest.chunks.find(c=>c.id===chunkId),bytes=fs.readFileSync(path.join(app,'public',chunk.url)),gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
  const index=gltf.materials.findIndex(m=>m.name===entry.name);const primitives=gltf.meshes.flatMap(mesh=>mesh.primitives).filter(p=>p.material===index);
  if(!primitives.length||primitives.some(p=>p.attributes.TEXCOORD_0===undefined))throw Error(`${entry.name}: source UV0 unavailable`);
  if(entry.lightMap)entry.supersededBake={url:entry.lightMap,uvChannel:entry.uvChannel,reason:'Small leaf UV charts cannot retain their original texture detail and stable diffuse irradiance.'};
  delete entry.lightMap;delete entry.lightMapMode;delete entry.lightMapIntensity;delete entry.uvChannel;delete entry.bakeConvention;
  entry.sourcePBR={uvChannel:0,...maps,baseColor:[1,1,1],roughness:1,metalness:0,normalScale:[1,1],clearcoat:val('Coat Weight'),clearcoatRoughness:val('Coat Roughness'),ior:val('IOR'),doubleSided:!source.backfaceCulling,opacity:1,lighting:'probe',normalBasis:'uv-derivatives',sourceMaterial:definition.name,sourceSubsurface:{weight:val('Subsurface Weight'),radius:val('Subsurface Radius'),scale:val('Subsurface Scale'),reproduced:false}};
  report.materials.push({name:entry.name,primitives:primitives.length,sourceUV0Verified:true,parameters:entry.sourcePBR,textures:records,alpha:'Original source JPEG has opaque alpha; source 1-(alpha<0.5) evaluates to one.'});
 }
}
manifest.sourceMaterialRestoration={report:'/assets/source-materials/materials.json',materials:report.materials.map(m=>m.name)};
fs.writeFileSync(path.join(outputDir,'materials.json'),JSON.stringify(report,null,2));fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
console.log(JSON.stringify({materials:report.materials.map(m=>m.name),textures:6,geometryChanged:false,sourceUVChannel:0}));
