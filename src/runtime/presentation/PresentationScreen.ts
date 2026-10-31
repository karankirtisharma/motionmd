import * as THREE from 'three';

export type ScreenBounds = { x: number; y: number; width: number; height: number };
type Options = {
  scene: THREE.Object3D; camera: THREE.Camera; canvas: HTMLCanvasElement;
  objectName: string; onOpen?: (bounds: ScreenBounds) => void;
};

/** Only the named presentation TV becomes a studio portal; founder screens stay authored. */
export function createPresentationScreen(options: Options) {
  const width = 2400, height = 800;
  const surface = document.createElement('canvas'); surface.width = width; surface.height = height;
  const ctx = surface.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('The display canvas could not be initialized.');
  const texture = new THREE.CanvasTexture(surface);
  texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = false; texture.anisotropy = 8;
  const material = new THREE.MeshStandardMaterial({ color: 0x242424, map: texture, emissive: 0xffffff,
    emissiveMap: texture, emissiveIntensity: .8, roughness: .3, metalness: 0 });
  const meshes: THREE.Mesh[] = [];
  const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const targetName = normalize(options.objectName);
  options.scene.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const name = String(mesh.userData.sourceName ?? mesh.userData.source_name ?? mesh.name);
    if (normalize(name) === targetName || normalize(mesh.name) === targetName) {
      meshes.push(mesh); originals.set(mesh, mesh.material);
    }
  });
  let active = false, disposed = false;
  let down: { x: number; y: number; id: number } | undefined;
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const poster = new Image();
  function draw() {
    if (disposed) return;
    ctx!.fillStyle = '#292014'; ctx!.fillRect(0, 0, width, height);
    if (poster.complete && poster.naturalWidth) {
      const scale = Math.max(width / poster.naturalWidth, height / poster.naturalHeight);
      ctx!.drawImage(poster, (width-poster.naturalWidth*scale)/2, (height-poster.naturalHeight*scale)/2, poster.naturalWidth*scale, poster.naturalHeight*scale);
    }
    const shade = ctx!.createLinearGradient(0,0,0,height);
    shade.addColorStop(0,'rgba(10,9,7,.08)'); shade.addColorStop(.5,'rgba(10,9,7,.55)'); shade.addColorStop(1,'rgba(10,9,7,.08)');
    ctx!.fillStyle=shade; ctx!.fillRect(0,0,width,height);
    ctx!.textAlign='center'; ctx!.fillStyle='#f6f1e7';ctx!.font='88px Arial, sans-serif';
    ctx!.fillText('motiondesign.ad',width/2,390);
    ctx!.fillStyle='#efcf9c';ctx!.font='38px Arial, sans-serif';
    ctx!.fillText('Click to open',width/2,460);
    texture.needsUpdate=true;
  }
  poster.onload = draw; poster.onerror = draw;
  // This module is created only by the lounge runtime; entry/light routes never load it.
  function hit(event: PointerEvent) {
    const rect=options.canvas.getBoundingClientRect();
    pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    raycaster.setFromCamera(pointer,options.camera);
    return raycaster.intersectObjects(meshes,false).length>0;
  }
  function screenBounds(): ScreenBounds {
    const rect=options.canvas.getBoundingClientRect(),box=new THREE.Box3();
    meshes.forEach(mesh=>box.expandByObject(mesh));
    let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
    for (const x of [box.min.x,box.max.x]) for (const y of [box.min.y,box.max.y]) for (const z of [box.min.z,box.max.z]) {
      const p=new THREE.Vector3(x,y,z).project(options.camera);
      if(p.z < -1 || p.z > 1) continue;
      left=Math.min(left,rect.left+(p.x+1)*rect.width/2);right=Math.max(right,rect.left+(p.x+1)*rect.width/2);
      top=Math.min(top,rect.top+(1-p.y)*rect.height/2);bottom=Math.max(bottom,rect.top+(1-p.y)*rect.height/2);
    }
    if(!Number.isFinite(left))return {x:rect.left+rect.width/2,y:rect.top+rect.height/2,width:1,height:1};
    left=Math.max(rect.left,left);top=Math.max(rect.top,top);right=Math.min(rect.right,right);bottom=Math.min(rect.bottom,bottom);
    return {x:left,y:top,width:Math.max(1,right-left),height:Math.max(1,bottom-top)};
  }
  function open() { if(active&&!disposed)options.onOpen?.(screenBounds()); }
  function onDown(event: PointerEvent) { if(active&&event.button===0)down={x:event.clientX,y:event.clientY,id:event.pointerId}; }
  function onMove(event: PointerEvent) {
    if(down?.id===event.pointerId && Math.hypot(event.clientX-down.x,event.clientY-down.y)>=6)down=undefined;
    if(active)options.canvas.style.cursor=hit(event)?'pointer':'default'; }
  function onUp(event: PointerEvent) {
    const start=down;down=undefined;
    if(active&&event.button===0&&start?.id===event.pointerId&&Math.hypot(event.clientX-start.x,event.clientY-start.y)<6&&hit(event))open();
  }
  const onCancel=()=>{down=undefined;};
  options.canvas.addEventListener('pointercancel',onCancel);
  options.canvas.addEventListener('pointerdown',onDown);
  options.canvas.addEventListener('pointermove',onMove);
  options.canvas.addEventListener('pointerup',onUp);
  meshes.forEach(mesh=>{mesh.material=material});
  poster.src='/studio/media/plate/wall-ledge-marble.jpg';
  draw();
  return {
    meshes,texture,
    setActive(value:boolean) {
      active=value;down=undefined;options.canvas.style.cursor='default';
    },
    setAction(action:string){if(action==='studio'||action==='open')open();},
    update(){ /* A still poster needs no per-frame texture uploads. */ },
    getWorldCenter(target=new THREE.Vector3()) {
      if(!meshes.length)return target.set(11.6,1.95,-9.9);
      return new THREE.Box3().setFromObject(meshes[0]).getCenter(target);
    },
    dispose(){
      disposed=true;poster.onload=null;poster.onerror=null;poster.removeAttribute('src');
      options.canvas.removeEventListener('pointercancel',onCancel);
      options.canvas.removeEventListener('pointerdown',onDown);options.canvas.removeEventListener('pointermove',onMove);options.canvas.removeEventListener('pointerup',onUp);
      originals.forEach((original,mesh)=>{mesh.material=original});texture.dispose();material.dispose();
    },
  };
}
