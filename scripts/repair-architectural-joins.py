"""Reproduce measured web finish repairs in a derived Blender source.

Run with the v21 source open and -- --output <external derived.blend>.
Never overwrite the source. No scene-wide geometry/material conversion.
"""
import argparse
import sys
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector

p = argparse.ArgumentParser()
p.add_argument('--output', type=Path, required=True)
args = p.parse_args(sys.argv[sys.argv.index('--') + 1:])
assert args.output.resolve() != Path(bpy.data.filepath).resolve()
bpy.context.view_layer.update()

floor = bpy.data.objects['Founder polished floor']
floor.data = floor.data.copy()
inverse = floor.matrix_world.inverted()
for v in floor.data.vertices:
    world = floor.matrix_world @ v.co
    if abs(world.y - 2.44375) < .0001:
        world.y = 2.397
    if abs(world.x - 3.64375) < .0001:
        world.x = 3.615
    if abs(world.x - 13.00625) < .0001:
        world.x = 13.01
    v.co = inverse @ world
floor.data.update()

floor = bpy.data.objects['MF reference polished floor']
floor.data = floor.data.copy()
bm = bmesh.new()
bm.from_mesh(floor.data)
bm.transform(floor.matrix_world)
bmesh.ops.bisect_plane(bm, geom=list(bm.verts)+list(bm.edges)+list(bm.faces),
                      plane_co=(0, 23.52, 0), plane_no=(0, 1, 0), dist=1e-7)
for v in bm.verts:
    if v.co.y < 23.52:
        v.co.z -= .0125 * min(1, (23.52 - v.co.y) / .12)
bm.normal_update()
bm.transform(floor.matrix_world.inverted())
bm.to_mesh(floor.data)
bm.free()
floor.data.update()

b = bpy.data.objects['Front wing horizontal band.001']
b.data = b.data.copy()
inverse = b.matrix_world.inverted()
for v in b.data.vertices:
    world = b.matrix_world @ v.co
    world.z = 3.9 + (world.z - 3.88) * (.3 / .32)
    v.co = inverse @ world
b.data.update()

bpy.ops.wm.save_as_mainfile(filepath=str(args.output.resolve()))
print('DERIVED_SOURCE', args.output)
