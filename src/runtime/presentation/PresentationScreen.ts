import * as THREE from 'three';

type Page = 'home' | 'work' | 'services' | 'studio' | 'partners' | 'project';
type Region = { x: number; y: number; w: number; h: number; action: string };
export type ScreenContent = {
  title: string; subtitle?: string; image?: HTMLImageElement;
  video?: HTMLVideoElement; buttons?: { label: string; action: string }[];
};
type Options = {
  scene: THREE.Object3D; camera: THREE.Camera; canvas: HTMLCanvasElement;
  objectName: string; onAction?: (action: string) => void;
};

/** The texture is drawn on the source curved LED mesh; screen hits use its UV map. */
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
  let page: Page = 'home';
  let active = false;
  let activated = false;
  let hovered = '';
  let customContent: ScreenContent | undefined;
  let lastVideoTime = -1;
  let regions: Region[] = [];
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const gold = '#efcf9c', white = '#f5f3ed', muted = '#b7b7b1';

  function text(value: string, x: number, y: number, size: number, color = white, weight = 400) {
    ctx!.font = `${weight} ${size}px Arial, sans-serif`; ctx!.fillStyle = color;
    ctx!.textAlign = 'left'; ctx!.fillText(value, x, y);
  }
  function roundRect(x: number, y: number, w: number, h: number, radius = 22) {
    ctx!.beginPath(); ctx!.roundRect(x, y, w, h, radius);
  }
  function button(label: string, x: number, y: number, w: number, action: string, filled = false) {
    const hover = hovered === action;
    roundRect(x, y, w, 74);
    ctx!.fillStyle = filled ? gold : hover ? '#493b2b' : '#101213'; ctx!.fill();
    ctx!.strokeStyle = hover || filled ? '#ffdfa9' : '#8a7860'; ctx!.lineWidth = 1.6; ctx!.stroke();
    text(label, x + 26, y + 47, 28, filled ? '#161412' : white, filled ? 500 : 400);
    regions.push({ x, y, w, h: 74, action });
  }
  function backdrop() {
    const gradient = ctx!.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#080b0c'); gradient.addColorStop(0.55, '#121719'); gradient.addColorStop(1, '#050505');
    ctx!.fillStyle = gradient; ctx!.fillRect(0, 0, width, height);
    ctx!.save();
    const glow = ctx!.createRadialGradient(2010, 215, 10, 1950, 330, 800);
    glow.addColorStop(0, '#7c604433'); glow.addColorStop(0.5, '#4c352122'); glow.addColorStop(1, '#080b0c00');
    ctx!.fillStyle = glow; ctx!.fillRect(350, 0, 2050, 800);
    for (let i = 0; i < 22; i++) {
      ctx!.beginPath(); ctx!.moveTo(1560 + i * 5, -100);
      ctx!.bezierCurveTo(1990 - i * 13, 160, 1650 + i * 9, 370, 2440, 730 + i * 5);
      ctx!.strokeStyle = `rgba(232,189,129,${0.02 + i * 0.003})`;
      ctx!.lineWidth = 3 + i * 1.3; ctx!.stroke();
    }
    ctx!.restore();
  }
  function chrome() {
    text('md.', 64, 100, 64, white, 600); text('motiondesign.ad', 208, 94, 27, muted);
    const tabs: [Page, string][] = [['home', 'Home'], ['work', 'Work'], ['services', 'Services'], ['studio', 'Studio'], ['partners', 'Partners']];
    tabs.forEach(([id, label], i) => {
      const y = 218 + i * 83, chosen = page === id;
      if (chosen || hovered === id) {
        roundRect(46, y - 41, 280, 68, 23); ctx!.fillStyle = chosen ? '#6f563544' : '#ffffff0b'; ctx!.fill();
      }
      text(['⌂', '◇', '✧', '○', '⋈'][i], 73, y + 1, 33, chosen ? gold : muted);
      text(label, 132, y, 28, chosen ? gold : muted, chosen ? 500 : 400);
      regions.push({ x: 46, y: y - 41, w: 280, h: 68, action: id });
    });
    text('A MOTION DESIGN AGENCY', 65, 698, 16, '#8a8d89');
    text('FOR A BRIGHTER TOMORROW', 65, 726, 16, '#8a8d89');
    text(active ? 'Click the display to explore' : 'Take a seat to explore', 1925, 738, 20, muted);
  }
  function draw() {
    regions = []; backdrop(); chrome();
    if (customContent) {
      text(customContent.title, 418, 217, 62); text(customContent.subtitle ?? '', 423, 266, 27, muted);
      const media = customContent.video ?? customContent.image;
      if (media && (!(media instanceof HTMLVideoElement) || media.readyState >= 2)) {
        ctx!.drawImage(media, 430, 302, 1470, 360);
      }
      customContent.buttons?.forEach((item, i) => button(item.label, 430 + i * 335, 690, 310, item.action));
    } else if (page === 'home') {
      text('Ideas', 417, 278, 96); text('deserve to move.', 417, 383, 96);
      text('Design. Stories. Experiences.', 425, 462, 40, gold);
      button('Explore Work  →', 427, 548, 340, 'work');
      button('Discover our Studio', 793, 548, 357, 'studio');
      button('Start a Project  →', 1177, 548, 343, 'project', true);
    } else if (page === 'work') {
      text('Selected Work', 417, 227, 68); text('A glimpse of what’s possible.', 422, 283, 32, muted);
      const cards = [ ['The Horizon Within', 'Brand Film'], ['Fragments of Tomorrow', 'CGI'], ['A More Human Web', 'Interactive'], ['Kinetic Objects', 'Product Film'] ];
      cards.forEach(([title, type], i) => {
        const x = 425 + i * 452;
        roundRect(x, 340, 423, 334); ctx!.fillStyle = i % 2 ? '#18252a' : '#302b22'; ctx!.fill();
        ctx!.strokeStyle = '#75654b'; ctx!.lineWidth = 1; ctx!.stroke();
        text(`0${i + 1}`, x + 25, 395, 23, gold);
        text(title, x + 25, 566, 28); text(type, x + 25, 609, 25, muted);
        text('View project  →', x + 25, 650, 23, gold);
        regions.push({ x, y: 340, w: 423, h: 334, action: `work:${i}` });
      });
    } else if (page === 'services') {
      text('Services', 417, 227, 68); text('Different disciplines. A more meaningful tomorrow.', 422, 283, 32, muted);
      ['Brand & Motion', 'CGI & Product Films', 'Film & Storytelling', 'Interactive & Immersive', 'Creative Direction'].forEach((label, i) => {
        const x = 425 + i * 361; roundRect(x, 348, 338, 310);
        ctx!.fillStyle = i % 2 ? '#142127' : '#27231d'; ctx!.fill(); ctx!.strokeStyle = '#716147'; ctx!.stroke();
        text(`0${i + 1}`, x + 24, 403, 25, gold);
        const split = label.split(' & '); text(split[0], x + 24, 545, 28);
        if (split[1]) text(`& ${split[1]}`, x + 24, 586, 28);
        text('Learn more  →', x + 24, 631, 23, gold);
        regions.push({ x, y: 348, w: 338, h: 310, action: `service:${i}` });
      });
    } else if (page === 'project') {
      text('Let’s make', 417, 244, 77); text('something extraordinary.', 417, 335, 77, gold);
      text('Choose a discipline to begin exploring.', 423, 401, 32, muted);
      ['Brand & Motion', 'CGI & Product', 'Film & Storytelling', 'Interactive'].forEach((label, i) => {
        button(label, 426 + i * 448, 505, 422, `project:${i}`);
      });
      text('Project enquiries will be connected when contact details are provided.', 428, 650, 24, muted);
    } else {
      text(page === 'studio' ? 'A space for extraordinary ideas.' : 'Better, together.', 417, 254, 65);
      text(page === 'studio' ? 'Design. Stories. Experiences.' : 'Creating meaningful experiences through collaboration.', 425, 337, 34, gold);
      text('Explore the architectural lounge and discover our work.', 425, 403, 28, muted);
      button('Explore our Work  →', 427, 522, 383, 'work');
      button('Start a Project  →', 840, 522, 360, 'project', true);
    }
    texture.needsUpdate = true;
  }
  function activate(action: string) {
    if (['home', 'work', 'services', 'studio', 'partners', 'project'].includes(action)) {
      page = action as Page; customContent = undefined;
    } else if (action.startsWith('work:')) {
      const titles = ['The Horizon Within', 'Fragments of Tomorrow', 'A More Human Web', 'Kinetic Objects'];
      customContent = { title: titles[Number(action.split(':')[1])] ?? 'Selected Work', subtitle: 'Project presentation — content can be connected here.', buttons: [{ label: '← All work', action: 'work' }] };
    } else if (action.startsWith('service:') || action.startsWith('project:')) {
      page = 'project'; customContent = undefined;
    }
    options.onAction?.(action); draw();
  }
  function hit(event: PointerEvent) {
    const rect = options.canvas.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, options.camera);
    const intersection = raycaster.intersectObjects(meshes, false)[0];
    if (!intersection?.uv) return undefined;
    // glTF material texture coordinates are top-left, and CanvasTexture.flipY=false preserves them.
    const x = intersection.uv.x * width, y = intersection.uv.y * height;
    return regions.find((region) => x >= region.x && x <= region.x + region.w && y >= region.y && y <= region.y + region.h);
  }
  function onMove(event: PointerEvent) {
    if (!active) return;
    const next = hit(event)?.action ?? '';
    if (next !== hovered) { hovered = next; options.canvas.style.cursor = next ? 'pointer' : 'default'; draw(); }
  }
  function onClick(event: PointerEvent) {
    if (!active || event.button !== 0) return;
    const region = hit(event); if (region) activate(region.action);
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
      hovered = ''; options.canvas.style.cursor = 'default'; draw();
    },
    setContent(content?: ScreenContent) { customContent = content; draw(); },
    setAction: activate,
    update() {
      if (customContent?.video && !customContent.video.paused && customContent.video.currentTime !== lastVideoTime) {
        lastVideoTime = customContent.video.currentTime; draw();
      }
    },
    getWorldCenter(target = new THREE.Vector3()) {
      if (!meshes.length) return target.set(11.6, 1.95, -9.9);
      return new THREE.Box3().setFromObject(meshes[0]).getCenter(target);
    },
    dispose() {
      options.canvas.removeEventListener('pointermove', onMove); options.canvas.removeEventListener('pointerup', onClick);
      originals.forEach((original, mesh) => { mesh.material = original; });
      texture.dispose(); material.dispose();
    },
  };
}
