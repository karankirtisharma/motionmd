import bpy,json,time
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'work/scene-repair-v6/probes';OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'outputs/scene-repair-v6/MD_Lounge_Sunset_Repaired.blend'))
scene=bpy.context.scene
for obj in scene.objects:
 if obj.type=='MESH' and obj.data.uv_layers.get('SourceUV'):
  for layer in obj.data.uv_layers:layer.active_render=layer.name=='SourceUV'
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
for device in prefs.devices:device.use=device.type=='OPTIX'
scene.render.engine='CYCLES';scene.cycles.device='GPU';scene.cycles.samples=128;scene.cycles.use_denoising=True
scene.render.use_persistent_data=True
scene.render.resolution_x=2048;scene.render.resolution_y=1024;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_depth='16';scene.render.image_settings.color_mode='RGB';scene.render.image_settings.exr_codec='ZIP'
scene.render.use_compositing=False
camera=bpy.data.objects.new('SUNSET_V4 | reflection capture',bpy.data.cameras.new('SUNSET_V4 | reflection capture'))
scene.collection.objects.link(camera);camera.data.type='PANO';camera.data.panorama_type='EQUIRECTANGULAR'
camera.rotation_euler=Vector((1,0,0)).to_track_quat('-Z','Y').to_euler();scene.camera=camera
manifest=json.loads((ROOT/'outputs/md-lounge-web/public/assets/scene-manifest.json').read_text())
captures=[(p['id'],p['position']) for p in manifest['reflectionProbes'] if p['id']=='studio']
records=[]
for ident,pos in captures:
 camera.location=(pos[0],-pos[2],pos[1]);scene.render.filepath=str(OUT/f'{ident}-reflection.exr')
 start=time.time();print('SUNSET_PROBE_START',ident,flush=True);bpy.ops.render.render(write_still=True)
 records.append({'id':ident,'position':pos,'samples':128,'seconds':time.time()-start})
 (OUT/'captures.json').write_text(json.dumps(records,indent=2));print('SUNSET_PROBE_DONE',ident,flush=True)
