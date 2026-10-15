"""Blender-only EXR/NumPy bridge. Does not open or save a .blend file.

blender --background --factory-startup --python convert.py -- export --arrays DIR
blender --background --factory-startup --python convert.py -- encode --arrays DIR --output DIR
sources.json in DIR records zone, raw (EXR), previous (optional EXR), uv (f32 triangles).
"""
import argparse, hashlib, json, sys
from pathlib import Path
import bpy
import numpy as np

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('mode', choices=['export', 'encode'])
parser.add_argument('--arrays', type=Path, required=True)
parser.add_argument('--output', type=Path)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
data = args.arrays.resolve()
records = json.loads((data / 'sources.json').read_text())

def read_exr(path):
    image = bpy.data.images.load(str(path), check_existing=False)
    image.colorspace_settings.name = 'Non-Color'
    w, h = image.size
    pixels = np.empty(w * h * 4, np.float32)
    image.pixels.foreach_get(pixels)
    bpy.data.images.remove(image)
    return pixels.reshape(h, w, 4)

if args.mode == 'export':
    for row in records:
        variant = row.get('inputVariant', 'raw')
        np.save(data / f"{row['zone']}-{variant}.npy", read_exr(row['raw']))
        np.save(data / f"{row['zone']}-old.npy", read_exr(row.get('previous', row['raw'])))
else:
    if not args.output:
        parser.error('--output is required for encode')
    args.output.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0
    scene.render.image_settings.file_format = 'OPEN_EXR'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.color_depth = '16'
    scene.render.image_settings.exr_codec = 'ZIP'
    reports = []
    for row in records:
        zone = row['zone']
        pixels = np.load(data / f'{zone}-clean.npy')
        assert np.isfinite(pixels).all() and pixels[:, :, :3].min() >= 0
        h, w = pixels.shape[:2]
        image = bpy.data.images.new(zone, width=w, height=h, float_buffer=True, alpha=True)
        image.colorspace_settings.name = 'Non-Color'
        image.pixels.foreach_set(pixels.ravel())
        image.update()
        path = args.output / f'{zone}-indirect.exr'
        image.save_render(str(path), scene=scene)
        bpy.data.images.remove(image)
        report = json.loads((data / f'{zone}-report.json').read_text())
        report.update(output=path.name, outputSHA256=hashlib.sha256(path.read_bytes()).hexdigest(), bytes=path.stat().st_size)
        reports.append(report)
    (args.output / 'processing.json').write_text(json.dumps(reports, indent=2))
