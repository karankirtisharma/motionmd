import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveStudioSurface} from '../src/runtime/presentation/LiveStudioSurface.ts';
import {screenHomography,mapScreenPoint} from '../src/runtime/presentation/projection.ts';

class TestWindow extends EventTarget {
  location={origin:'https://lounge.test'}; innerWidth=800; innerHeight=600; messages=[];
  postMessage(...args){this.messages.push(args);}
  getComputedStyle(element){return element.style;}
}
class Element extends EventTarget {
  childNodes=[]; style={pointerEvents:'',zIndex:''}; dataset={}; attrs=new Map(); textContent='';
  constructor(name,doc){super();this.tagName=name.toUpperCase();this.ownerDocument=doc;}
  append(...nodes){for(const n of nodes){n.remove();n.parentElement=this;this.childNodes.push(n);}}
  prepend(node){node.remove();node.parentElement=this;this.childNodes.unshift(node);}
  remove(){if(this.parentElement){const p=this.parentElement;p.childNodes.splice(p.childNodes.indexOf(this),1);this.parentElement=null;}}
  setAttribute(name,value){this.attrs.set(name,String(value));}
  getAttribute(name){return this.attrs.get(name)??null;}
  removeAttribute(name){this.attrs.delete(name);}
  focus(){this.ownerDocument.activeElement=this;}
  getBoundingClientRect(){return {left:0,top:0,width:800,height:600};}
  animate(keyframes){
    let resolve,reject;
    const animation={keyframes,finished:new Promise((yes,no)=>{resolve=yes;reject=no;}),finish:()=>resolve(),cancel:()=>reject(Error('cancelled'))};
    this.ownerDocument.animations.push(animation);return animation;
  }
}
class Doc extends EventTarget {
  defaultView=new TestWindow(); animations=[]; hidden=false; pointerLockElement=null;
  constructor(){super();this.body=new Element('body',this);this.activeElement=this.body;}
  hasFocus(){return true;}
  createElement(name){
    const e=new Element(name,this);
    if(name==='iframe'){e.contentDocument=new Doc();e.contentWindow=e.contentDocument.defaultView;e.assignments=0;
      let url;Object.defineProperty(e,'src',{get:()=>url,set:v=>{url=v;e.assignments++;}});}
    return e;
  }
}
function send(target,type,values={},eventTarget=target){
  const event=new Event(type,{cancelable:true});
  Object.assign(event,values);Object.defineProperty(event,'target',{value:eventTarget});target.dispatchEvent(event);return event;
}
const matrix=screenHomography([{x:50,y:50},{x:740,y:100},{x:680,y:430},{x:118,y:380}],1600,558);
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(t) {
  const doc=new Doc(),win=doc.defaultView,previous=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{value:win,configurable:true});
  const viewport=doc.createElement('div'),canvas=doc.createElement('canvas');viewport.append(canvas);doc.body.append(viewport);
  const aperture=[],rays=[];let clear=true,opens=0,focuses=0;
  const surface=createLiveStudioSurface({canvas,aspect:1600/558,onAperture:live=>aperture.push(live),onExpand:()=>{opens++;},onFocus:()=>{focuses++;doc.pointerLockElement=null;},
    sampleSurface:(x,y)=>{rays.push([x,y]);return clear?{u:.5,v:.5}:null;}});
  const host=doc.body.childNodes.find(e=>Object.hasOwn(e.dataset,'liveStudio'));
  const frame=()=>host.childNodes.find(e=>e.tagName==='IFRAME');
  function message(type,origin=win.location.origin,source=frame()?.contentWindow){return send(win,'message',{origin,source,data:{type}});}
  function ready(){
    surface.setInteractive(true);surface.update(true,matrix);send(frame(),'load');message('md-studio:ready');return frame();
  }
  t.after(()=>{surface.dispose();if(previous)Object.defineProperty(globalThis,'window',previous);else delete globalThis.window;});
  return {doc,win,host,viewport,canvas,frame,ready,message,surface,aperture,rays,setClear:v=>{clear=v;},opens:()=>opens,focuses:()=>focuses,
    move:(x,y,target=canvas)=>send(win,'pointermove',{clientX:x,clientY:y,buttons:0},target),
    child:(name,overrides={})=>send(frame().contentWindow,name,{clientX:800,clientY:279,button:0,buttons:name==='pointerdown'?1:0,pointerId:4,detail:1,...overrides})};
}

test('one visible native frame registers the same planar corners as world ray coordinates',t=>{
  const f=fixture(t);f.surface.update(false,null);assert.ok(f.frame());
  f.surface.setInteractive(true);f.surface.update(true,matrix);const frame=f.frame();
  assert.equal(frame.src,'/studio?embed=lounge&display=tv&f=1&i=3&attempt=1');
  assert.equal(f.host.style.visibility,'hidden');assert.deepEqual(f.aperture,[]);
  f.message('md-studio:ready','https://other.test');assert.equal(f.host.style.visibility,'hidden');
  f.ready();assert.equal(f.host.style.visibility,'visible');assert.equal(f.viewport.style.zIndex,'1');
  assert.equal(f.host.style.zIndex,'0');assert.equal(f.host.style.transform,'matrix3d('+matrix.join(',')+')');
  assert.deepEqual(f.aperture,[true]);assert.equal(frame.assignments,1);
  const clip='polygon(0px 40px, 1600px 0px, 1600px 558px, 0px 558px)';
  f.surface.update(true,matrix,clip);assert.equal(f.host.style.clipPath,clip);
  f.child('wheel');const hit=mapScreenPoint(matrix,800,279);assert.deepEqual(f.rays.at(-1),[hit.x,hit.y]);
  assert.equal(f.canvas.style.pointerEvents,'none');assert.equal(frame.assignments,1);
});

test('Studio prepares before its first visible view and remains suspended without duplicate frames',t=>{
  const f=fixture(t),frame=f.frame();
  assert.ok(frame,'preload starts during screen construction, not first camera visibility');
  assert.equal(frame.assignments,1);
  assert.equal(f.host.style.visibility,'hidden');
  assert.equal(frame.tabIndex,-1);
  f.message('md-studio:ready');
  assert.equal(frame.contentWindow.messages.at(-1)[0].type,'md-studio:suspend');
  assert.deepEqual(f.aperture,[]);
  for(let i=0;i<3;i++) f.surface.update(false,null);
  assert.equal(frame.assignments,1);
  f.surface.update(true,matrix);
  assert.equal(f.host.style.visibility,'visible');
  assert.equal(frame.contentWindow.messages.at(-1)[0].type,'md-studio:resume');
  assert.deepEqual(f.aperture,[true]);
  assert.equal(f.frame(),frame);
  assert.equal(frame.assignments,1);
});

test('camera motion preserves native DOM and hides/reveals the aperture without restarting Studio',t=>{
  const f=fixture(t),frame=f.ready();const note=frame.contentDocument.createElement('input');note.value='Unsent brief';frame.contentDocument.body.append(note);
  const moved=matrix.slice();moved[12]+=18;f.surface.update(true,moved);
  assert.equal(f.host.style.transform,'matrix3d('+moved.join(',')+')');assert.equal(f.frame(),frame);assert.equal(frame.assignments,1);
  f.surface.update(false,null);assert.equal(f.host.style.visibility,'hidden');assert.deepEqual(f.aperture,[true,false]);
  assert.equal(frame.contentWindow.messages.at(-1)[0].type,'md-studio:suspend');
  f.surface.update(true,moved);assert.deepEqual(f.aperture,[true,false,true]);assert.equal(note.value,'Unsent brief');
  assert.equal(frame.contentWindow.messages.at(-1)[0].type,'md-studio:resume');
});

test('expanding and returning keep the same real page, focus, form state and screen registration',async t=>{
  const f=fixture(t),frame=f.ready(),field=frame.contentDocument.createElement('input');frame.contentDocument.body.append(field);field.value='Draft';
  send(f.win,'md-studio:layout',{detail:{open:true,reducedMotion:false}});f.doc.animations.at(-1).finish();await pause();
  assert.equal(f.host.style.width,'100vw');assert.equal(f.host.getAttribute('aria-modal'),'true');assert.equal(f.frame(),frame);
  assert.deepEqual(f.aperture,[true,false]);assert.equal(f.doc.activeElement,frame);
  send(f.win,'md-studio:layout',{detail:{open:false,reducedMotion:false}});f.doc.animations.at(-1).finish();await pause();
  assert.equal(f.host.style.zIndex,'0');assert.equal(f.host.style.transform,'matrix3d('+matrix.join(',')+')');
  assert.equal(f.frame(),frame);assert.equal(frame.assignments,1);assert.equal(field.value,'Draft');assert.equal(f.doc.activeElement,f.canvas);
  assert.deepEqual(f.aperture,[true,false,true]);
});

test('an occluding chair keeps pointer input on the scene and stale transitions cannot replace a page',async t=>{
  const f=fixture(t),frame=f.ready();f.move(300,220);assert.equal(f.canvas.style.pointerEvents,'none');
  f.setClear(false);f.surface.update(true,matrix);assert.equal(f.canvas.style.pointerEvents,'');
  assert.equal(f.child('click').defaultPrevented,true);assert.equal(f.child('click',{detail:0}).defaultPrevented,false);
  f.setClear(true);f.move(300,220);const hud=f.doc.createElement('button');f.move(300,220,hud);assert.equal(f.canvas.style.pointerEvents,'');
  for(const open of [true,false,true])send(f.win,'md-studio:layout',{detail:{open,reducedMotion:true}});
  f.doc.animations.at(-1).finish();await pause();assert.equal(f.host.style.width,'100vw');assert.equal(frame.assignments,1);
});

test('native drag finishes before the renderer reclaims the cursor and return-to-room restores keyboard ownership',async t=>{
  const f=fixture(t),frame=f.ready();f.move(300,220);f.child('pointerdown');f.setClear(false);
  f.surface.update(true,matrix);assert.equal(f.canvas.style.pointerEvents,'none');
  assert.equal(f.child('pointermove',{buttons:1}).defaultPrevented,false);
  f.child('pointerup');await pause();assert.equal(f.canvas.style.pointerEvents,'');
  frame.focus();f.message('md-studio:exit');assert.equal(f.doc.activeElement,f.canvas);
});

test('first touch or pointer-lock press focuses the native page only on the visible physical screen',t=>{
  const f=fixture(t),frame=f.ready();f.setClear(false);
  const press=()=>send(f.win,'pointerdown',{clientX:36,clientY:20,button:0,pointerType:'touch'},f.canvas);
  assert.equal(press().defaultPrevented,false);f.setClear(true);f.doc.pointerLockElement=f.canvas;
  assert.equal(press().defaultPrevented,true);assert.deepEqual(f.rays.at(-1),[400,300]);assert.equal(f.focuses(),1);
  assert.equal(f.doc.activeElement,frame);assert.equal(f.doc.pointerLockElement,null);
  f.surface.setInteractive(false);assert.equal(f.doc.activeElement,f.canvas);assert.equal(f.canvas.style.pointerEvents,'');
});

test('only the actual same-origin Studio may request expansion; teardown restores scene styles',t=>{
  const f=fixture(t);f.ready();f.message('md-studio:expand','https://other.test');f.message('md-studio:expand',f.win.location.origin,{});
  assert.equal(f.opens(),0);f.message('md-studio:expand');assert.equal(f.opens(),1);
  f.move(300,220);f.surface.dispose();assert.equal(f.canvas.style.pointerEvents,'');assert.equal(f.viewport.style.zIndex,'');
  assert.deepEqual(f.aperture,[true,false]);assert.ok(!f.doc.body.childNodes.includes(f.host));
});


test('failed Studio hydration retries once and a ready page is never reloaded',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture(t),frame=f.frame();
  send(frame,'load');
  t.mock.timers.tick(7999);assert.equal(frame.assignments,1);
  t.mock.timers.tick(1);assert.equal(frame.assignments,2);
  assert.equal(f.host.dataset.studioAttempt,'2');
  f.message('md-studio:ready');
  t.mock.timers.tick(90000);assert.equal(frame.assignments,2);
  assert.equal(f.host.dataset.studioState,'live');
});
