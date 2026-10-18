"""Rebake only the founder floor against the current v21 mirror opening.

Use the immutable v21 source with --work outside the website. No source save.
The receiver uses exact shipped UVs and the repaired floor boundary.
"""
import bpy, json, sys, argparse, time
import numpy as np
from pathlib import Path
from mathutils import Vector

p=argparse.ArgumentParser()
p.add_argument('--work',type=Path,required=True)
p.add_argument('--samples',type=int,default=256)
args=p.parse_args(sys.argv[sys.argv.index('--')+1:])
work=args.work.resolve();work.mkdir(parents=True,exist_ok=True)
start=time.time();root=Path(__file__).resolve().parents[2]
manifest=json.loads((root/'public/assets/scene-manifest.json').read_text(encoding='utf8'))
data=json.loads((work/'floor.json').read_text())
scene=bpy.context.scene
source=scene.objects['Founder polished floor']
mesh=bpy.data.meshes.new('Founder floor current lighting receiver')
mesh.from_pydata(np.asarray(data['positions']).reshape(-1,3).tolist(),[],np.asarray(data['index']).reshape(-1,3).tolist())
mesh.update()
uv=mesh.uv_layers.new(name='FloorLightingUV')
for loop in mesh.loops:uv.data[loop.index].uv=data['uv'][loop.vertex_index*2:loop.vertex_index*2+2]
receiver=bpy.data.objects.new('Founder floor current lighting receiver',mesh)
scene.collection.objects.link(receiver)
material=source.data.materials[0].copy();mesh.materials.append(material)
source.hide_render=True
target=material.node_tree.nodes.new('ShaderNodeTexImage');material.node_tree.nodes.active=target
previous=root/'public/assets/material-v20/lighting/founder-architecture-indirect.exr'
old=bpy.data.images.load(str(previous),check_existing=False);old.colorspace_settings.name='Non-Color'
w,h=old.size;old_pixels=np.empty(w*h*4,np.float32);old.pixels.foreach_get(old_pixels)
np.save(work/'founder-floor-old.npy',old_pixels.reshape(h,w,4));bpy.data.images.remove(old)

prefs=bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type='OPTIX';prefs.get_devices()
for device in prefs.devices:device.use=device.type=='OPTIX'
scene.render.engine='CYCLES';scene.cycles.device='GPU';scene.cycles.samples=args.samples
scene.cycles.use_adaptive_sampling=False;scene.cycles.use_denoising=False
scene.render.use_persistent_data=True;scene.render.bake.use_selected_to_active=False
scene.render.bake.margin_type='EXTEND'
for obj in bpy.context.selected_objects:obj.select_set(False)
receiver.select_set(True);bpy.context.view_layer.objects.active=receiver
sun_config=manifest['sun'];direction=sun_config['position']
suns=[o for o in scene.objects if o.type=='LIGHT' and o.data.type=='SUN' and not o.hide_render]
for sun in suns:
 sun.rotation_euler=(-Vector((direction[0],-direction[2],direction[1])).normalized()).to_track_quat('-Z','Y').to_euler()
 sun.data.energy=sun_config['intensity'];sun.data.color=sun_config['color'];sun.data.angle=sun_config['angle']
bpy.context.view_layer.update()
signals=[]
for channel,filters in [('indirect',{'INDIRECT'}),('practical',{'DIRECT'})]:
 print('FLOOR_BAKE',channel,w,h,args.samples,flush=True)
 image=bpy.data.images.new('Founder floor '+channel,width=w,height=h,alpha=False,float_buffer=True)
 image.colorspace_settings.name='Non-Color';target.image=image
 if channel=='practical':
  for sun in suns:sun.hide_render=True
 bpy.ops.object.bake(type='DIFFUSE',pass_filter=filters,uv_layer='FloorLightingUV',margin=4,use_clear=True)
 pixels=np.empty(w*h*4,np.float32);image.pixels.foreach_get(pixels);signals.append(pixels)
 bpy.data.images.remove(image)
 for sun in suns:sun.hide_render=False
pixels=signals[0]+signals[1];pixels[3::4]=1
assert np.isfinite(pixels).all()
np.save(work/'founder-floor-raw.npy',pixels.reshape(h,w,4))
np.asarray(data['uv'],np.float32).reshape(-1,2)[np.asarray(data['index'])].tofile(work/'floor-uv.bin')
(work/'sources.json').write_text(json.dumps([{'zone':'founder-floor','raw':'external founder-floor-raw.npy','uv':str(work/'floor-uv.bin')}]))
(work/'bake-report.json').write_text(json.dumps({'source':bpy.data.filepath,'sourceSaved':False,'samples':args.samples,'size':[w,h],'triangles':len(data['index'])//3,'signal':'indirect diffuse plus direct practicals; no albedo or direct sun','seconds':time.time()-start},indent=2))
print('FLOOR_BAKE complete',time.time()-start,flush=True)
