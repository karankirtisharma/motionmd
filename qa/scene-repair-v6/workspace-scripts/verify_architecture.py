"""Review source-space broad-phase overlaps; never edit Blender geometry."""
import json, re, hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'outputs/scene-repair-v6'
before = json.loads((OUT / 'source-bounds.json').read_text())['objects']
after = json.loads((OUT / 'repaired-source-bounds.json').read_text())['objects']
old = {o['name']: o for o in before}
new = {o['name']: o for o in after}
assert old.keys() == new.keys(), 'Visible source object inventory changed'
repair = json.loads((OUT / 'layout-repair.json').read_text())
allowed = {r['name'] for r in repair['records']}
changed = []
for name, obj in new.items():
    original = old[name]
    assert obj['vertices'] == original['vertices'], name
    assert obj['materials'] == original['materials'], name
    if obj['matrix'] != original['matrix']:
        assert name in allowed, f'Unintended transform change: {name}'
        changed.append(name)

def size(o):
    return [o['max'][i] - o['min'][i] for i in range(3)]

def overlaps(objects):
    tables = [o for o in objects if re.search(r'table|desktop', o['name'], re.I)
              and not re.search(r'tray|foot|contact|reveal', o['name'], re.I)
              and size(o)[0]*size(o)[1] > 1 and size(o)[2] > .02]
    structure = [o for o in objects if re.search(r'wall|pier|column', o['name'], re.I)
                 and not re.search(r'glass|handrail|art|inscription|scale steel|lift column|seam|trim', o['name'], re.I)
                 and size(o)[2] > 1.5]
    hits = []
    for table in tables:
        for support in structure:
            depth = [min(table['max'][i], support['max'][i]) - max(table['min'][i], support['min'][i]) for i in range(3)]
            if min(depth) > .005:
                hits.append({'furniture': table['name'], 'structure': support['name'], 'overlapMeters': depth})
    return {'furnitureCount': len(tables), 'structuralCount': len(structure), 'candidateIntersections': hits}

report = {
    'visibleSourceObjects': len(after), 'visibleObjectsMoved': len(changed),
    'objectInventoryPreserved': True, 'vertexCountsPreserved': True,
    'materialAssignmentsPreserved': True, 'unintendedTransformChanges': 0,
    'before': overlaps(before), 'after': overlaps(after),
    'scope': 'All visible objects checked for inventory, vertex count, material assignments and unintended movement. Large tables/desktops checked against tall architectural walls/piers/columns by source-space AABB; candidates require visual review. This is not an exhaustive triangle-intersection proof for 8,782 nested decorative components.'
}
(OUT / 'architecture-verification.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
