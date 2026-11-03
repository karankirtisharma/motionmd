import { curvedSliceClip } from './sliceClip.ts';
import { serializeStudioCSS } from './studioCss.ts';
import { createStudioAnimationMirror } from './animationMirror.ts';

export type StudioSurfacePatch = { matrix: number[] | null; visible: boolean; left: number; width: number };
type Options = { parent: HTMLElement; document: Document; width: number; height: number; onReady?: () => void };

/** Visual fragments of ONE live Studio document. These are inert DOM, not apps or
 * iframes: the original session remains the sole owner of input and application state. */
export function createCurvedStudioView(options: Options) {
  const sourceDocument = options.document, sourceWindow = sourceDocument.defaultView;
  const source = sourceDocument.querySelector<HTMLElement>('#md-studio-root');
  if (!source || !sourceWindow) throw new Error('The live Studio root is not ready.');
  const owner = options.parent.ownerDocument;
  const view = owner.createElement('div');view.dataset.curvedStudioView='';
  Object.assign(view.style,{position:'fixed',inset:'0',overflow:'hidden',pointerEvents:'none',visibility:'hidden'});
  options.parent.append(view);
  const fontRules:string[]=[];
  function cssRules(rules:CSSRuleList,base:string):string {
    return serializeStudioCSS(rules,base,{width:options.width,height:options.height,
      matches:query=>sourceWindow!.matchMedia(query).matches,fonts:fontRules});
  }
  let css='';
  for (const sheet of Array.from(sourceDocument.styleSheets)) { try { css+=cssRules(sheet.cssRules,sheet.href||sourceDocument.baseURI)+'\n'; } catch { /* same-origin Studio sheets are readable */ } }
  css+='\n:host{display:block;contain:paint;pointer-events:none}*{will-change:auto!important}[data-tv-slice-culled]{display:none!important}.stage{position:absolute!important;inset:0!important}';
  const sheet = new CSSStyleSheet();sheet.replaceSync(css);
  const fonts=owner.createElement('style');fonts.dataset.curvedStudioFonts='';fonts.textContent=fontRules.join('\n');owner.head.append(fonts);
  const copies = new WeakMap<Node,Node[]>();
  const previousStates=new Map<string,Set<Element>>();
  const animations = createStudioAnimationMirror({source, copies: element => (copies.get(element) || []) as Element[], onFrame: () => schedule()});
  type Slice={host:HTMLElement;root:HTMLElement;left:number;width:number;transform:string};
  const slices:Slice[]=[];
  let built=false,resolveReady!:()=>void;const ready=new Promise<void>(resolve=>{resolveReady=resolve;});
  let patches:StudioSurfacePatch[]=[],visible=false,disposed=false,frame=0,buildTimer:ReturnType<typeof setTimeout>|undefined;
  let queued:MutationRecord[]=[],candidates:HTMLElement[]=[],structureDirty=true,needsResync=false;
  const attributeChanges=new Map<Node,Map<string,MutationRecord>>(),textChanges=new Map<Node,MutationRecord>();
  let resyncIndex=0;
  function bind(src:Node,dst:Node,index:number) {
    let row=copies.get(src);if(!row){row=[];copies.set(src,row);}row[index]=dst;
    for(const [state,elements] of previousStates)if(elements.has(src as Element))(dst as Element).toggleAttribute(`data-tv-${state}`,true);
    for(let i=0;i<src.childNodes.length;i++)bind(src.childNodes[i],dst.childNodes[i],index);
  }
  function rootStyle(root:HTMLElement,left:number) {
    Object.assign(root.style,{position:'relative',left:`${-left}px`,top:'0',width:`${options.width}px`,height:`${options.height}px`,margin:'0',transform:'translateZ(0)',visibility:'inherit',opacity:'1'});
  }
  function measure() {
    if(structureDirty){candidates=Array.from(source!.querySelectorAll<HTMLElement>('.at,.card'));structureDirty=false;}
    return candidates.map(element=>({element,rect:element.getBoundingClientRect()}));
  }
  function cull(boxes:ReturnType<typeof measure>) {
    let changed=false;
    for(const {element,rect} of boxes) for(let i=0;i<slices.length;i++) {
      const copy=copies.get(element)?.[i] as HTMLElement|undefined;if(!copy)continue;
      const slice=slices[i],outside=rect.right<slice.left-40||rect.left>slice.left+slice.width+40||rect.bottom< -40||rect.top>options.height+40;
      if(copy.hasAttribute('data-tv-slice-culled')!==outside){copy.toggleAttribute('data-tv-slice-culled',outside);changed=true;}
    }
    // Off-strip cards have no painted/filter surfaces. When revealed, their
    // recreated CSS effects must resume at the real document's current phase.
    if(changed)animations.refresh();
  }
  function applyPatch(slice:Slice,patch:StudioSurfacePatch) {
    const clipped=curvedSliceClip(patch.matrix,patch.width,options.height);
    const transform=clipped.matrix?`matrix3d(${clipped.matrix.join(',')})`:'';
    if(slice.transform!==transform){
      slice.transform=transform;slice.host.style.transform=transform;
      slice.host.style.width=`${patch.width+clipped.overlap*2}px`;
      slice.root.style.left=`${-patch.left+clipped.overlap}px`;
    }
    slice.host.style.visibility=visible&&built&&patch.visible?'visible':'hidden';
  }
  function build() {
    if(disposed)return;
    const boxes=measure(),end=Math.min(patches.length,slices.length+2);
    for(let i=slices.length;i<end;i++) {
      const patch=patches[i],host=owner.createElement('div');host.dataset.curvedStudioSlice=String(i);
      // The source stage is already opaque. A second host background bleeds
      // through independently antialiased fragment edges as dark vertical seams.
      Object.assign(host.style,{position:'absolute',left:'0',top:'0',width:`${patch.width+.02}px`,height:`${options.height}px`,overflow:'hidden',transformOrigin:'0 0',pointerEvents:'none'});
      const shadow=host.attachShadow({mode:'open'});shadow.adoptedStyleSheets=[sheet];
      const root=source!.cloneNode(true) as HTMLElement;bind(source!,root,i);rootStyle(root,patch.left);
      root.inert=true;root.setAttribute('aria-hidden','true');shadow.append(root);view.append(host);
      const slice={host,root,left:patch.left,width:patch.width,transform:''};slices.push(slice);applyPatch(slice,patch);
    }
    cull(boxes);
    if(slices.length<patches.length)buildTimer=setTimeout(build,0);else{buildTimer=undefined;built=true;for(let i=0;i<slices.length;i++)applyPatch(slices[i],patches[i]);animations.refresh();resolveReady();options.onReady?.();}
  }
  function flush() {
    frame=0;if(disposed||!visible)return;
    const changes=[...queued,...Array.from(attributeChanges.values()).flatMap(row=>Array.from(row.values())),...textChanges.values()];
    queued=[];attributeChanges.clear();textChanges.clear();
    if(changes.some(change=>change.type==='childList'))structureDirty=true;
    const boxes=measure(); // Read all source boxes before writing any visual fragment.
    for(const change of changes) for(let i=0;i<slices.length;i++) {
      const copy=copies.get(change.target)?.[i];if(!copy)continue;
      if(change.type==='attributes') {
        const name=change.attributeName!;const value=(change.target as Element).getAttribute(name);
        if(name==='style'&&change.target===source)continue;
        value===null?(copy as Element).removeAttribute(name):(copy as Element).setAttribute(name,value);
      } else if(change.type==='characterData')copy.textContent=change.target.textContent;
      else {
        for(const removed of Array.from(change.removedNodes)){const old=copies.get(removed)?.[i];if(old?.parentNode===copy)copy.removeChild(old);}
        for(const added of Array.from(change.addedNodes)) {
          let node=copies.get(added)?.[i];if(!node){node=added.cloneNode(true);bind(added,node,i);}
          const next=change.nextSibling?copies.get(change.nextSibling)?.[i]:undefined;
          copy.insertBefore(node,next?.parentNode===copy?next:null);
        }
      }
    }
    cull(boxes);
    if(changes.length)animations.refresh();
  }
  function schedule() { if(!frame&&!disposed&&visible)frame=requestAnimationFrame(flush); }
  const observer=new sourceWindow.MutationObserver(changes=>{
    if(needsResync&&resyncIndex===0)return;
    // Hidden screens retain only the latest attribute/text value per source node.
    // A normal camera turn no longer triggers complete DOM clones on return.
    for(const change of changes) {
      if(change.type==='attributes') {
        let row=attributeChanges.get(change.target);if(!row){row=new Map();attributeChanges.set(change.target,row);}
        row.set(change.attributeName!,change);
      } else if(change.type==='characterData')textChanges.set(change.target,change);
      else queued.push(change);
    }
    if(!visible&&queued.length+attributeChanges.size+textChanges.size>1000) {
      needsResync=true;queued=[];attributeChanges.clear();textChanges.clear();
    }
    schedule();
  });
  observer.observe(source,{subtree:true,attributes:true,characterData:true,childList:true});
  function mirrorStates() {
    if(!visible||disposed)return;
    let changed=false;
    for(const state of ['hover','focus','focus-visible','focus-within','active']) {
      const next=new Set(source!.querySelectorAll(`:${state}`)),old=previousStates.get(state)||new Set<Element>();
      for(const element of new Set([...old,...next]))if(old.has(element)!==next.has(element)){
        changed=true;
        // Incremental builds may not yet have a copy in every strip.
        for(const copy of copies.get(element)||[])if(copy)(copy as Element).toggleAttribute(`data-tv-${state}`,next.has(element));
      }
      previousStates.set(state,next);
    }
    if(changed)animations.refresh();
  }
  function formState(event:Event) {
    const target=event.target as HTMLInputElement; if(!target||!source!.contains(target))return;
    for(const copy of copies.get(target)||[]) {
      if(!copy)continue;
      const field=copy as HTMLInputElement;if('value'in target)field.value=target.value;if('checked'in target)field.checked=target.checked;
      (copy as HTMLElement).scrollTop=target.scrollTop;(copy as HTMLElement).scrollLeft=target.scrollLeft;
    }
    mirrorStates();
  }
  for(const name of ['pointerover','pointerout','pointerdown','pointerup','focusin','focusout'])sourceDocument.addEventListener(name,mirrorStates,true);
  for(const name of ['input','change','scroll'])sourceDocument.addEventListener(name,formState,true);
  function resync() {
    if(disposed)return;
    if(resyncIndex===0){built=false;structureDirty=true;queued=[];attributeChanges.clear();textChanges.clear();}
    const end=Math.min(slices.length,resyncIndex+2);
    for(;resyncIndex<end;resyncIndex++) {
      const slice=slices[resyncIndex],root=source!.cloneNode(true) as HTMLElement;bind(source!,root,resyncIndex);rootStyle(root,slice.left);
      root.inert=true;root.setAttribute('aria-hidden','true');slice.root.replaceWith(root);slice.root=root;slice.transform='';
    }
    if(resyncIndex<slices.length){buildTimer=setTimeout(resync,0);return;}
    buildTimer=undefined;resyncIndex=0;built=true;cull(measure());needsResync=false;animations.refresh();schedule();
    for(let i=0;i<slices.length;i++)if(patches[i])applyPatch(slices[i],patches[i]);
  }
  return {
    ready,
    update(next:StudioSurfacePatch[]) {
      patches=next;
      if(!slices.length&&buildTimer===undefined)build();
      for(let i=0;i<slices.length;i++)if(patches[i])applyPatch(slices[i],patches[i]);
    },
    setVisible(next:boolean) {
      if(visible===next)return;visible=next;view.style.visibility=next?'visible':'hidden';animations.setVisible(next);
      if(next&&needsResync&&buildTimer===undefined)resync();
      for(let i=0;i<slices.length;i++)if(patches[i])applyPatch(slices[i],patches[i]);
      if(next)schedule();
    },
    dispose() {
      if(disposed)return;disposed=true;resolveReady();observer.disconnect();animations.dispose();cancelAnimationFrame(frame);clearTimeout(buildTimer);
      for(const name of ['pointerover','pointerout','pointerdown','pointerup','focusin','focusout'])sourceDocument.removeEventListener(name,mirrorStates,true);
      for(const name of ['input','change','scroll'])sourceDocument.removeEventListener(name,formState,true);
      queued=[];attributeChanges.clear();textChanges.clear();candidates=[];slices.length=0;previousStates.clear();view.remove();fonts.remove();
    },
  };
}
