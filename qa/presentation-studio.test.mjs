import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, PerspectiveCamera, Mesh, PlaneGeometry, MeshBasicMaterial, NoBlending } from 'three';
import { createPresentationScreen } from '../src/runtime/presentation/PresentationScreen.ts';
import { screenHomography, mapScreenPoint } from '../src/runtime/presentation/projection.ts';

test('perspective mapping lands all four real screen corners and its interior correctly', () => {
  for (const quad of [ [{x:20,y:40},{x:820,y:40},{x:820,y:440},{x:20,y:440}],
    [{x:-100,y:120},{x:1100,y:20},{x:950,y:600},{x:40,y:500}] ]) {
    const m = screenHomography(quad,1600,560);
    for (const [i,[x,y]] of [[0,[0,0]],[1,[1600,0]],[2,[1600,560]],[3,[0,560]]]) {
      const p=mapScreenPoint(m,x,y); assert.ok(Math.hypot(p.x-quad[i].x,p.y-quad[i].y)<1e-8);
    }
    assert.ok(Number.isFinite(mapScreenPoint(m,800,280).x));
  }
  assert.equal(screenHomography(Array(4).fill({x:0,y:0}),1600,560),null);
});

class Element extends EventTarget {
  style={}; dataset={}; children=[]; attrs=new Map(); parentElement=null; hidden=false;
  constructor(tag) { super(); this.tagName=tag; this.contentWindow={postMessage:(...args)=>this.messages.push(args)}; this.messages=[]; }
  append(child){this.children.push(child);child.parentElement=this;}
  prepend(child){this.children.unshift(child);child.parentElement=this;}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(c=>c!==this);}
  setAttribute(k,v){this.attrs.set(k,v);} removeAttribute(k){this.attrs.delete(k);}
  contains(target){return this===target||this.children.some(c=>c.contains(target));}
  focus(){this.focused=true;}
  animate(){return {finished:Promise.resolve(),cancel(){}};}
}
function fixture(t) {
  const saved={document:globalThis.document,window:globalThis.window,location:globalThis.location,innerWidth:globalThis.innerWidth,innerHeight:globalThis.innerHeight};
  const doc=new Element('DOCUMENT'); doc.body=new Element('BODY');doc.hidden=false;doc.createElement=tag=>new Element(tag);
  globalThis.document=doc;globalThis.window=new EventTarget();window.innerWidth=800;window.innerHeight=600;
  globalThis.innerWidth=800;globalThis.innerHeight=600;globalThis.location={origin:'https://lounge.test'};
  const viewport=new Element('DIV'),canvas=new Element('CANVAS');viewport.append(canvas);
  const scene=new Scene(),original=new MeshBasicMaterial({color:0x987654}), mesh=new Mesh(new PlaneGeometry(4,2),original);
  // Authored GLB uses top-left origin, like the actual browser viewport.
  const uv=mesh.geometry.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setY(i,1-uv.getY(i));
  mesh.name='PL78 | curved LED pixel surface';scene.add(mesh);
  const founder=new Mesh(new PlaneGeometry(3,2),new MeshBasicMaterial());founder.name='Founder | curved LED pixel surface';scene.add(founder);
  const founderOriginal=founder.material;scene.updateMatrixWorld(true);
  const camera=new PerspectiveCamera(60,4/3,.1,100);camera.position.z=5;camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
  const opens=[];let clear=true, inView=true;
  const display=createPresentationScreen({scene,camera,canvas,objectName:mesh.name,onOpen:r=>opens.push(r),isUnobstructed:()=>clear,isInView:()=>inView});
  const host=doc.body.children[0], frame=()=>host.children.find(c=>c.tagName==='iframe');
  const message=(type,origin=location.origin,source=frame()?.contentWindow)=>{
    const event=new Event('message');Object.assign(event,{origin,source,data:{type}});window.dispatchEvent(event);
  };
  const move=(x=400,y=300)=>{const event=new Event('pointermove');Object.assign(event,{clientX:x,clientY:y,buttons:0});Object.defineProperty(event,'target',{value:canvas});window.dispatchEvent(event);};
  t.after(()=>{display.dispose();mesh.geometry.dispose();original.dispose();founder.geometry.dispose();founder.material.dispose();Object.assign(globalThis,saved);});
  return {display,host,frame,message,move,mesh,original,founder,founderOriginal,canvas,camera,opens,setClear:v=>{clear=v},setInView:v=>{inView=v}};
}

test('live screen mounts only in view and retains one real browsing session across updates and focus',t=>{
  const f=fixture(t);assert.equal(f.frame(),undefined);
  f.display.update();const frame=f.frame();assert.ok(frame.src.startsWith('/studio?embed=lounge&display=tv'));
  f.display.setActive(true);f.message('md-studio:ready');
  for(let i=0;i<120;i++)f.display.update();assert.equal(f.frame(),frame);
  assert.equal(f.host.children.filter(c=>c.tagName==='iframe').length,1);
  assert.equal(f.founder.material,f.founderOriginal);
  assert.equal(f.mesh.material.blending,NoBlending);assert.equal(f.mesh.material.depthTest,true);
  assert.equal(f.mesh.material.depthWrite,true);
});

test('native screen input is enabled only over visible, unoccluded geometry',t=>{
  const f=fixture(t);f.display.update();f.display.setActive(true);
  f.move();assert.equal(f.canvas.style.pointerEvents,'none');
  f.display.setActive(false);assert.equal(f.canvas.style.pointerEvents,'');
  f.move();assert.equal(f.canvas.style.pointerEvents,'');
  f.display.setActive(true);f.setClear(false);f.move();assert.equal(f.canvas.style.pointerEvents,'');
  f.setClear(true);f.move(0,0);assert.equal(f.canvas.style.pointerEvents,'');
});

test('offscreen studio suspends media, refuses hidden expansion, and resumes without reloading',t=>{
  const f=fixture(t);f.display.update();f.display.setActive(true);f.message('md-studio:ready');
  const frame=f.frame();f.camera.lookAt(0,0,10);f.display.update();
  assert.equal(f.host.style.visibility,'hidden');
  assert.equal(frame.messages.at(-1)[0].type,'md-studio:suspend');
  f.display.setAction('studio');assert.equal(f.opens.length,0);
  f.camera.lookAt(0,0,0);f.display.update();assert.equal(f.frame(),frame);
  assert.equal(frame.messages.at(-1)[0].type,'md-studio:resume');
});

test('expansion accepts only this iframe and this origin; it never creates a second session',async t=>{
  const f=fixture(t);f.display.update();f.display.setActive(true);
  f.message('md-studio:expand','https://other.test');f.message('md-studio:expand',location.origin,{});assert.equal(f.opens.length,0);
  f.message('md-studio:expand');assert.equal(f.opens.length,1);assert.ok(f.opens[0].width>100);
  const frame=f.frame();window.dispatchEvent(new CustomEvent('md-studio:layout',{detail:{open:true,reducedMotion:true}}));await Promise.resolve();
  assert.equal(f.frame(),frame);assert.equal(f.host.attrs.get('aria-modal'),'true');
  window.dispatchEvent(new CustomEvent('md-studio:layout',{detail:{open:false,reducedMotion:true}}));await Promise.resolve();
  assert.equal(f.frame(),frame);assert.equal(f.host.style.zIndex,'0');
});

test('disposal restores authored materials and releases DOM, timers and pointer routing exactly once',t=>{
  const f=fixture(t);f.display.update();f.display.setActive(true);let disposals=0;
  f.mesh.material.addEventListener('dispose',()=>disposals++);f.display.dispose();f.display.dispose();
  assert.equal(disposals,1);assert.equal(f.mesh.material,f.original);assert.equal(document.body.children.length,0);
  f.move();f.message('md-studio:expand');assert.equal(f.opens.length,0);assert.equal(f.canvas.style.pointerEvents,'');
});


test('a screen behind a room wall does not load the studio until the sightline clears',t=>{
  const f=fixture(t);f.setInView(false);f.display.update();
  assert.equal(f.frame(),undefined);assert.equal(f.host.style.visibility,'hidden');
  f.setInView(true);f.camera.position.x=.1;f.display.update();
  assert.ok(f.frame());assert.equal(f.host.style.visibility,'visible');
});

test('keyboard activation remains usable independently of pointer occlusion',t=>{
  const f=fixture(t);f.display.update();f.display.setActive(true);
  const frame=f.frame();frame.contentDocument=new EventTarget();frame.dispatchEvent(new Event('load'));
  f.setClear(false);
  const keyboard=new Event('click',{cancelable:true});Object.assign(keyboard,{detail:0,clientX:0,clientY:0});
  frame.contentDocument.dispatchEvent(keyboard);assert.equal(keyboard.defaultPrevented,false);
  const mouse=new Event('click',{cancelable:true});Object.assign(mouse,{detail:1,clientX:0,clientY:0});
  frame.contentDocument.dispatchEvent(mouse);assert.equal(mouse.defaultPrevented,true);
});
