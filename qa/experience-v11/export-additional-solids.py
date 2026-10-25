import bpy,bmesh,json,re,struct
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
WEB=ROOT/'outputs/md-lounge-web';OUT=WEB/'public/assets/experience-v11';OUT.mkdir(parents=True,exist_ok=True)
existing=set()
manifest=json.loads((WEB/'public/assets/scene-manifest.json').read_text())
for url in [manifest['collisions']['url'],*manifest['collisions']['additionalUrls']]:
 if '/experience-v11/' in url:continue
 raw=(WEB/'public'/url.lstrip('/')).read_bytes()
 asset=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
 existing.update(n.get('extras',{}).get('sourceName',n.get('name')) for n in asset['nodes'] if 'mesh' in n)
source=bpy.context.scene;source.frame_set(180);dg=bpy.context.evaluated_depsgraph_get()
# Reviewed omitted solid components, not name-based runtime guesses.
pattern=re.compile(r'guard glass|remaining glass|extension glass|front end glass|passage.*glass|cabinet rounded carcass|cabinet stone top|club feather wrapped seat|sofa individually sprung seat|retained shell pier|full-height pier|Hall front side lower pier|reference artwork pier|canopy end stone pier|closed bronze door|closed door stone|Closed shell double doors|studio entrance door glass|left extension glass|upper entrance glass',re.I)
selected=[o for o in source.objects if o.type=='MESH' and not o.hide_render and o.name not in existing and pattern.search(o.name)]
target=bpy.data.scenes.new('Additional source solids v11');records=[]
for o in selected:
 me=bpy.data.meshes.new_from_object(o.evaluated_get(dg),depsgraph=dg);me.transform(o.matrix_world)
 # Each chosen item is a single solid pane, pier, carcass or cushion. No room hulls.
 bm=bmesh.new();bm.from_mesh(me);bmesh.ops.delete(bm,geom=list(bm.faces),context="FACES_ONLY")
 result=bmesh.ops.convex_hull(bm,input=list(bm.verts),use_existing_faces=False)
 bmesh.ops.delete(bm,geom=list(set(result['geom_unused']+result['geom_interior'])),context='VERTS')
 bm.to_mesh(me);bm.free();me.materials.clear()
 while me.uv_layers:me.uv_layers.remove(me.uv_layers[0])
 obj=bpy.data.objects.new('COLLISION_'+o.name,me);target.collection.objects.link(obj)
 obj['sourceName']=o.name;obj['collisionShape']='convexHull';obj['collisionOnly']=True
 records.append({'sourceName':o.name,'vertices':len(me.vertices)})
bpy.context.window.scene=target
for o in target.objects:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'additional-solids.glb'),export_format='GLB',use_selection=True,use_active_scene=True,export_yup=True,export_materials='NONE',export_texcoords=False,export_normals=False,export_animations=False,export_cameras=False,export_lights=False,export_extras=True)
# Keep a small editable collision-only derivative. Never save over architectural source.
bpy.data.libraries.write(str(ROOT/'outputs/experience-v11/Additional_Colliders.blend'),{target})
(OUT/'coverage.json').write_text(json.dumps({'source':bpy.data.filepath,'objects':records,'count':len(records),'bytes':(OUT/'additional-solids.glb').stat().st_size},indent=2))
print('ADDITIONAL_SOLIDS',len(records),flush=True)
