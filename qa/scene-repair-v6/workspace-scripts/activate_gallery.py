from pathlib import Path
import json, shutil, hashlib
ROOT=Path(__file__).resolve().parents[2]
assets=ROOT/'outputs/md-lounge-web/public/assets'
out=ROOT/'outputs/scene-repair-v6'
manifest=assets/'scene-manifest.json'
data=manifest.read_text()
retired=json.loads((out/'retired-assets.json').read_text())
for atlas in ['gallery-architecture','gallery-detail']:
    source=ROOT/f'work/scene-repair-v6/gi/denoised/{atlas}/{atlas}-indirect.exr'
    target=assets/f'repair-v6/{atlas}-indirect.exr'
    assert source.exists() and source.stat().st_size>1000
    shutil.copy2(source,target)
    data=data.replace(f'/assets/sunset-v4/lighting/{atlas}-indirect.exr',f'/assets/repair-v6/{atlas}-indirect.exr')
manifest.write_text(data)
for atlas in ['gallery-architecture','gallery-detail']:
    relative=Path(f'sunset-v4/lighting/{atlas}-indirect.exr')
    source=(assets/relative).resolve()
    backup=(out/'backup/superseded-web-assets'/relative).resolve()
    assert source.is_relative_to(assets.resolve()) and backup.is_relative_to((out/'backup').resolve())
    assert f'/assets/{relative.as_posix()}' not in data
    if source.exists():
        assert not backup.exists()
        backup.parent.mkdir(parents=True,exist_ok=True)
        shutil.move(str(source),str(backup))
        retired.append({'oldPublicAsset':relative.as_posix(),'backup':str(backup),'bytes':backup.stat().st_size})
(out/'retired-assets.json').write_text(json.dumps(retired,indent=2))
print('Activated gallery lightmaps; previous assets preserved in backup')
