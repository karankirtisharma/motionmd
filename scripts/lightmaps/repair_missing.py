import json,numpy as np
from pathlib import Path
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
import argparse
p=argparse.ArgumentParser();p.add_argument('--meshes',type=Path,required=True);p.add_argument('--arrays',type=Path,required=True);p.add_argument('--material',required=True,nargs='+');args=p.parse_args()
R=args.meshes;D=args.arrays;rows=json.loads((R/'mesh-lightmaps.json').read_text());reports=[]; cache={}
for row in rows:
 if row['material'] not in args.material:continue
 id=row['id'];z=row['zone'];a,mask=cache.get(z,(None,None))
 if a is None:a=np.load(D/f'{z}-clean.npy');mask=np.load(D/f'{z}-coverage.npy')
 h,w=mask.shape
 p=np.fromfile(R/f'mesh-{id}-position.bin',np.float32).reshape(-1,3);uv=np.fromfile(R/f'mesh-{id}-uv.bin',np.float32).reshape(-1,2);norm=np.fromfile(R/f'mesh-{id}-normal.bin',np.float32).reshape(-1,3);ix=np.fromfile(R/f'mesh-{id}-index.bin',np.uint32).reshape(-1,3)
 centers=p[ix].mean(1);tc=uv[ix].mean(1)*[w,h]-.5;nn=norm[ix].mean(1);nn/=np.maximum(np.linalg.norm(nn,axis=1,keepdims=True),1e-10)
 distance=ndi.distance_transform_edt(~mask);gap=ndi.map_coordinates(distance,[tc[:,1],tc[:,0]],order=1)
 bad=np.flatnonzero(gap>.75);good=np.flatnonzero(gap<.1);k=min(64,len(good));
 if k<2 or not len(bad):continue
 tree=cKDTree(centers[good]);dd,near=tree.query(centers[bad],k=k);ids=good[near];alignment=(nn[bad,None,:]*nn[ids]).sum(2);ok=(alignment>.7)&(dd<.04)
 print(row['material'],'badfaces',len(bad),'repairable',ok.any(1).sum(),'maxgap',gap.max(),flush=True)
 colors=np.stack([ndi.map_coordinates(a[:,:,k],[tc[good,1],tc[good,0]],order=1) for k in range(3)],1)
 targets=[];values=[]
 for j,f in enumerate(bad):
  if not ok[j].any():continue
  weights=1/np.maximum(dd[j,ok[j]],.001)**2;val=np.average(colors[near[j,ok[j]]],axis=0,weights=weights)
  # Super-sample this otherwise uncovered triangle's footprint. The chart can be
  # long but subpixel thin; 0.25px edge spacing preserves the entire sliver.
  tri=uv[ix[f]]*[w,h]-.5;steps=max(2,int(np.ceil(np.max(np.linalg.norm(tri-tri[[1,2,0]],axis=1))*4)))
  if steps>512:continue
  for t in np.linspace(0,1,steps+1):
   for s in [0,.5,1]:
    q=tri[0]*(1-t)+t*(tri[1]*(1-s)+tri[2]*s);x,y=np.round(q).astype(int)
    if 0<=x<w and 0<=y<h and not mask[y,x]:targets.append((y,x));values.append(val)
 if not targets:continue
 targets=np.array(targets);values=np.array(values);sums=np.zeros((h,w,3));counts=np.zeros((h,w));np.add.at(sums,(targets[:,0],targets[:,1]),values);np.add.at(counts,(targets[:,0],targets[:,1]),1);filled=counts>0
 repaired=a.copy();repaired[filled,:3]=sums[filled]/counts[filled,None];dist,newnear=ndi.distance_transform_edt(~filled,return_indices=True)
 # New padding owns pixels only where it is closer than any original chart.
 pad=(~mask)&(dist<=4)&(dist<distance);repaired[pad,:3]=repaired[newnear[0,pad],newnear[1,pad],:3]
 assert np.array_equal(a[mask],repaired[mask]), 'Existing covered lighting must remain unchanged'
 cache[z]=(repaired,mask|filled)
 np.save(D/f'{z}-repaired.npy',repaired);reports.append({**row,'missingFaces':len(bad),'repairedFaces':int(ok.any(1).sum()),'newCoveragePixels':int(filled.sum()),'paddingPixels':int(pad.sum())})
(R/'missing-coverage-report.json').write_text(json.dumps(reports,indent=2))
