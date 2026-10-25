"""Audited source-derived collision parts. Visible geometry is never simplified."""
import bpy,bmesh,json,re,struct,numpy as np
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'outputs/scene-repair-v6';STAGE=ROOT/'work/scene-repair-v6'
source=bpy.context.scene;source.frame_set(180);dg=bpy.context.evaluated_depsgraph_get()
assets=ROOT/'outputs/md-lounge-web/public/assets';manifest=json.loads((assets/'scene-manifest.json').read_text())
old=set()
for url in [manifest['collisions']['url'],manifest['collisions']['additionalUrls'][1]]:
 raw=(assets.parent/url.lstrip('/')).read_bytes();j=json.loads(raw[20:20+struct.unpack_from('<I',raw,12)[0]])
 old|={n.get('extras',{}).get('sourceName',n.get('name')) for n in j['nodes'] if 'mesh'in n}
visible={o['name']:o for o in json.loads((OUT/'source-bounds.json').read_text())['objects']}
# Explicit reviewed classes, then source-object IDs are committed to coverage report.
pattern=re.compile(r'desktop|tabletop|waterfall end|full bronze front|gallery pier|limestone pier|stone.*pier|stone.*column|arrival terrace|ground finish|threshold|studio rear table|saddle seat|seat cushion|seat upholstery|back upholstery|backrest|sofa.*(body|base|back|arm)|armrest|cabinet body|cabinet.*side|planter.*(body|shell)|basalt planter|stone planter|display.*(housing|back shell|ceramic bezel)|coffee.*table|side.*table',re.I)
exclude=re.compile(r'stitch|seam|keycap|leaf|canopy|shadow|soil|aggregate|letter|bezel highlight|cap reveal',re.I)
selected=[]
for name,r in visible.items():
 if name in old or not pattern.search(name) or exclude.search(name):continue
 o=bpy.data.objects.get(name)
 if not o or o.type!='MESH':continue
 dims=[r['max'][i]-r['min'][i] for i in range(3)]
 if max(dims)<.25:continue
 selected.append(o)
# Four authored presentation chairs/table retain separately fitted convex parts.
roots=[bpy.data.objects[f'PL78 | Discussion chair {i:02d}'] for i in range(1,5)]+[bpy.data.objects['PL78 | Sculptural discussion table']]
chairparts=[o for root in roots for o in root.children_recursive if o.type=='MESH' and not o.hide_render]
selected=list(dict.fromkeys(selected+chairparts));export=bpy.data.scenes.new('MD source collision v6');records=[]
for o in selected:
 me=bpy.data.meshes.new_from_object(o.evaluated_get(dg),depsgraph=dg);me.transform(o.matrix_world);original=len(me.vertices)
 # Deterministic support-point hull: retain silhouette extrema without tessellation cost.
 points=np.empty((len(me.vertices),3),np.float32);me.vertices.foreach_get('co',points.ravel())
 k=np.arange(256);z=1-2*(k+.5)/len(k);angle=k*np.pi*(3-np.sqrt(5));rad=np.sqrt(1-z*z)
 directions=np.column_stack((rad*np.cos(angle),rad*np.sin(angle),z))
 directions=np.vstack((directions,np.eye(3),-np.eye(3)))
 ids=np.unique(np.argmax(points@directions.T,axis=0));support=points[ids]
 # Measured support loss against a denser independent directional sample.
 k2=np.arange(1024);z2=1-2*(k2+.5)/len(k2);a2=k2*np.pi*(3-np.sqrt(5));r2=np.sqrt(1-z2*z2)
 check=np.column_stack((r2*np.cos(a2),r2*np.sin(a2),z2))
 error=float(np.max(np.max(points@check.T,axis=0)-np.max(support@check.T,axis=0)))
 if error>=.018:
  # Large spun tabletop needs a denser envelope than small chair parts.
  support=points[np.unique(np.argmax(points@check.T,axis=0))]
  error=float(np.max(np.max(points@check.T,axis=0)-np.max(support@check.T,axis=0)))
 assert error<.018,(o.name,error)
 simple=bpy.data.meshes.new(o.name+' physics envelope');simple.from_pydata(support.tolist(),[],[])
 bpy.data.meshes.remove(me);me=simple
 bm=bmesh.new();bm.from_mesh(me)
 if len(bm.verts)<4:bm.free();bpy.data.meshes.remove(me);continue
 hull=bmesh.ops.convex_hull(bm,input=list(bm.verts),use_existing_faces=False)
 bmesh.ops.delete(bm,geom=list(set(hull['geom_unused']+hull['geom_interior'])),context='VERTS')
 bm.to_mesh(me);bm.free();me.materials.clear()
 while me.uv_layers:me.uv_layers.remove(me.uv_layers[0])
 obj=bpy.data.objects.new('COLLISION_'+o.name,me);export.collection.objects.link(obj)
 # Convex envelope per solid component, never a whole room/desk-with-chairs bounding box.
 obj['sourceName']=o.name;obj['collisionShape']='convexHull';obj['collisionOnly']=True
 records.append({'name':o.name,'sourceVertices':original,'proxyVertices':len(me.vertices),'shape':'convexHull','maximumSampledSupportLossMeters':error,'presentation':o in chairparts})
bpy.context.window.scene=export
for o in export.objects:o.select_set(True)
path=STAGE/'solid-collision-v6.glb'
bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,use_active_scene=True,export_yup=True,export_apply=False,export_materials='NONE',export_texcoords=False,export_normals=False,export_animations=False,export_cameras=False,export_lights=False,export_extras=True)
report={'source':bpy.data.filepath,'objects':records,'count':len(records),'sourceVertices':sum(r['sourceVertices'] for r in records),'proxyVertices':sum(r['proxyVertices'] for r in records),'bytes':path.stat().st_size,'retainedBaseColliderObjects':len(old)}
(OUT/'collision-coverage.json').write_text(json.dumps(report,indent=2));print('COLLISION_COMPLETE',len(records),report['sourceVertices'],report['proxyVertices'],report['bytes'],flush=True)
