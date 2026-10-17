"""Bake only relocated chair upholstery, without saving the source blend.

The receiver is the exact shipped, transformed geometry from export-chair-bake.mjs.
Its native UV0 and unique lighting UV1 remain separate. Direct sun stays live.
"""
import argparse, json, math, sys, time
from pathlib import Path
import bpy
import numpy as np
from mathutils import Vector, Matrix

p = argparse.ArgumentParser()
p.add_argument('--work', type=Path, required=True)
p.add_argument('--samples', type=int, default=1024)
args = p.parse_args(sys.argv[sys.argv.index('--') + 1:])
work = args.work.resolve(); work.mkdir(parents=True, exist_ok=True)
root = Path(__file__).resolve().parents[2]
start = time.time()
scene = bpy.context.scene
data = json.loads((work / 'chair.json').read_text())
deps = bpy.context.evaluated_depsgraph_get()
placement = Matrix.Translation(Vector((15.42, 5.3, 4.265))) @ Matrix.Rotation(math.pi/2 - math.atan2(-.975887, -.218281), 4, 'Z') @ Matrix.Translation(Vector((-15.5748868, -3.7747329, -4.265)))
parts = 0
for obj in list(scene.objects):
    if obj.type != 'MESH' or not obj.name.startswith('FC91 Installed |'): continue
    evaluated = obj.evaluated_get(deps)
    mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=deps)
    mesh.transform(obj.matrix_world)
    for v in mesh.vertices:
        v.co.z -= .12 * max(0, min(1, (v.co.z - 4.343) / (4.560 - 4.343)))
    mesh.transform(placement)
    # The shipped receiver replaces leather only. Retain all frame/stitching
    # parts as occluders, but never overlay the original upholstery on it.
    keep = [poly.index for poly in mesh.polygons if 'fine ivory leather' not in mesh.materials[poly.material_index].name]
    if len(keep) != len(mesh.polygons):
        import bmesh
        bm = bmesh.new(); bm.from_mesh(mesh); bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if 'fine ivory leather' in mesh.materials[f.material_index].name], context='FACES')
        bm.to_mesh(mesh); bm.free()
    if len(mesh.polygons):
        clone = bpy.data.objects.new('Bake frame | ' + obj.name, mesh)
        scene.collection.objects.link(clone)
    obj.hide_render = True; parts += 1

mesh = bpy.data.meshes.new('Exact shipped upholstery receiver')
mesh.from_pydata(np.asarray(data['positions']).reshape(-1, 3).tolist(), [], np.asarray(data['index']).reshape(-1, 3).tolist())
mesh.update()
for poly in mesh.polygons: poly.use_smooth = True
mesh.normals_split_custom_set_from_vertices(np.asarray(data['normals']).reshape(-1, 3).tolist())
for name, values in [('NativeLeatherUV', data['materialUV']), ('ChairLightingUV', data['uv'])]:
    layer = mesh.uv_layers.new(name=name)
    for loop in mesh.loops: layer.data[loop.index].uv = values[loop.vertex_index*2:loop.vertex_index*2+2]
mesh.uv_layers['NativeLeatherUV'].active_render = True
receiver = bpy.data.objects.new('Chair upholstery lighting receiver', mesh)
scene.collection.objects.link(receiver)
material = bpy.data.materials.new('Source ivory leather diffuse transport'); material.use_nodes = True
nodes = material.node_tree.nodes; links = material.node_tree.links
bsdf = nodes.get('Principled BSDF'); bsdf.inputs['Roughness'].default_value = .7
base = nodes.new('ShaderNodeTexImage')
base.image = bpy.data.images.load(str(root / 'public/assets/source-materials/founder-native-chair-base.png'))
coords = nodes.new('ShaderNodeUVMap'); coords.uv_map = 'NativeLeatherUV'
links.new(coords.outputs['UV'], base.inputs['Vector']); links.new(base.outputs['Color'], bsdf.inputs['Base Color'])
mesh.materials.append(material)
target = nodes.new('ShaderNodeTexImage'); nodes.active = target

prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'; prefs.get_devices()
for device in prefs.devices: device.use = device.type == 'OPTIX'
scene.render.engine = 'CYCLES'; scene.cycles.device = 'GPU'; scene.cycles.samples = args.samples
scene.cycles.use_adaptive_sampling = False; scene.cycles.use_denoising = False
scene.render.use_persistent_data = True; scene.render.bake.use_selected_to_active = False
scene.render.bake.margin_type = 'EXTEND'
for obj in bpy.context.selected_objects: obj.select_set(False)
receiver.select_set(True); bpy.context.view_layer.objects.active = receiver
sun_config = json.loads((root / 'public/assets/scene-manifest.json').read_text())['sun']
direction = sun_config['position']; suns = [o for o in scene.objects if o.type == 'LIGHT' and o.data.type == 'SUN' and not o.hide_render]
for sun in suns:
    sun.rotation_euler = (-Vector((direction[0], -direction[2], direction[1])).normalized()).to_track_quat('-Z', 'Y').to_euler()
    sun.data.energy = sun_config['intensity']; sun.data.color = sun_config['color']; sun.data.angle = sun_config['angle']
bpy.context.view_layer.update()
size = 4096; signals = []
for channel, filters in [('indirect', {'INDIRECT'}), ('practical', {'DIRECT'})]:
    print('CHAIR_BAKE', channel, flush=True)
    image = bpy.data.images.new('Chair ' + channel, width=size, height=size, alpha=False, float_buffer=True)
    image.colorspace_settings.name = 'Non-Color'; target.image = image
    if channel == 'practical':
        for sun in suns: sun.hide_render = True
    bpy.ops.object.bake(type='DIFFUSE', pass_filter=filters, uv_layer='ChairLightingUV', margin=4, use_clear=True)
    pixels = np.empty(size*size*4, np.float32); image.pixels.foreach_get(pixels); signals.append(pixels)
    bpy.data.images.remove(image)
    for sun in suns: sun.hide_render = False
pixels = signals[0] + signals[1]; pixels[3::4] = 1
assert np.isfinite(pixels).all()
np.save(work / 'founder-chair-raw.npy', pixels.reshape(size,size,4))
np.save(work / 'founder-chair-old.npy', pixels.reshape(size,size,4))
np.asarray(data['uv'], np.float32).reshape(-1,2)[np.asarray(data['index'])].tofile(work / 'chair-uv.bin')
(work / 'sources.json').write_text(json.dumps([{'zone':'founder-chair','raw':'retained externally as founder-chair-raw.npy','uv':str(work/'chair-uv.bin')}]))
(work / 'bake-report.json').write_text(json.dumps({'source':bpy.data.filepath,'sourceSaved':False,'samples':args.samples,'size':size,'chairParts':parts,'signal':'indirect diffuse plus direct practicals; no albedo or direct sun; smooth source geometric normals','seconds':time.time()-start}, indent=2))
print('CHAIR_BAKE complete', time.time()-start, flush=True)
