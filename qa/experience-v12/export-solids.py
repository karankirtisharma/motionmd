"""Export reviewed static source solids only; original architectural file is never saved."""
import bpy, bmesh, json, re
from pathlib import Path
from mathutils import Vector

WEB = Path(__file__).resolve().parents[2]
OUT = WEB / 'public/assets/experience-v12'
OUT.mkdir(parents=True, exist_ok=True)
inventory = json.loads((WEB / 'qa/experience-v12/source-inventory.json').read_text())
names = {
    'MF left gallery forward return glass',
    'MF36 gallery guard pier return glass', 'MF36 gallery guard pier return glass.001',
    'FR40 parked gallery glass leaf', 'FR40 gallery glass guard.001', 'FR40 gallery glass guard.002',
    'FR40 rear stone return',
    'PL87 | far side stone return substrate', 'PL87 | portal side stone return substrate',
    'EH46 bank support left stone backing with end returns',
    'EH46 bank support right stone lower backing below shared opening',
    'EH46 bank support right stone rear full-height return',
    'EH47 entrance display left ideas in motion stone backing with end returns',
    'EH47 entrance display right brighter tomorrow stone backing with end returns',
    'F73 | coffee dark core', 'MD68 | dark patterned oval pedestal',
    'MD68 | central spine | lower dark stone',
}
names.update(r['name'] for r in inventory if r['visible'] and not r['covered'] and
    re.match(r'^(Arrival dark rock|Hall statement rock|MF33 rear table bronze pedestal)(\.\d+)?$', r['name']))
assert all(any(r['name'] == n and r['visible'] and not r['covered'] for r in inventory) for n in names)
bpy.context.scene.frame_set(180)
dg = bpy.context.evaluated_depsgraph_get()
target = bpy.data.scenes.new('Reviewed static collision repairs v12')
records = []
for name in sorted(names):
    source = bpy.data.objects[name]
    evaluated = source.evaluated_get(dg)
    mesh = bpy.data.meshes.new_from_object(evaluated, depsgraph=dg)
    mesh.transform(evaluated.matrix_world)
    # Returns/backings may be L/U shaped or surround openings. Preserve their triangles.
    convex = not any(token in name for token in ('stone return', 'backing', 'rear full-height'))
    if convex:
        bm = bmesh.new(); bm.from_mesh(mesh)
        bmesh.ops.delete(bm, geom=list(bm.faces), context='FACES_ONLY')
        hull = bmesh.ops.convex_hull(bm, input=list(bm.verts), use_existing_faces=False)
        bmesh.ops.delete(bm, geom=list(set(hull['geom_unused'] + hull['geom_interior'])), context='VERTS')
        bm.to_mesh(mesh); bm.free()
    mesh.materials.clear()
    while mesh.uv_layers: mesh.uv_layers.remove(mesh.uv_layers[0])
    obj = bpy.data.objects.new('COLLISION_' + name, mesh)
    target.collection.objects.link(obj)
    obj['sourceName'] = name; obj['collisionOnly'] = True
    if convex: obj['collisionShape'] = 'convexHull'
    mesh.calc_loop_triangles()
    points = [(v.co.x, v.co.z, -v.co.y) for v in mesh.vertices]
    records.append(dict(sourceName=name, shape='convexHull' if convex else 'trimesh',
        vertices=len(mesh.vertices), triangles=len(mesh.loop_triangles),
        min=[min(p[i] for p in points) for i in range(3)],
        max=[max(p[i] for p in points) for i in range(3)]))
bpy.context.window.scene = target
for obj in target.objects: obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT / 'static-solids.glb'), export_format='GLB',
    use_selection=True, use_active_scene=True, export_yup=True, export_materials='NONE',
    export_texcoords=False, export_normals=False, export_animations=False,
    export_cameras=False, export_lights=False, export_extras=True)
bpy.data.libraries.write(str(WEB.parent / 'experience-v12/Additional_Colliders.blend'), {target})
(OUT / 'coverage.json').write_text(json.dumps(dict(source=bpy.data.filepath,
    objects=records, count=len(records), bytes=(OUT / 'static-solids.glb').stat().st_size), indent=2))
print('REVIEWED_SOLIDS', len(records), flush=True)
