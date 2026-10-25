"""Render the saved editable source repair without saving over that file."""
import bpy, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'outputs/scene-repair-v6'
bpy.ops.wm.open_mainfile(filepath=str(OUT/'MD_Presentation_Lounge_Repaired.blend'))
scene=bpy.context.scene
scene.frame_set(500)
prefs=bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type='OPTIX';prefs.get_devices()
for device in prefs.devices: device.use=device.type=='OPTIX'
scene.render.engine='CYCLES';scene.cycles.device='GPU'
scene.cycles.samples=96;scene.cycles.use_denoising=True
scene.render.resolution_x=960;scene.render.resolution_y=600;scene.render.resolution_percentage=100
scene.render.use_compositing=False
camera=bpy.data.objects.new('QA workstation 04 clearance',bpy.data.cameras.new('QA workstation 04 clearance'))
scene.collection.objects.link(camera);camera.location=(20.4,32.6,1.9)
camera.rotation_euler=(Vector((17.7,32.1,1))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.angle=math.radians(58);scene.camera=camera
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB'
scene.render.filepath=str(OUT/'blender-layout-preview.png')
bpy.ops.render.render(write_still=True)
print('PREVIEW_COMPLETE',scene.render.filepath,flush=True)
