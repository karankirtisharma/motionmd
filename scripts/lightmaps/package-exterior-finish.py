"""Validate and atomically publish the exterior illumination release.

Encode EXR into --stage using convert.py first. Metadata switches last, after
content-addressed assets and regression tests are complete. Superseded release
files are retained only in the explicit external evidence --archive directory.
"""
import argparse,hashlib,json,os,shutil,subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--arrays',type=Path,required=True);p.add_argument('--stage',type=Path,required=True);p.add_argument('--archive',type=Path,required=True);args=p.parse_args()
root=Path(__file__).resolve().parents[2];stage=args.stage.resolve();arrays=args.arrays.resolve();archive=args.archive.resolve();output=(root/'public/assets/exterior-finish-v24').resolve()
assert not stage.is_relative_to(root/'public') and not archive.is_relative_to(root/'public'),'Bake evidence must stay outside the website'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
exr=stage/'exterior-finish-indirect.exr';uv=arrays/'lighting-uv.bin'
exr_name=f'exterior-finish-{sha(exr)[:12]}.exr';uv_name=f'lighting-uv-{sha(uv)[:12]}.bin'
shutil.copy2(exr,stage/exr_name);shutil.copy2(uv,stage/uv_name)
meta=json.loads((arrays/'lighting.json').read_text());meta['atlas']='/assets/exterior-finish-v24/'+exr_name;meta['uv']='/assets/exterior-finish-v24/'+uv_name
(stage/'lighting.json').write_text(json.dumps(meta,separators=(',',':')))
# Validate exact geometry hashes, original attribute preservation and actual EXR
# irradiance, including the seam-regression samples, before any publication.
env={**os.environ,'MD_EXTERIOR_LIGHTING_DIR':str(stage)}
subprocess.run(['node','--test','qa/exterior-lighting.test.mjs'],cwd=root,env=env,check=True)
output.mkdir(parents=True,exist_ok=True);archive.mkdir(parents=True,exist_ok=True)
old=json.loads((output/'lighting.json').read_text()) if (output/'lighting.json').exists() else None
for name in [exr_name,uv_name]:
 destination=output/name
 if destination.exists():assert sha(destination)==sha(stage/name),'Content-addressed asset conflict'
 else:shutil.copy2(stage/name,destination)
if old:shutil.copy2(output/'lighting.json',archive/'lighting.json')
temporary=output/'lighting.json.tmp';shutil.copy2(stage/'lighting.json',temporary);os.replace(temporary,output/'lighting.json')
# Every former request has a unique filename; new clients see the complete pair.
if old:
 for url in [old['atlas'],old['uv']]:
  filename=Path(url).name;previous=output/filename
  if filename not in [exr_name,uv_name] and previous.exists():shutil.copy2(previous,archive/filename);previous.unlink()
processing=output/'processing.json'
if processing.exists():shutil.copy2(processing,archive/'processing.json');processing.unlink()
report={'atlas':meta['atlas'],'uv':meta['uv'],'atlasSHA256':sha(stage/exr_name),'uvSHA256':sha(stage/uv_name),'atlasBytes':(stage/exr_name).stat().st_size,'uvBytes':(stage/uv_name).stat().st_size,'metadataBytes':(stage/'lighting.json').stat().st_size,'sourceSHA256':json.loads((arrays/'bake-report.json').read_text())['sourceSHA256'],'bakeSeconds':json.loads((arrays/'bake-report.json').read_text())['seconds'],'denoiseSeconds':json.loads((arrays/'exterior-finish-report.json').read_text())['seconds'],'textureGPUBytes':2048*2048*4*2,'mipmaps':False}
(stage/'release-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
