"""Rebake the moved-chair rug using its exact shipped lighting UVs.

Run Blender on the immutable v21 source, with --work pointing outside the website.
The source blend and all existing atlas files are read-only.
"""
import bpy, json, sys, math, argparse, time
import numpy as np
from pathlib import Path
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform

p = argparse.ArgumentParser()
p.add_argument('--work', type=Path, required=True)
p.add_argument('--previous', type=Path, required=True)
p.add_argument('--samples', type=int, default=512)
args = p.parse_args(sys.argv[sys.argv.index('--') + 1:])
work = args.work.resolve(); work.mkdir(parents=True, exist_ok=True)
start = time.time()
def note(stage, **kw):
    print('RUG_BAKE', json.dumps(dict(stage=stage, seconds=round(time.time()-start, 2), **kw)), flush=True)

scene = bpy.context.scene
source = scene.objects['FR79 | wool rug backing']
deps = bpy.context.evaluated_depsgraph_get()
evaluated = source.evaluated_get(deps)
original = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=deps)
original.calc_loop_triangles()
verts = [source.matrix_world @ v.co for v in original.vertices]
triangles = [tuple(t.vertices) for t in original.loop_triangles]
tree = BVHTree.FromPolygons(verts, triangles, all_triangles=True)
source_uv = original.uv_layers.active.data
data = json.loads((work / 'rug.json').read_text())
world_vertices = [Vector(data['positions'][i:i+3]) for i in range(0, len(data['positions']), 3)]
faces = [data['index'][i:i+3] for i in range(0, len(data['index']), 3)]
material_uv = []; maximum_error = 0
for v in world_vertices:
    nearest, normal, triangle, distance = tree.find_nearest(v)
    maximum_error = max(maximum_error, distance)
    t = original.loop_triangles[triangle]
    uv = [Vector((*source_uv[l].uv, 0)) for l in t.loops]
    material_uv.append(barycentric_transform(nearest, *[verts[i] for i in t.vertices], *uv))
note('source-correspondence', maximumDistance=maximum_error, vertices=len(world_vertices))
assert maximum_error < .002, 'Source rug does not match the shipped receiver'

mesh = bpy.data.meshes.new('Founder rug lighting receiver')
inv = source.matrix_world.inverted()
mesh.from_pydata([inv @ v for v in world_vertices], [], faces); mesh.update()
uv0 = mesh.uv_layers.new(name=original.uv_layers.active.name)
uv1 = mesh.uv_layers.new(name='ChairLightingUV')
for polygon in mesh.polygons:
    polygon.use_smooth = True
    for l in polygon.loop_indices:
        i = mesh.loops[l].vertex_index
        uv0.data[l].uv = material_uv[i][:2]
        uv1.data[l].uv = data['uv'][i*2:i*2+2]
uv0.active_render = True
receiver = bpy.data.objects.new('Founder rug corrected lighting receiver', mesh)
scene.collection.objects.link(receiver); receiver.matrix_world = source.matrix_world.copy()
mesh.materials.append(source.data.materials[0].copy())
source.hide_render = True
evaluated.to_mesh_clear()

# The same pedestal setting and rigid placement as Workstation.ts. Upholstery,
# stitching, widths and depths are unchanged; only the lower pedestal retracts.
pivot = Vector((15.5748868, 3.7747329, 4.265))
target = Vector((15.42, 5.3, 4.265))
angle = math.pi/2 - math.atan2(-.975887, -.218281)
placement = Matrix.Translation(target) @ Matrix.Rotation(angle, 4, 'Z') @ Matrix.Translation(-pivot)
chair_count = 0
for obj in list(scene.objects):
    if obj.type != 'MESH' or not obj.name.startswith('FC91 Installed |'): continue
    evaluated = obj.evaluated_get(deps)
    chair_mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=deps)
    chair_mesh.transform(obj.matrix_world)
    for v in chair_mesh.vertices:
        v.co.z -= .12 * max(0, min(1, (v.co.z - 4.343) / (4.560 - 4.343)))
    chair_mesh.transform(placement)
    clone = bpy.data.objects.new('Bake chair | ' + obj.name, chair_mesh)
    scene.collection.objects.link(clone); obj.hide_render = True; chair_count += 1

old = bpy.data.images.load(str(args.previous.resolve()), check_existing=False)
size = tuple(old.size); bpy.data.images.remove(old)
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'; prefs.get_devices()
for d in prefs.devices: d.use = d.type == 'OPTIX'
scene.render.engine = 'CYCLES'; scene.cycles.device = 'GPU'
scene.cycles.samples = args.samples; scene.cycles.use_adaptive_sampling = False
scene.cycles.use_denoising = False; scene.render.use_persistent_data = True
scene.render.bake.use_selected_to_active = False
scene.render.bake.margin_type = 'EXTEND'
for obj in bpy.context.selected_objects: obj.select_set(False)
receiver.hide_set(False); receiver.select_set(True); bpy.context.view_layer.objects.active = receiver
material = mesh.materials[0]; node = material.node_tree.nodes.new('ShaderNodeTexImage')
material.node_tree.nodes.active = node
suns = [o for o in scene.objects if o.type == 'LIGHT' and o.data.type == 'SUN' and not o.hide_render]
# The web release uses its approved sunset variant rather than the source's
# authoring daylight pose. Match that same direction, chromaticity and energy.
manifest = json.loads((Path(__file__).resolve().parents[2] / 'public/assets/scene-manifest.json').read_text())
sun_config = manifest['sun']; direction = sun_config['position']
for sun in suns:
    incoming = -Vector((direction[0], -direction[2], direction[1])).normalized()
    sun.rotation_euler = incoming.to_track_quat('-Z', 'Y').to_euler()
    sun.data.energy = sun_config['intensity']; sun.data.color = sun_config['color']; sun.data.angle = sun_config['angle']
bpy.context.view_layer.update()
note('prepared', chairParts=chair_count, size=size, samples=args.samples,
     sunDirections=[list(o.matrix_world.to_quaternion() @ Vector((0,0,1))) for o in suns])
signals = []
for channel, filters in [('indirect', {'INDIRECT'}), ('practical', {'DIRECT'})]:
    image = bpy.data.images.new('Founder rug ' + channel, width=size[0], height=size[1], alpha=False, float_buffer=True)
    image.colorspace_settings.name = 'Non-Color'; node.image = image
    if channel == 'practical':
        for sun in suns: sun.hide_render = True
    note('baking', channel=channel)
    bpy.ops.object.bake(type='DIFFUSE', pass_filter=filters, uv_layer='ChairLightingUV', margin=4, use_clear=True)
    values = np.empty(size[0]*size[1]*4, np.float32); image.pixels.foreach_get(values)
    signals.append(values)
    if channel == 'practical':
        for sun in suns: sun.hide_render = False
    bpy.data.images.remove(image)
pixels = signals[0] + signals[1]; pixels[3::4] = 1
assert np.isfinite(pixels).all()
np.save(work / 'founder-rug-raw.npy', pixels.reshape(size[1], size[0], 4))
np.save(work / 'founder-rug-old.npy', pixels.reshape(size[1], size[0], 4))
np.asarray(data['uv'], np.float32).reshape(-1,2)[np.asarray(data['index'])].tofile(work / 'rug-uv.bin')
(work / 'sources.json').write_text(json.dumps([{'zone':'founder-rug','raw':'retained as founder-rug-raw.npy','uv':str(work/'rug-uv.bin')}]))
(work / 'bake-report.json').write_text(json.dumps({'source':bpy.data.filepath,'sourceSaved':False,'samples':args.samples,'size':size,'sourceCorrespondenceMax':maximum_error,'chairParts':chair_count,'seconds':time.time()-start}, indent=2))
note('complete')
