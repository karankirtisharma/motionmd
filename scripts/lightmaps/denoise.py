"""Denoise linear irradiance per disconnected UV coverage island; rebuild padding.

Python 3.11 + NumPy/SciPy, official OIDN with RTLightmap weights. Raw bakes remain untouched.
No material/albedo guide: the signal is illumination, not a shaded beauty image.
"""
import ctypes as c, os, json, sys, time
from pathlib import Path
import numpy as np
from scipy import ndimage as ndi
import argparse
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--arrays',type=Path,required=True)
parser.add_argument('--oidn-bin',type=Path,required=True)
parser.add_argument('--zones',nargs='*')
args=parser.parse_args()
DATA=args.arrays.resolve();bin_dir=args.oidn_bin.resolve()
dll_dir=os.add_dll_directory(str(bin_dir))
cpu_library=c.CDLL(str(bin_dir/'OpenImageDenoise_device_cpu.dll'))
lib=c.CDLL(str(bin_dir/'OpenImageDenoise.dll'))
ptr=c.c_void_p;sz=c.c_size_t
def api(n,ret,args):
 f=getattr(lib,n);f.restype=ret;f.argtypes=args;return f
device=api('oidnNewDevice',ptr,[c.c_int])(1)
api('oidnSetDeviceInt',None,[ptr,c.c_char_p,c.c_int])(device,b'numThreads',6)
api('oidnCommitDevice',None,[ptr])(device)
geterr=api('oidnGetDeviceError',c.c_int,[ptr,c.POINTER(c.c_char_p)])
def check():
 msg=c.c_char_p();err=geterr(device,c.byref(msg));assert err==0,(err,msg.value)
newfilter=api('oidnNewFilter',ptr,[ptr,c.c_char_p]);setimage=api('oidnSetSharedFilterImage',None,[ptr,c.c_char_p,ptr,c.c_int,sz,sz,sz,sz,sz])
setbool=api('oidnSetFilterBool',None,[ptr,c.c_char_p,c.c_bool]);commit=api('oidnCommitFilter',None,[ptr]);execute=api('oidnExecuteFilter',None,[ptr]);release=api('oidnReleaseFilter',None,[ptr])
def denoise(rgb):
 rgb=np.ascontiguousarray(rgb,dtype=np.float32);result=np.empty_like(rgb);h,w=rgb.shape[:2]
 f=newfilter(device,b'RTLightmap');check()
 setimage(f,b'color',rgb.ctypes.data,3,w,h,0,0,0);setimage(f,b'output',result.ctypes.data,3,w,h,0,0,0)
 commit(f);check();execute(f);check();release(f)
 return result

def coverage(path,w,h):
 uv=np.fromfile(path,np.float32).reshape(-1,3,2);mask=np.zeros((h,w),bool)
 for begin in range(0,len(uv),32768):
  batch=uv[begin:begin+32768]*[w,h]-.5
  lo=np.maximum(np.floor(batch.min(axis=1)).astype(np.int32),[0,0]);hi=np.minimum(np.ceil(batch.max(axis=1)).astype(np.int32),[w-1,h-1])
  small=((hi-lo)<=1).all(axis=1)&(hi>=lo).all(axis=1)
  t=batch[small];a0=lo[small];b0=hi[small]
  det=(t[:,1,1]-t[:,2,1])*(t[:,0,0]-t[:,2,0])+(t[:,2,0]-t[:,1,0])*(t[:,0,1]-t[:,2,1])
  valid=np.abs(det)>1e-8;det=np.where(valid,det,1)
  for xx,yy in [(a0[:,0],a0[:,1]),(b0[:,0],a0[:,1]),(a0[:,0],b0[:,1]),(b0[:,0],b0[:,1])]:
   a=((t[:,1,1]-t[:,2,1])*(xx-t[:,2,0])+(t[:,2,0]-t[:,1,0])*(yy-t[:,2,1]))/det
   b=((t[:,2,1]-t[:,0,1])*(xx-t[:,2,0])+(t[:,0,0]-t[:,2,0])*(yy-t[:,2,1]))/det
   ok=valid&(a>=-1e-4)&(b>=-1e-4)&(a+b<=1.0001);mask[yy[ok],xx[ok]]=True
  for t,l,r in zip(batch[~small],lo[~small],hi[~small]):
   if (r<l).any():continue
   det=(t[1,1]-t[2,1])*(t[0,0]-t[2,0])+(t[2,0]-t[1,0])*(t[0,1]-t[2,1])
   if abs(det)<1e-8:continue
   xx=np.arange(l[0],r[0]+1)[None,:];yy=np.arange(l[1],r[1]+1)[:,None]
   a=((t[1,1]-t[2,1])*(xx-t[2,0])+(t[2,0]-t[1,0])*(yy-t[2,1]))/det
   b=((t[2,1]-t[0,1])*(xx-t[2,0])+(t[0,0]-t[2,0])*(yy-t[2,1]))/det
   mask[l[1]:r[1]+1,l[0]:r[0]+1]|=(a>=-1e-4)&(b>=-1e-4)&(a+b<=1.0001)
 return mask

for row in json.loads((DATA/'sources.json').read_text()):
 zone=row['zone']
 if args.zones and zone not in args.zones:continue
 started=time.time();variant=row.get('inputVariant','raw');raw=np.load(DATA/f'{zone}-{variant}.npy');old=np.load(DATA/f'{zone}-old.npy');h,w=raw.shape[:2]
 mask=coverage(row['uv'],w,h);labels,count=ndi.label(mask)
 final=np.zeros_like(raw);final[:,:,3]=1
 small_pixels=0;filtered=0
 for index,sl in enumerate(ndi.find_objects(labels),1):
  if sl is None:continue
  own=labels[sl]==index;rgb=raw[sl][:,:,:3];n=int(own.sum())
  if n<4:
   final[sl][:,:,:3][own]=rgb[own];small_pixels+=n;continue
  # Fill the isolated tile only from this island. Neighbor islands and black atlas
  # background cannot become denoiser features. Include borders, even on thin strips.
  nearest=ndi.distance_transform_edt(~own,return_distances=False,return_indices=True)
  tile=rgb[tuple(nearest)]
  # Smooth only the synthetic exterior context. Every covered input texel stays raw.
  # Replicating noisy boundary pixels otherwise makes artificial stripes.
  context=ndi.gaussian_filter(tile,sigma=(2,2,0))
  padded=np.pad(context,((16,16),(16,16),(0,0)),mode='reflect')
  padded[16:-16,16:-16][own]=rgb[own]
  clean=denoise(padded)[16:-16,16:-16]
  final[sl][:,:,:3][own]=clean[own];filtered+=1
  if filtered%100==0:print(zone,filtered,'/',count,flush=True)
 # Rebuild the 4px extrusion from denoised chart edges; never reintroduce raw noise.
 distance,nearest=ndi.distance_transform_edt(~mask,return_indices=True)
 padding=(~mask)&(distance<=4)
 final[padding]=final[tuple(nearest[:,padding])]
 assert np.isfinite(final).all() and final[:,:,:3].min()>=0
 np.save(DATA/f'{zone}-clean.npy',final);np.save(DATA/f'{zone}-coverage.npy',mask)
 interior=ndi.binary_erosion(mask,iterations=2)
 def metrics(a):
  lum=a[:,:,:3]@[.2126,.7152,.0722];lap=ndi.laplace(lum)
  return dict(meanRGB=a[:,:,:3][mask].mean(axis=0).tolist(),rmsLaplacian=float(np.sqrt(np.mean(lap[interior]**2))))
 report={**row,'filter':'OIDN 2.5.1 RTLightmap, no auxiliary guides, isolated UV coverage components','chartCount':count,'filteredCharts':filtered,'unfilterablePixels':small_pixels,'coveredPixels':int(mask.sum()),'paddingPixels':int(padding.sum()),'seconds':round(time.time()-started,2),'rawMetrics':metrics(raw),'old':metrics(old),'clean':metrics(final),'limitations':'Components under 4 covered texels retain raw values; raster-connected UV charts are treated as one island. Laplacian reduction alone does not prove visual fidelity.'}
 report['inputVariant']=variant
 (DATA/f'{zone}-report.json').write_text(json.dumps(report,indent=2));print('DONE',zone,report['seconds'],flush=True)
api('oidnReleaseDevice',None,[ptr])(device)
