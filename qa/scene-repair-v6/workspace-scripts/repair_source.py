"""Repair a derived source file only; keep workstation assembly and source IDs together."""
import bpy,json,re,sys
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'outputs/scene-repair-v6';scene=bpy.context.scene
assert Path(bpy.data.filepath).resolve()==(OUT/'backup/MD_Presentation_Lounge.blend').resolve()
scene.frame_set(500)
roots={f'{p} {n}' for p in ['WS72 | Keyboard','WS72 | Mouse','WS72 | Pen cup'] for n in [10,11,12]}
roots|={f'{p} 04-{i}' for p in ['WS72 | Chair','HF89 | Curved workstation'] for i in [1,2,3]}
selected=set()
for o in scene.objects:
 a=o
 while a:
  if a.name in roots or 'MF bench 04' in a.name: selected.add(o);break
  a=a.parent
# Move parent roots only, avoiding doubled child translation. Includes lights/text/hardware.
top=[o for o in selected if o.parent not in selected]
names={o.name for o in selected};before={o.name:[list(r) for r in o.matrix_world] for o in selected}
for o in top:o.matrix_world.translation+=Vector((0,-2.35,0))
bpy.context.view_layer.update()
records=[]
for o in selected:
 if o.type in {'MESH','CURVE','FONT','SURFACE'}:
  records.append({'name':o.name,'before':before[o.name],'after':[list(r) for r in o.matrix_world]})
assert len(records)>400,len(records)
# Source scene retains its authored animation; duplicate opens on same presentation frame.
(OUT/'layout-repair.json').write_text(json.dumps({'deltaBlender':[0,-2.35,0],'reason':'Workstation 04 intersected R9 limestone gallery pier.001; move entire furniture assembly toward free studio aisle, preserve structural pier.','records':records,'rootNames':[o.name for o in top]},indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'MD_Presentation_Lounge_Repaired.blend'),check_existing=False)
print('SOURCE_REPAIR',len(records),'geometry objects',len(top),'roots',flush=True)
