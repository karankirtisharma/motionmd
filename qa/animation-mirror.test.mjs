import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudioAnimationMirror} from '../src/runtime/presentation/animationMirror.ts';

function fixture() {
  let id=0, frames=0;const callbacks=new Map(),timeline={currentTime:10000};
  const win={requestAnimationFrame:fn=>{callbacks.set(++id,fn);return id;},cancelAnimationFrame:id=>callbacks.delete(id)};
  class Animation extends EventTarget {
    constructor(effect,css){super();this.effect=effect;this.timeline=timeline;this._currentTime=0;this.timeWrites=0;this.playbackRate=1;this.playState='running';this.pending=false;this._startTime=null;if(css)this.animationName=css;}
    get currentTime(){return this._currentTime;}
    set currentTime(value){this._currentTime=value;this.timeWrites++;}
    get startTime(){return this._startTime;}
    set startTime(value){this._startTime=value;this.playState='running';}
    pause(){this.playState='paused';}
    cancel(){this.playState='idle';this.dispatchEvent(new Event('cancel'));}
    finish(){this.playState='finished';this.dispatchEvent(new Event('finish'));}
  }
  const effect=(target,frames=[{opacity:0},{opacity:1}],iterations=1)=>({target,pseudoElement:null,composite:'replace',iterationComposite:'replace',getKeyframes:()=>frames,getTiming:()=>({duration:250,fill:'both',iterations}),getComputedTiming:()=>({endTime:iterations===Infinity?Infinity:250})});
  const element=()=>({animations:[],getAnimations(){return this.animations.filter(a=>a.playState!=='idle');},animate(keyframes,options){const a=new Animation(effect(this,keyframes,options.iterations));a.options=options;this.animations.push(a);return a;}});
  const target=element(),source=element();source.ownerDocument={defaultView:win};source.contains=el=>el===target;source.getAnimations=()=>target.getAnimations();
  let copies=[element(),element()];const mirror=createStudioAnimationMirror({source,copies:()=>copies,onFrame:()=>frames++});
  const step=()=>{const tasks=[...callbacks.values()];callbacks.clear();tasks.forEach(fn=>fn());};
  return {source,target,mirror,Animation,effect,copies,replaceCopies:next=>{copies=next;},element,step,callbacks,timeline,get frames(){return frames;}};
}

test('Motion WAAPI opacity/transform effects are retargeted even without DOM style mutations',()=>{
 const f=fixture(),keyframes=[{opacity:0,transform:'translateX(80px)'},{opacity:1,transform:'none'}];
 const original=new f.Animation(f.effect(f.target,keyframes));original.currentTime=125;f.target.animations.push(original);f.step();
 for(const copy of f.copies){assert.equal(copy.animations.length,1);assert.deepEqual(copy.animations[0].effect.getKeyframes(),keyframes);assert.equal(copy.animations[0].startTime,9875);assert.equal(copy.animations[0].options.fill,'both');}
 assert.equal(f.mirror.hasActiveAnimations(),true);assert.equal(f.frames,1);f.mirror.dispose();
});
test('CSS animations reuse their native clone effects and synchronize phase across timeline origins',()=>{
 const f=fixture(),original=new f.Animation(f.effect(f.target,[],Infinity),'glint');original.currentTime=3500;f.target.animations.push(original);
 for(const copy of f.copies)copy.animations.push(new f.Animation(f.effect(copy,[],Infinity),'glint'));
 f.step();f.step();assert.equal(f.callbacks.size,0,'infinite CSS effects must not keep a RAF poll alive');
 for(const copy of f.copies){assert.equal(copy.animations.length,1);assert.equal(copy.animations[0].startTime,6500);}
 f.mirror.dispose();
});
test('discovery covers the frame after a mutation, then stops when no effects are active',()=>{
 const f=fixture();f.step();const original=new f.Animation(f.effect(f.target));original.currentTime=40;f.target.animations.push(original);f.step();
 assert.equal(f.copies[0].animations.length,1);original.currentTime=250;original.finish();f.step();f.step();
 assert.equal(f.callbacks.size,0);assert.equal(f.copies[0].animations[0].currentTime,250);f.mirror.dispose();
});
test('hidden visual surfaces pause their mirrors and resume at current source time',()=>{
 const f=fixture(),original=new f.Animation(f.effect(f.target));original.currentTime=25;f.target.animations.push(original);f.step();
 f.mirror.setVisible(false);assert.equal(f.callbacks.size,0);assert.equal(f.copies[0].animations[0].playState,'paused');
 original.currentTime=180;f.mirror.setVisible(true);f.step();assert.equal(f.copies[0].animations[0].startTime,9820);f.mirror.dispose();
});
test('canceled source effects and replaced clone roots release owned animations',()=>{
 const f=fixture(),original=new f.Animation(f.effect(f.target));f.target.animations.push(original);f.step();const old=f.copies[0].animations[0],newCopy=f.element();
 f.replaceCopies([newCopy]);f.mirror.refresh();f.step();assert.equal(old.playState,'idle');assert.equal(newCopy.animations.length,1);
 original.cancel();assert.equal(newCopy.animations[0].playState,'idle');f.mirror.dispose();assert.equal(f.callbacks.size,0);
});
test('CSS effect canceled by display:none culling reattaches at current phase and sleeps after unhide',()=>{
 const f=fixture(),original=new f.Animation(f.effect(f.target,[],Infinity),'glint');original.currentTime=200;f.target.animations.push(original);
 const copy=f.copies[0],first=new f.Animation(f.effect(copy,[],Infinity),'glint');copy.animations.push(first);f.step();first.cancel();
 f.mirror.refresh();f.step();f.step();assert.equal(f.callbacks.size,0);assert.equal(copy.animations.length,1,'culled CSS effect is not replaced by a duplicate WAAPI effect');
 original.currentTime=6000;f.timeline.currentTime=14000;
 const next=new f.Animation(f.effect(copy,[],Infinity),'glint');copy.animations.push(next);f.mirror.refresh();f.step();f.step();
 assert.equal(next.startTime,8000);assert.equal(copy.animations.length,2);assert.equal(f.callbacks.size,0,'unhidden infinite glints return to native timeline playback without polling');f.mirror.dispose();
});
test('repeated discoveries do not rewrite unchanged paused compositor times',()=>{
 const f=fixture(),original=new f.Animation(f.effect(f.target));original.currentTime=120;original.pause();f.target.animations.push(original);f.step();f.step();
 const replica=f.copies[0].animations[0];assert.equal(replica.currentTime,120);assert.equal(replica.timeWrites,1);assert.equal(f.callbacks.size,0);
 f.mirror.refresh();f.step();f.step();assert.equal(replica.timeWrites,1,'same held time must not invalidate the clone effect again');
 original.currentTime=175;f.mirror.refresh();f.step();f.step();assert.equal(replica.currentTime,175);assert.equal(replica.timeWrites,2);f.mirror.dispose();
});
