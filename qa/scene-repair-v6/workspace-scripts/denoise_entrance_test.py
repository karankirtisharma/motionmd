"""CPU-only OIDN compositor experiment; never touches a live asset or source blend."""
import bpy, json, os, time, hashlib, sys, re
import numpy as np
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else ['entrance']
ZONE=args[0]
use_albedo='--no-albedo' not in args
dense='--dense' in args
assert re.fullmatch(r'(lounge|entrance|shell|gallery|founder|studio)(-[a-z0-9]+)*',ZONE)
DATA=ROOT/'work/dense-assets/uv' if dense else ROOT/'work/denoise-test'/ZONE
OUT=Path(args[2]).resolve() if len(args)>2 else DATA
assert OUT.is_relative_to(ROOT/'work'), 'Experiment outputs must stay under work/'
OUT.mkdir(parents=True,exist_ok=True)
ASSETS=ROOT/'outputs/md-lounge-web/public/assets'
source=Path(args[1]).resolve() if len(args)>1 else ASSETS/'lighting'/f'{ZONE}-indirect.exr'
assert source.exists() and source.stat().st_size>1000, 'Bake source missing or empty'
assert source.resolve()!=(OUT/f'{ZONE}-indirect.exr').resolve(), 'Output must not overwrite source'
base=(ROOT/'work/dense-assets/textures' if dense else ASSETS/'textures')/f'{ZONE}-base.png'
start=time.time()
def note(stage,**data): print('DENOISE_TEST',json.dumps({'stage':stage,**data}),flush=True)
def image_data(image):
 a=np.empty(image.size[0]*image.size[1]*4,np.float32);image.pixels.foreach_get(a);return a.reshape(image.size[1],image.size[0],4)
def checksum(file): return hashlib.sha256(file.read_bytes()).hexdigest()
assert not bpy.data.filepath, 'This test must use a factory scene, not a user blend.'
scene=bpy.context.scene
note('session',pid=os.getpid(),version=bpy.app.version_string,file=bpy.data.filepath)
for obj in list(scene.objects): bpy.data.objects.remove(obj,do_unlink=True)
camera=bpy.data.objects.new('Denoise test camera',bpy.data.cameras.new('Denoise test camera'));scene.collection.objects.link(camera);scene.camera=camera
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=1;scene.cycles.use_denoising=False
scene.render.resolution_x=8;scene.render.resolution_y=8;scene.render.resolution_percentage=100
scene.render.threads_mode='FIXED';scene.render.threads=6
scene.render.compositor_device='CPU';scene.render.compositor_denoise_device='CPU';scene.render.compositor_precision='FULL';scene.render.compositor_denoise_final_quality='HIGH'
scene.render.use_compositing=True
scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1
scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_mode='RGB';scene.render.image_settings.color_depth='32';scene.render.image_settings.exr_codec='ZIP'
tree=bpy.data.node_groups.new('Isolated linear lightmap OIDN','CompositorNodeTree');scene.compositing_node_group=tree
tree.interface.new_socket(name='Image',in_out='OUTPUT',socket_type='NodeSocketColor')
output=tree.nodes.new('NodeGroupOutput');color=tree.nodes.new('CompositorNodeImage');albedo=tree.nodes.new('CompositorNodeImage');denoise=tree.nodes.new('CompositorNodeDenoise')
color.image=bpy.data.images.load(str(source),check_existing=False);color.image.colorspace_settings.name='Non-Color'
albedo.image=bpy.data.images.load(str(base),check_existing=False);albedo.image.colorspace_settings.name='sRGB'
denoise.inputs['HDR'].default_value=True;denoise.inputs['Quality'].default_value='High';denoise.inputs['Prefilter'].default_value='None'
tree.links.new(color.outputs['Image'],denoise.inputs['Image'])
if use_albedo:
 if tuple(albedo.image.size)!=tuple(color.image.size):
  scale=tree.nodes.new('CompositorNodeScale');scale.inputs['Type'].default_value='Relative';scale.inputs['X'].default_value=color.image.size[0]/albedo.image.size[0];scale.inputs['Y'].default_value=color.image.size[1]/albedo.image.size[1]
  tree.links.new(albedo.outputs['Image'],scale.inputs[0]);tree.links.new(scale.outputs[0],denoise.inputs['Albedo'])
 else:tree.links.new(albedo.outputs['Image'],denoise.inputs['Albedo'])
tree.links.new(denoise.outputs['Image'],output.inputs['Image'])
scene.render.filepath=str(OUT/f'{ZONE}-raw-denoised.exr')
before=image_data(color.image);height,width=before.shape[:2]
scene.render.resolution_x=width;scene.render.resolution_y=height
note('cpu-compositor-start',width=width,height=height,guide='sRGB base atlas automatically converted to scene-linear; no normal guide' if use_albedo else 'No albedo or normal guide; irradiation atlas filtered independently')
bpy.ops.render.render(write_still=True)
raw=bpy.data.images.load(str(OUT/f'{ZONE}-raw-denoised.exr'),check_existing=False);raw.colorspace_settings.name='Non-Color'
after=image_data(raw)
assert after.shape==before.shape, f'Unexpected compositor dimensions {after.shape} vs {before.shape}'
assert np.isfinite(after).all(), 'Nonfinite denoiser output'
note('rasterizing-source-uv-coverage')
uv=np.fromfile(DATA/f'{ZONE}-uv-triangles.f32',dtype=np.float32).reshape(-1,3,2)
mask=np.zeros((height,width),dtype=bool)
large=[]
for begin in range(0,len(uv),32768):
 batch=uv[begin:begin+32768]*np.array([width,height],dtype=np.float32)-.5
 mins=np.floor(batch.min(axis=1)).astype(np.int32);maxs=np.ceil(batch.max(axis=1)).astype(np.int32)
 mins=np.maximum(mins,[0,0]);maxs=np.minimum(maxs,[width-1,height-1])
 small=((maxs-mins)<=1).all(axis=1)&(maxs>=mins).all(axis=1)
 for tri in batch[~small]: large.append(tri)
 t=batch[small];lo=mins[small];hi=maxs[small]
 if not len(t): continue
 det=(t[:,1,1]-t[:,2,1])*(t[:,0,0]-t[:,2,0])+(t[:,2,0]-t[:,1,0])*(t[:,0,1]-t[:,2,1])
 valid=np.abs(det)>1e-8;det=np.where(valid,det,1)
 for xx,yy in [(lo[:,0],lo[:,1]),(hi[:,0],lo[:,1]),(lo[:,0],hi[:,1]),(hi[:,0],hi[:,1])]:
  a=((t[:,1,1]-t[:,2,1])*(xx-t[:,2,0])+(t[:,2,0]-t[:,1,0])*(yy-t[:,2,1]))/det
  b=((t[:,2,1]-t[:,0,1])*(xx-t[:,2,0])+(t[:,0,0]-t[:,2,0])*(yy-t[:,2,1]))/det
  inside=valid&(a>=-1e-4)&(b>=-1e-4)&(a+b<=1.0001)
  mask[yy[inside],xx[inside]]=True
for t in large:
 x0=max(0,int(np.floor(t[:,0].min())));x1=min(width-1,int(np.ceil(t[:,0].max())))
 y0=max(0,int(np.floor(t[:,1].min())));y1=min(height-1,int(np.ceil(t[:,1].max())))
 if x1<x0 or y1<y0: continue
 determinant=(t[1,1]-t[2,1])*(t[0,0]-t[2,0])+(t[2,0]-t[1,0])*(t[0,1]-t[2,1])
 if abs(determinant)<1e-8: continue
 xx=np.arange(x0,x1+1,dtype=np.float32)[None,:];yy=np.arange(y0,y1+1,dtype=np.float32)[:,None]
 a=((t[1,1]-t[2,1])*(xx-t[2,0])+(t[2,0]-t[1,0])*(yy-t[2,1]))/determinant
 b=((t[2,1]-t[0,1])*(xx-t[2,0])+(t[0,0]-t[2,0])*(yy-t[2,1]))/determinant
 mask[y0:y1+1,x0:x1+1] |= (a>=-1e-4)&(b>=-1e-4)&(a+b<=1.0001)
interior=mask.copy();distance=np.zeros(mask.shape,np.uint8)
for i in range(1,9):
 distance[interior]=i
 eroded=interior.copy();eroded[1:]&=interior[:-1];eroded[:-1]&=interior[1:];eroded[:,1:]&=interior[:,:-1];eroded[:,:-1]&=interior[:,1:];eroded[[0,-1],:]=False;eroded[:,[0,-1]]=False;interior=eroded
# Original padding + 2px chart border survive unchanged; gradual mix between 2px and 8px.
weight=np.clip((distance.astype(np.float32)-2)/6,0,1)
final=before+(after-before)*weight[:,:,None];final[:,:,3]=before[:,:,3]
result=bpy.data.images.new('Seam protected OIDN trial',width=width,height=height,alpha=True,float_buffer=True);result.colorspace_settings.name='Non-Color';result.pixels.foreach_set(final.ravel());result.update()
scene.render.image_settings.color_depth='16';result.save_render(str(OUT/f'{ZONE}-indirect.exr'),scene=scene)
def stats(a,b,selection):
 delta=b[:,:,:3]-a[:,:,:3];chosen=delta[selection];values=a[:,:,:3][selection]
 return {'pixels':int(selection.sum()),'meanAbsRGBDifference':float(np.abs(chosen).mean()),'rmsRGBDifference':float(np.sqrt((chosen*chosen).mean())),'maxAbsRGBDifference':float(np.abs(chosen).max()),'meanRGBBefore':values.mean(axis=0).tolist(),'meanRGBAfter':b[:,:,:3][selection].mean(axis=0).tolist()}
report={'zone':ZONE,'sourceSHA256':checksum(source),'guideSHA256':checksum(base),'sourceUnmodified':True,'blender':bpy.app.version_string,'device':'CPU','denoiser':'OpenImageDenoise / Blender CompositorDenoise HDR high','albedoGuide':'Source base-color atlas, sRGB decoded by Blender compositor into scene-linear','normalGuide':None,'guideCaveat':'Base color is not a true Cycles Denoising Albedo pass; this illumination atlas omits albedo, so guide usefulness requires visual comparison.','width':width,'height':height,'seconds':time.time()-start,'chartMask':'Rasterized exact exported BakeUV triangle coverage, GLTF v converted to Blender bottom-up','paddingStrategy':'Original padding and first 2 chart pixels unchanged; crossfade to denoised result over next 6 pixels.','rawInterior':stats(before,after,distance>=8),'protectedInterior':stats(before,final,distance>=8),'protectedBorder':stats(before,final,(distance>0)&(distance<=2)),'protectedPadding':stats(before,final,~mask),'visualReviewComplete':False,'limitations':['A camera-image denoiser is not UV-chart-aware; the retained chart-edge band prevents replacing padding but cannot prove no nearby-chart influence in interiors.','Remaining noise on preserved border pixels can remain visible at grazing angles; evaluate in the live scene before adoption.','No true world-normal or denoising-albedo guides were available.']}
if not use_albedo:
 report['albedoGuide']=None
 report['guideSHA256']=None
 report['guideCaveat']='Irradiance atlas filtered without an albedo or normal guide; edges depend on the radiance signal and chart protection.'
(OUT/'denoise-report.json').write_text(json.dumps(report,indent=2))
np.save(OUT/f'{ZONE}-coverage.npy',mask);np.save(OUT/f'{ZONE}-edge-distance.npy',distance)
note('complete',seconds=report['seconds'],interiorPixels=report['protectedInterior']['pixels'],output=str(OUT/f'{ZONE}-indirect.exr'))
