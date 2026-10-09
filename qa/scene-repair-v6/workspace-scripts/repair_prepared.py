import bpy,json,numpy as np
from pathlib import Path
from mathutils import Vector,Matrix
from mathutils.kdtree import KDTree
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'outputs/scene-repair-v6';WORK=ROOT/'work/scene-repair-v6'
assert Path(bpy.data.filepath).resolve()==(OUT/'backup/MD_Lounge_Sunset_Bake.blend').resolve()
plan=json.loads((OUT/'layout-repair.json').read_text());visible={o['name'] for o in json.loads((OUT/'source-bounds.json').read_text())['objects']}
merged=bpy.data.objects['WEB_studio_architecture'];me=merged.data
co=np.empty((len(me.vertices),3),np.float32);me.vertices.foreach_get('co',co.ravel())
a=np.empty_like(co);me.attributes['SourceObject'].data.foreach_get('vector',a.ravel())
m=np.array(merged.matrix_world);world=co@m[:3,:3].T+m[:3,3]
region=np.flatnonzero((world[:,0]>17.3)&(world[:,0]<20)&(world[:,1]>31)&(world[:,1]<35)&(world[:,2]<2))
tree=KDTree(len(region))
for i in region:tree.insert(world[i],int(i))
tree.balance();matched=set();report=[];dg=bpy.context.evaluated_depsgraph_get()
for r in plan['records']:
 if r['name'] not in visible:continue
 o=bpy.data.objects[r['name']];temp=bpy.data.meshes.new_from_object(o.evaluated_get(dg),preserve_all_data_layers=True,depsgraph=dg)
 local=np.empty((len(temp.vertices),3),np.float32);temp.vertices.foreach_get('co',local.ravel())
 matrix=np.array(r['before']);expected=local@matrix[:3,:3].T+matrix[:3,3];ids=set();missing=[]
 for p,l in zip(expected,local):
  found=[idx for _,idx,_ in tree.find_range(Vector(p),.00006) if np.linalg.norm(a[idx]-l)<.00006]
  if not found:missing.append(p.tolist())
  ids.update(found)
 bpy.data.meshes.remove(temp)
 if missing:raise RuntimeError(json.dumps({'object':o.name,'missing':len(missing),'total':len(local),'examples':missing[:3]}))
 matched.update(ids);report.append({'name':o.name,'vertices':len(ids)})
print('MATCHED',len(matched),'vertices',len(report),'objects',flush=True)
ids=np.array(sorted(matched));delta=np.array([0,-2.35,0]);world[ids]+=delta
mi=np.linalg.inv(m);co[ids]=world[ids]@mi[:3,:3].T+mi[:3,3];me.vertices.foreach_set('co',co.ravel());me.update()
# Move hidden source assemblies, lights and labels too. Their local maps are preserved.
for name in plan['rootNames']:
 o=bpy.data.objects.get(name)
 if o:o.matrix_world.translation+=Vector(delta)
bpy.context.view_layer.update()
path=OUT/'MD_Lounge_Sunset_Repaired.blend';bpy.ops.wm.save_as_mainfile(filepath=str(path),check_existing=False)
(OUT/'prepared-layout-verification.json').write_text(json.dumps({'objects':report,'movedVertices':len(ids),'unchangedVertices':len(co)-len(ids),'uvs':list(me.uv_layers.keys()),'deltaBlender':delta.tolist(),'prepared':str(path)},indent=2))
# Preserve byte-accurate geometry precision; no quantization of positions/normals/UVs.
bpy.ops.preferences.addon_enable(module='io_scene_gltf2')
from io_scene_gltf2.io.exp.meshopt import MeshoptEncoder
original=MeshoptEncoder.encode_attribute
MeshoptEncoder.encode_attribute=staticmethod(lambda name,data,stride,settings:original('PRESERVE_SOURCE_FLOATS',data,stride,settings))
for o in bpy.context.selected_objects:o.select_set(False)
merged.hide_set(False);merged.select_set(True);bpy.context.view_layer.objects.active=merged
for uv in me.uv_layers:uv.active_render=uv.name=='BakeUV'
bpy.ops.export_scene.gltf(filepath=str(WORK/'studio-geometry.glb'),export_format='GLB',use_selection=True,use_active_scene=True,export_apply=False,export_yup=True,export_animations=False,export_extras=True,export_lights=False,export_cameras=False,export_materials='VIEWPORT',export_normals=True,export_texcoords=True,export_tangents=False,export_meshopt_compression_enable=True)
print('PREPARED_REPAIR_COMPLETE',flush=True)
