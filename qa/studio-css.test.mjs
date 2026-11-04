import test from 'node:test';
import assert from 'node:assert/strict';
import {serializeStudioCSS} from '../src/runtime/presentation/studioCss.ts';
const options=()=>({width:1600,height:558,matches:q=>q==='(min-aspect-ratio: 5/2)',fonts:[]});
const style=(selectorText,cssText,cssRules=[])=>({type:1,selectorText,style:{cssText},cssRules,cssText:`${selectorText}{${cssText}}`});
test('modern CSSStyleRule with empty cssRules retains its real declarations',()=>{
 const result=serializeStudioCSS([style('.card','position: absolute; width: 20vw; border-radius: 28px;')],'https://site.test/styles/main.css',options());
 assert.equal(result,'.card{position: absolute; width: 320px; border-radius: 28px;}');
});
test('nested responsive CSS is evaluated against the original iframe viewport',()=>{
 const media=(conditionText)=>({type:4,conditionText,cssRules:[style('& .label','height: 10dvh;')]});
 const result=serializeStudioCSS([style('.card','display: block;',[media('(min-aspect-ratio: 5/2)'),media('(orientation: portrait)')])],'https://site.test/main.css',options());
 assert.equal(result,'.card{display: block;& .label{height: 55.8px;}\n}');
});
test('imported style declarations survive constructed-stylesheet serialization',()=>{
 const result=serializeStudioCSS([{type:3,styleSheet:{href:'https://site.test/css/import.css',cssRules:[style('.glass','background: url(../gold.webp);')]}}],'https://site.test/main.css',options());
 assert.equal(result,'.glass{background: url("https://site.test/gold.webp");}');
});
test('interactive pseudo states are mirrored without rewriting declaration values',()=>{
 const result=serializeStudioCSS([style('.card:hover .hit:focus-visible','content: ":hover";')],'https://site.test/main.css',options());
 assert.equal(result,'.card[data-tv-hover] .hit[data-tv-focus-visible]{content: ":hover";}');
});
test('font faces stay available to the parent document and shadow fragments',()=>{
 const p=options(),result=serializeStudioCSS([{type:5,cssText:'@font-face{font-family: Studio;src:url(../studio.woff2)}'}],'https://site.test/css/main.css',p);
 assert.equal(p.fonts.length,1);assert.equal(result,p.fonts[0]);assert.ok(result.includes('https://site.test/studio.woff2'));
});

test('embedded SVG grain keeps its nested filter URL rather than fetching %23n',()=>{
 const grain=`url("data:image/svg+xml,%3Csvg width='220'%3E%3Crect filter='url(%23n)'/%3E%3C/svg%3E")`;
 const result=serializeStudioCSS([style('.grain','background-image: '+grain+';')],'https://site.test/chunks/style.css',options());
 assert.equal(result,'.grain{background-image: '+grain+';}');
});
