"""Bake corrected exterior receiver geometry; original Blender source is immutable.

Inputs come from qa/export-exterior-lighting.mjs after all geometry repairs. A
separate UV channel stores irradiance; source texture coordinates are untouched.
Run Blender in background with the source .blend and --work outside the website.
"""
import bpy,json,sys,argparse,time,hashlib,shutil,os
import numpy as np
from pathlib import Path
from mathutils import Vector
p=argparse.ArgumentParser();p.add_argument('--work',type=Path,required=True);p.add_argument('--samples',type=int,default=256);p.add_argument('--size',type=int,default=2048)
args=p.parse_args(sys.argv[sys.argv.index('--')+1:]);work=args.work.resolve();work.mkdir(parents=True,exist_ok=True)
started=time.time();root=Path(__file__).resolve().parents[2];source=Path(bpy.data.filepath).resolve()
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for b in iter(lambda:f.read(8*1024*1024),b''):h.update(b)
 return h.hexdigest()
source_hash=sha(source);checkpoint=work.parent/'source-before-exterior-finish.blend'
if not checkpoint.exists():shutil.copy2(source,checkpoint)
assert sha(checkpoint)==source_hash,'Geometry backup mismatch'
manifest=json.loads((root/'public/assets/scene-manifest.json').read_text(encoding='utf8'));data=json.loads((work/'receivers.json').read_text())
scene=bpy.context.scene
# These are the exact low slab objects represented by the exported receivers.
hide_names=['Arrival terrace','Rear terrace','EH52 relocated arrival terrace','MF25 studio front floor support','WG53 outboard foundation','EXT77 | studio front terrace','EXT77 | studio front connector','EXT77 | founder front terrace','EXT77 | founder terrace return','EXT77 | left side paving','EXT77 | right side paving','EXT77 | entry stair lower','EXT77 | entry stair upper','PL78 | extension foundation','FR80 | right paved foundation apron']
if data.get('occluders'):hide_names.append('EH52 vestibule ground finish')
hidden=[]
for name in hide_names:
 obj=scene.objects.get(name)
 if obj:obj.hide_render=True;hidden.append(name)
# Build one atlas with welded geometric vertices but retain ordered corner normals
# and an explicit face range for each website mesh.
verts=[];faces=[];normals=[];lookup={};ranges=[]
for row in data['receivers']:
 start=len(faces);corners=np.asarray(row['positions']).reshape(-1,3)
 for tri in corners.reshape(-1,3,3):
  ids=[]
  for v in tri:
   key=tuple(round(float(x),6) for x in v)
   if key not in lookup:lookup[key]=len(verts);verts.append(v.tolist())
   ids.append(lookup[key])
  assert len(set(ids))==3, f"Degenerate source triangle in {row['sourceMesh']} at receiver face {len(faces)-start}"
  faces.append(ids)
 normals.extend(np.asarray(row['normals']).reshape(-1,3).tolist());ranges.append((start,len(faces)))
tri=np.asarray(verts)[np.asarray(faces)];area2=np.linalg.norm(np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]),axis=1)
assert np.isfinite(tri).all() and np.isfinite(normals).all() and (area2>1e-14).all(), 'Invalid receiver geometry'
mesh=bpy.data.meshes.new('Exterior finish corrected geometry');mesh.from_pydata(verts,[],faces);mesh.update()
for poly in mesh.polygons:poly.use_smooth=True
mesh.normals_split_custom_set(normals)
receiver=bpy.data.objects.new('Exterior finish lighting receiver',mesh);scene.collection.objects.link(receiver)
material=bpy.data.materials['EH54 | scanned cream limestone panels'].copy();material.name='Exterior finish source limestone';mesh.materials.append(material)
# Add the retained indoor shape where the original marble apron was cut back.
for row in data.get('occluders',[]):
 g=bpy.data.meshes.new(row['name']);co=np.asarray(row['positions']).reshape(-1,3).tolist();g.from_pydata(co,[],np.arange(len(co)).reshape(-1,3).tolist());g.update()
 o=bpy.data.objects.new(row['name'],g);scene.collection.objects.link(o);g.materials.append(bpy.data.materials[row['material']])
for obj in bpy.context.selected_objects:obj.select_set(False)
receiver.select_set(True);bpy.context.view_layer.objects.active=receiver
uv=mesh.uv_layers.new(name='ExteriorLightingUV');mesh.uv_layers.active=uv
# Keep horizontal tops separate from beveled sides: occluded underside texels
# must not bleed into visible paving at a flush join.
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=0.174533,island_margin=.006,area_weight=.5,correct_aspect=True,scale_to_bounds=True);bpy.ops.object.mode_set(mode='OBJECT')
uv=mesh.uv_layers['ExteriorLightingUV'] # Edit mode replaces UV storage; reacquire the RNA layer.
blender_uv=np.asarray([tuple(uv.data[l.index].uv) for poly in mesh.polygons for l in [mesh.loops[i] for i in poly.loop_indices]],np.float32)
assert np.isfinite(blender_uv).all() and blender_uv.min()>=0 and blender_uv.max()<=1
web_uv=blender_uv.copy();web_uv[:,1]=1-web_uv[:,1];web_uv.tofile(work/'lighting-uv.bin');blender_uv.tofile(work/'exterior-finish-uv-blender.bin')
metadata={'atlas':'/assets/exterior-finish-v24/exterior-finish-indirect.exr','uv':'/assets/exterior-finish-v24/lighting-uv.bin','size':[args.size,args.size],'receivers':[]}
for row,(begin,end) in zip(data['receivers'],ranges):metadata['receivers'].append({**{k:row[k] for k in ['name','sourceMesh','material','triangleOffsets','signature']},'uvOffset':begin*6,'uvCount':(end-begin)*6})
(work/'lighting.json').write_text(json.dumps(metadata,separators=(',',':')))
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
for device in prefs.devices:device.use=device.type=='OPTIX'
scene.render.engine='CYCLES';scene.cycles.device='GPU';scene.cycles.samples=args.samples;scene.cycles.use_adaptive_sampling=False;scene.cycles.use_denoising=False
scene.render.use_persistent_data=True;scene.render.bake.use_selected_to_active=False;scene.render.bake.margin_type='EXTEND'
sun_config=manifest['sun'];d=sun_config['position'];suns=[o for o in scene.objects if o.type=='LIGHT' and o.data.type=='SUN' and not o.hide_render]
for sun in suns:
 sun.rotation_euler=(-Vector((d[0],-d[2],d[1])).normalized()).to_track_quat('-Z','Y').to_euler();sun.data.energy=sun_config['intensity'];sun.data.color=sun_config['color'];sun.data.angle=sun_config['angle']
target=material.node_tree.nodes.new('ShaderNodeTexImage');material.node_tree.nodes.active=target
bpy.context.view_layer.update()
# Save only a derived inspection source, after preserving the original byte-for-byte.
bpy.ops.wm.save_as_mainfile(filepath=str(work/'exterior-finish-derived.blend'),copy=True)
signals=[]
for channel,filters in [('indirect',{'INDIRECT'}),('practical',{'DIRECT'})]:
 print('EXTERIOR_BAKE',channel,args.size,args.samples,len(faces),flush=True)
 image=bpy.data.images.new('Exterior '+channel,width=args.size,height=args.size,alpha=False,float_buffer=True);image.colorspace_settings.name='Non-Color';target.image=image
 if channel=='practical':
  for sun in suns:sun.hide_render=True
 bpy.ops.object.bake(type='DIFFUSE',pass_filter=filters,uv_layer='ExteriorLightingUV',margin=4,use_clear=True)
 pixels=np.empty(args.size*args.size*4,np.float32);image.pixels.foreach_get(pixels);signals.append(pixels);bpy.data.images.remove(image)
 for sun in suns:sun.hide_render=False
pixels=signals[0]+signals[1];pixels[3::4]=1;assert np.isfinite(pixels).all()
np.save(work/'exterior-finish-raw.npy',pixels.reshape(args.size,args.size,4));np.save(work/'exterior-finish-old.npy',pixels.reshape(args.size,args.size,4))
(work/'sources.json').write_text(json.dumps([{'zone':'exterior-finish','raw':'external exterior-finish-raw.npy','uv':str(work/'exterior-finish-uv-blender.bin')}]))
report={'source':str(source),'sourceSHA256':source_hash,'sourceUnchanged':sha(source)==source_hash,'backup':str(checkpoint),'process':os.getpid(),'blender':bpy.app.version_string,'samples':args.samples,'size':[args.size,args.size],'triangles':len(faces),'hiddenOriginalObjects':hidden,'signal':'indirect diffuse plus direct practicals; no albedo or direct sun','seconds':time.time()-started}
(work/'bake-report.json').write_text(json.dumps(report,indent=2));print('EXTERIOR_BAKE complete',json.dumps(report),flush=True)
