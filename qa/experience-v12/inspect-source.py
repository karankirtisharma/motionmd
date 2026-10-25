import bpy, json, struct
from pathlib import Path
from mathutils import Vector

WEB = Path(__file__).resolve().parents[2]
manifest = json.loads((WEB / 'public/assets/scene-manifest.json').read_text())
existing = set()
for url in [manifest['collisions']['url'], *manifest['collisions']['additionalUrls']]:
    raw = (WEB / 'public' / url.lstrip('/')).read_bytes()
    data = json.loads(raw[20:20 + struct.unpack_from('<I', raw, 12)[0]])
    existing.update(n.get('extras', {}).get('sourceName', n.get('name')) for n in data['nodes'] if 'mesh' in n)
bpy.context.scene.frame_set(180)
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
records = []
for o in bpy.context.scene.objects:
    if o.type != 'MESH' or o.hide_render: continue
    evaluated = o.evaluated_get(dg)
    pts = [evaluated.matrix_world @ Vector(c) for c in evaluated.bound_box]
    pts = [(p.x, p.z, -p.y) for p in pts]
    records.append(dict(name=o.name, covered=o.name in existing,
        min=[min(p[i] for p in pts) for i in range(3)],
        max=[max(p[i] for p in pts) for i in range(3)],
        vertices=len(o.data.vertices), materials=[m.name for m in o.data.materials if m],
        visible=o.visible_get(), collections=[c.name for c in o.users_collection]))
(WEB / 'qa/experience-v12/source-inventory.json').write_text(json.dumps(records, indent=2))
print('SOURCE_INVENTORY', len(records), 'UNCOVERED', sum(not r['covered'] for r in records), flush=True)
