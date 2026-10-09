import bpy,json,sys
from pathlib import Path
from mathutils import Vector
out=Path(sys.argv[sys.argv.index('--')+1]); scene=bpy.context.scene; scene.frame_set(500)
visible={}
def walk(c,hidden=False):
 hidden=hidden or c.hide_render
 for o in c.objects: visible[o.name]=visible.get(o.name,False) or not hidden
 for c2 in c.children:walk(c2,hidden)
walk(scene.collection)
records=[]
for o in scene.objects:
 if o.type not in {'MESH','CURVE','SURFACE','FONT'} or o.hide_render or not visible.get(o.name,True):continue
 pts=[o.matrix_world@Vector(v) for v in o.bound_box]
 lo=[min(p[i] for p in pts) for i in range(3)];hi=[max(p[i] for p in pts) for i in range(3)]
 records.append({'name':o.name,'type':o.type,'parent':o.parent.name if o.parent else None,'min':lo,'max':hi,'matrix':[list(r) for r in o.matrix_world],'collections':[c.name for c in o.users_collection],'materials':[m.name for m in o.data.materials if m],'vertices':len(o.data.vertices) if o.type=='MESH' else None})
out.write_text(json.dumps({'source':bpy.data.filepath,'frame':scene.frame_current,'objects':records},indent=2));print('AUDIT',len(records),str(out),flush=True)
