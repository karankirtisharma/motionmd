"""Lighting-only repair from an explicitly audited, outward-oriented bake copy.

Does not export geometry or change live assets. Original Blender source is read-only.
"""
import bpy, json, os, sys, time, argparse, struct
import numpy as np
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
os.environ['OPTIX_CACHE_PATH']=str(ROOT/'work/optix-cache')
p=argparse.ArgumentParser()
p.add_argument('--prepared',required=True)
p.add_argument('--zone',default='all')
p.add_argument('--samples',type=int,default=256)
p.add_argument('--out',default='work/oriented-gi')
args=p.parse_args(sys.argv[sys.argv.index('--')+1:])
prepared=Path(args.prepared).resolve();OUT=(ROOT/args.out).resolve()
assert prepared.is_relative_to(ROOT), 'Only the verified working copy may be baked'
assert OUT.is_relative_to(ROOT/'work'), 'Repair outputs must remain staged'
OUT.mkdir(parents=True,exist_ok=True)
plan=json.loads((ROOT/'work/atlas-repair/atlas-plan.json').read_text())
manifest=json.loads((ROOT/'outputs/md-lounge-web/public/assets/scene-manifest.json').read_text())
object_zones={}
for chunk in manifest['chunks']:
 raw=(ROOT/'outputs/md-lounge-web/public'/chunk['url'].lstrip('/')).read_bytes()
 doc=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
 for node in doc['nodes']:
  if 'mesh' in node:object_zones[node['name']]=chunk['id']
bpy.ops.wm.open_mainfile(filepath=str(prepared));scene=bpy.context.scene
web=[o for o in scene.objects if o.type=='MESH' and o.name in object_zones]
assert len(web)==11
rows={r['name']:r for r in plan['materials']}
for o in web:
 for layer in o.data.uv_layers:layer.active_render=layer.name=='SourceUV'
 for mat in o.data.materials:assert mat.name in rows,mat.name
prefs=bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type='OPTIX';prefs.get_devices()
for device in prefs.devices:device.use=device.type=='OPTIX'
scene.render.engine='CYCLES';scene.cycles.device='GPU';scene.cycles.samples=args.samples
scene.cycles.use_adaptive_sampling=False;scene.cycles.use_denoising=False
scene.render.use_persistent_data=True;scene.render.bake.use_selected_to_active=False
scene.render.bake.margin_type='EXTEND';scene.render.bake.view_from='ABOVE_SURFACE'
scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.view_settings.exposure=0
scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_mode='RGB'
scene.render.image_settings.color_depth='32';scene.render.image_settings.exr_codec='ZIP'
zones=['founder','lounge','studio','entrance','gallery','shell'] if args.zone=='all' else args.zone.split(',')
start=time.time()
def note(stage,**data):
 record={'stage':stage,'seconds':round(time.time()-start,2),**data}
 (OUT/'status.json').write_text(json.dumps(record));print('ORIENTED_GI',json.dumps(record),flush=True)
for zone in zones:
 objects=[o for o in web if object_zones[o.name]==zone]
 assert objects,zone
 for o in bpy.context.selected_objects:o.select_set(False)
 for o in objects:o.hide_set(False);o.select_set(True)
 bpy.context.view_layer.objects.active=objects[0]
 atlases={a['id']:a for a in plan['atlases'] if a['zone']==zone}
 images={}
 for key,atlas in atlases.items():
  images[key]={}
  for channel in ['indirect','practical']:
   im=bpy.data.images.new(key+'-oriented-'+channel,width=atlas['giSize'],height=atlas['giSize'],alpha=False,float_buffer=True)
   im.colorspace_settings.name='Non-Color';images[key][channel]=im
 scratch=bpy.data.images.new(zone+'-disposable-target',16,16,alpha=False,float_buffer=True)
 targets={}
 for mat in {m for o in objects for m in o.data.materials if m}:
  n=mat.node_tree.nodes.new('ShaderNodeTexImage');targets[mat]=n
 for channel,filters in [('indirect',{'INDIRECT'}),('practical',{'DIRECT'})]:
  for mat,node in targets.items():
   key=rows[mat.name].get('atlasId');node.image=images[key][channel] if key in images else scratch
   mat.node_tree.nodes.active=node;node.select=True
  suns=[o for o in scene.objects if o.type=='LIGHT' and o.data.type=='SUN' and not o.hide_render]
  if channel=='practical':
   for o in suns:o.hide_render=True
  note('baking',zone=zone,channel=channel,samples=args.samples)
  try:bpy.ops.object.bake(type='DIFFUSE',pass_filter=filters,uv_layer='BakeUV',margin=4,use_clear=True)
  finally:
   for o in suns:o.hide_render=False
 for key,atlas in atlases.items():
  im=images[key]['indirect'];a=np.empty(atlas['giSize']**2*4,np.float32);b=np.empty_like(a)
  im.pixels.foreach_get(a);images[key]['practical'].pixels.foreach_get(b);a+=b;a[3::4]=1
  assert np.isfinite(a).all(),key
  im.pixels.foreach_set(a);im.filepath_raw=str(OUT/f'{key}-indirect.exr');im.file_format='OPEN_EXR';im.save()
 for mat,node in targets.items():mat.node_tree.nodes.remove(node)
 for atlas_images in images.values():
  for im in atlas_images.values():bpy.data.images.remove(im)
 bpy.data.images.remove(scratch)
 report={'zone':zone,'samples':args.samples,'prepared':str(prepared),'geometryExported':False,'sourceUnmodified':True,'atlases':list(atlases),'seconds':time.time()-start}
 (OUT/f'{zone}-report.json').write_text(json.dumps(report,indent=2));note('zone-complete',**report)
note('complete',zones=zones)
