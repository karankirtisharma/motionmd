import * as THREE from 'three';

/** The project the Screen OS has in focus, as it reports it over postMessage. */
export type ScreenFocus = { id: string; title: string; niche?: string; poster?: string };
export type ScreenRect = { left: number; top: number; width: number; height: number };
type Options = {
  scene: THREE.Object3D; camera: THREE.Camera; canvas: HTMLCanvasElement;
  objectName: string; onOpen?: () => void;
};

/*
 * The source curved LED mesh shows a still of the Screen OS (public/screen-os): the
 * project it last had in focus, in the OS's own type and palette. The live OS is HTML;
 * clicking the screen asks the page to open it over the scene (see ScreenOS.tsx).
 */
export function createPresentationScreen(options: Options) {
  const width = 2400, height = 800;
  const surface = document.createElement('canvas');
  surface.width = width; surface.height = height;
  const ctx = surface.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('The display canvas could not be initialized.');
  const texture = new THREE.CanvasTexture(surface);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.anisotropy = 8;
  const material = new THREE.MeshStandardMaterial({
    color: 0x242424, map: texture, emissive: 0xffffff,
    emissiveMap: texture, emissiveIntensity: 0.8, roughness: 0.3, metalness: 0,
  });
  const meshes: THREE.Mesh[] = [];
  const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const targetName = normalize(options.objectName);
  options.scene.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;
    const mesh = object as THREE.Mesh;
    const sourceName = String(mesh.userData.sourceName ?? mesh.userData.source_name ?? mesh.name);
    if (normalize(sourceName) === targetName || normalize(mesh.name).includes('curvedledpixelsurface')) {
      meshes.push(mesh); originals.set(mesh, mesh.material);
    }
  });
  let active = false;
  let activated = false;
  let hovered = false;
  let focus: ScreenFocus | undefined;
  let poster: HTMLImageElement | undefined;
  const raycaster = new THREE.Raycaster();
  let worldCenter: THREE.Vector3 | undefined;
  const pointer = new THREE.Vector2();
  // Screen OS tokens (public/screen-os/styles.css).
  const ink = '#070504', ivory = '#fff4e2', ivory60 = 'rgba(255,244,226,.6)', champagne = '#e8c890', gold = '#ffd382';
  const face = (name: string, fallback: string) => {
    const family = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return family ? `${family}, ${fallback}` : fallback;
  };
  const serif = face('--font-screen-serif', 'Georgia, serif');
  const sans = face('--font-screen-sans', 'Arial, sans-serif');
  const mono = face('--font-screen-mono', 'Consolas, monospace');
  let fontsRequested = false;

  function text(value: string, x: number, y: number, font: string, color: string, spacing = 0, align: CanvasTextAlign = 'left') {
    ctx!.font = font; ctx!.fillStyle = color; ctx!.textAlign = align;
    ctx!.letterSpacing = `${spacing}px`; ctx!.fillText(value, x, y); ctx!.letterSpacing = '0px';
  }
  function mark(x: number, y: number, size: number, align: CanvasTextAlign = 'left') {
    ctx!.font = `400 ${size}px ${serif}`;
    const md = ctx!.measureText('md').width, dot = ctx!.measureText('.').width;
    const start = align === 'center' ? x - (md + dot) / 2 : x;
    text('md', start, y, ctx!.font, ivory); text('.', start + md, y, ctx!.font, gold);
  }
  function pill() {
    const label = active ? 'Click the screen to open' : 'Take a seat to explore';
    ctx!.font = `500 26px ${sans}`;
    // Top centre: the seated view frames the middle of the curve (its far ends fall outside)
    // and the visitor's head covers the lower middle in the third-person view.
    const w = ctx!.measureText(label).width + 104, h = 68, x = (width - w) / 2, y = 84;
    ctx!.beginPath(); ctx!.roundRect(x, y, w, h, h / 2);
    ctx!.fillStyle = hovered ? 'rgba(255,211,130,.16)' : 'rgba(255,244,226,.07)'; ctx!.fill();
    ctx!.strokeStyle = hovered ? gold : 'rgba(255,244,226,.22)'; ctx!.lineWidth = 2; ctx!.stroke();
    ctx!.beginPath(); ctx!.arc(x + 40, y + h / 2, 6, 0, Math.PI * 2); ctx!.fillStyle = active ? gold : ivory60; ctx!.fill();
    text(label, x + 66, y + h / 2 + 9, ctx!.font, hovered ? ivory : 'rgba(255,244,226,.86)');
  }
  function draw() {
    ctx!.fillStyle = ink; ctx!.fillRect(0, 0, width, height);
    if (focus && poster?.complete && poster.naturalWidth) {
      // Full-bleed poster (cover), shaded like the OS backdrop so the type stays legible.
      const scale = Math.max(width / poster.naturalWidth, height / poster.naturalHeight);
      const w = poster.naturalWidth * scale, h = poster.naturalHeight * scale;
      ctx!.drawImage(poster, (width - w) / 2, (height - h) / 2, w, h);
      const side = ctx!.createLinearGradient(0, 0, width, 0);
      side.addColorStop(0, 'rgba(7,5,4,.92)'); side.addColorStop(0.45, 'rgba(7,5,4,.55)'); side.addColorStop(1, 'rgba(7,5,4,.12)');
      ctx!.fillStyle = side; ctx!.fillRect(0, 0, width, height);
      const floor = ctx!.createLinearGradient(0, height * 0.45, 0, height);
      floor.addColorStop(0, 'rgba(7,5,4,0)'); floor.addColorStop(1, 'rgba(7,5,4,.7)');
      ctx!.fillStyle = floor; ctx!.fillRect(0, 0, width, height);
      mark(96, 132, 76);
      text('motiondesign.ad', 236, 124, `400 26px ${sans}`, ivory60);
      if (focus.niche) text(focus.niche.toUpperCase(), 96, 560, `500 24px ${mono}`, champagne, 4.8);
      ctx!.font = `500 104px ${sans}`;
      const size = Math.min(104, Math.floor(104 * 820 / Math.max(1, ctx!.measureText(focus.title).width))); // clear of the pill
      text(focus.title, 92, 668, `500 ${size}px ${sans}`, ivory, -2);
    } else {
      const glow = ctx!.createRadialGradient(width / 2, height * 0.45, 20, width / 2, height * 0.45, 900);
      glow.addColorStop(0, 'rgba(232,166,74,.16)'); glow.addColorStop(1, 'rgba(7,5,4,0)');
      ctx!.fillStyle = glow; ctx!.fillRect(0, 0, width, height);
      mark(width / 2, 420, 240, 'center');
      text('motiondesign.ad', width / 2, 500, `400 30px ${sans}`, ivory60, 1, 'center');
    }
    pill();
    texture.needsUpdate = true;
  }
  function requestFonts() {
    if (fontsRequested || !document.fonts) return;
    fontsRequested = true;
    void Promise.allSettled([`400 76px ${serif}`, `500 26px ${sans}`, `500 24px ${mono}`].map(font => document.fonts.load(font))).then(draw);
  }
  function setFocus(next: ScreenFocus) {
    if (focus?.id === next.id) return;
    focus = next;
    if (!next.poster) { poster = undefined; draw(); return; }
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => { if (poster === image) draw(); };
    image.src = next.poster; poster = image;
    draw();
  }
  function hit(event: PointerEvent) {
    const rect = options.canvas.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, options.camera);
    return raycaster.intersectObjects(meshes, false).length > 0;
  }
  function onMove(event: PointerEvent) {
    if (!active) return;
    const next = hit(event);
    if (next !== hovered) { hovered = next; options.canvas.style.cursor = next ? 'pointer' : 'default'; draw(); }
  }
  function onClick(event: PointerEvent) {
    if (!active || event.button !== 0 || !hit(event)) return;
    options.onOpen?.();
  }
  options.canvas.addEventListener('pointermove', onMove);
  options.canvas.addEventListener('pointerup', onClick);
  draw();
  return {
    meshes, texture,
    setActive(value: boolean) {
      active = value;
      // The authored display stays intact throughout the cinematic showcase.
      if (value && !activated) { meshes.forEach((mesh) => { mesh.material = material; }); activated = true; }
      if (value) requestFonts();
      hovered = false; options.canvas.style.cursor = 'default'; draw();
    },
    setFocus,
    /** The screen's on-page bounds (client px) from the current camera, for the open/close zoom. */
    getScreenRect(): ScreenRect | undefined {
      const position = meshes[0]?.geometry.attributes.position;
      if (!position?.count) return undefined;
      const rect = options.canvas.getBoundingClientRect(), point = new THREE.Vector3();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const mesh of meshes) {
        const vertices = mesh.geometry.attributes.position;
        for (let i = 0; i < vertices.count; i++) {
          point.fromBufferAttribute(vertices, i).applyMatrix4(mesh.matrixWorld).project(options.camera);
          minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x); minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
        }
      }
      const left = rect.left + (minX + 1) / 2 * rect.width, right = rect.left + (maxX + 1) / 2 * rect.width;
      const top = rect.top + (1 - maxY) / 2 * rect.height, bottom = rect.top + (1 - minY) / 2 * rect.height;
      return { left, top, width: right - left, height: bottom - top };
    },
    getWorldCenter(target = new THREE.Vector3()) {
      if (!meshes.length) return target.set(11.6, 1.95, -9.9);
      // The LED surface never moves; measure it once instead of every seated frame.
      worldCenter ??= new THREE.Box3().setFromObject(meshes[0]).getCenter(new THREE.Vector3());
      return target.copy(worldCenter);
    },
    dispose() {
      options.canvas.removeEventListener('pointermove', onMove); options.canvas.removeEventListener('pointerup', onClick);
      originals.forEach((original, mesh) => { mesh.material = original; });
      texture.dispose(); material.dispose();
    },
  };
}
