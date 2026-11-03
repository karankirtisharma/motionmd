import test from 'node:test';
import assert from 'node:assert/strict';
import {isMotionPopRule, motionPopStyles} from '../src/runtime/presentation/motionStyles.ts';

function popRule(id,left=240) {
  const selectorText=`[data-motion-pop-id="${id}"]`;
  return {type:1,selectorText,cssText:`${selectorText}{position:absolute!important;width:180px!important;height:260px!important;left:${left}px!important;top:125px!important;}`};
}

test('Motion CSSOM pop positions are mirrored even though the inline style node has no text',()=>{
  const pop=popRule('react-card-2'),sheet={href:null,cssRules:[pop],ownerNode:{textContent:''}};
  const document={styleSheets:[sheet]};
  assert.equal(motionPopStyles(document),pop.cssText);
  assert.ok(isMotionPopRule(pop),'temporary positions must be excluded from the permanent snapshot');
  sheet.cssRules[0]=popRule('react-card-2',258);
  assert.match(motionPopStyles(document),/left:258px!important/,'Motion microtask correction replaces the initial CSSOM rule');
});

test('removing a completed exit stylesheet releases the temporary positioning',()=>{
  const document={styleSheets:[{href:null,cssRules:[popRule('outgoing')]}]};
  assert.notEqual(motionPopStyles(document),'');
  document.styleSheets=[];
  assert.equal(motionPopStyles(document),'','no stale pop position survives when a film returns later');
});

test('dynamic mirror excludes unrelated static rules and unreadable external sheets',()=>{
  let externalReads=0;
  const normal={type:1,selectorText:'.card',cssText:'.card{display:block}'};
  const external={href:'https://cdn.test/app.css',get cssRules(){externalReads++;throw Error('cross origin');}};
  const document={styleSheets:[external,{href:null,cssRules:[normal]},{href:null,cssRules:[popRule('card')]}]};
  assert.equal(motionPopStyles(document),popRule('card').cssText);
  assert.equal(isMotionPopRule(normal),false);assert.equal(externalReads,0);
});
