/** The presentation TV shows the Projection Cabinet's TV edition, a static app
 * copied byte-for-byte to /projection-cabinet/tv/. It is composed for one
 * 1728x608 display; the TV face measures ~2.87:1, so the document keeps its
 * native size and the screen projection maps it corner to corner (<1% stretch,
 * no letterbox). The expanded view opens the responsive edition. `?tv=studio` keeps the previous React Studio for rollback. */
export const tvShowsStudio = () => typeof location !== 'undefined' && new URLSearchParams(location.search).get('tv') === 'studio';

export type ScreenSource = {
  width: number; height: number; title: string; loading: string;
  url: (attempt: number) => string;
  /** Full-window page for the expanded view, opened at the TV's current route. */
  expandedUrl?: (hash: string) => string;
  /** Called on every frame load; the document is same-origin. */
  onLoad: (frame: HTMLIFrameElement) => void;
};

// Runs inside the cabinet document, so its messages come from the frame itself
// and the lounge speaks the same md-studio protocol as with the React Studio.
// Suspend sleeps GSAP's ticker and detaches the WebGL stage's frame callback;
// resume restores both. Escape on the cabinet's home page (where the cabinet
// itself has nowhere to go back to) returns to the room.
const BRIDGE = `(function () {
  if (window.mdLoungeBridge) return;
  window.mdLoungeBridge = true;
  var origin = location.origin, root = document.documentElement, suspended = false, ready = false;
  var style = document.createElement('style');
  style.textContent = ':root[data-md-host-paused] *, :root[data-md-host-paused] *::before, :root[data-md-host-paused] *::after { animation-play-state: paused !important; }';
  document.head.appendChild(style);
  function send(type) { parent.postMessage({ type: type }, origin); }
  function suspend(on) {
    if (on === suspended) return;
    suspended = on;
    root.toggleAttribute('data-md-host-paused', on);
    var g = window.gsap, stage = window.FX && window.FX.stage;
    if (!g) return;
    if (on) { if (stage) g.ticker.remove(stage.tick); g.ticker.sleep(); }
    else { g.ticker.wake(); if (stage) { g.ticker.add(stage.tick); stage.wake(300); } }
  }
  addEventListener('message', function (e) {
    if (e.origin !== origin || e.source !== parent || !e.data) return;
    if (e.data.type === 'md-studio:suspend') suspend(true);
    else if (e.data.type === 'md-studio:resume') suspend(false);
    else if (e.data.type === 'md-studio:request-exit') send('md-studio:exit');
  });
  addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var zoom = document.getElementById('zoom');
    if ((location.hash.slice(1) || 'ui/home') === 'ui/home' && !(zoom && zoom.open)) send('md-studio:exit');
  }, true);
  // Ready once the motion layer has taken the first page (fx-boot removed) and
  // its pictures have decoded, capped so a slow picture cannot stall the TV.
  function check() {
    if (ready || root.classList.contains('fx-boot') || !document.querySelector('#app .ui')) return;
    ready = true;
    observer.disconnect();
    var decoded = Promise.all([document.fonts.ready].concat(Array.prototype.map.call(document.images, function (image) { return image.decode().catch(function () {}); })));
    Promise.race([decoded, new Promise(function (resolve) { setTimeout(resolve, 3000); })]).then(function () {
      requestAnimationFrame(function () { requestAnimationFrame(function () { send('md-studio:ready'); }); });
    });
  }
  var observer = new MutationObserver(check);
  observer.observe(root, { attributes: true, attributeFilter: ['class'] });
  observer.observe(document.getElementById('app'), { childList: true });
  check();
})();`;

export const projectionCabinetSource: ScreenSource = {
  width: 1728, height: 608,
  title: 'motiongraphics.agency Projection Cabinet',
  loading: 'Opening the cabinet...',
  url: attempt => `/projection-cabinet/tv/index.html?attempt=${attempt}`,
  // The TV edition only letterboxes in a browser window; the expanded view uses the
  // responsive edition, which fills any window (16:9 included).
  expandedUrl: hash => '/projection-cabinet/web/index.html' + hash,
  onLoad(frame) {
    const doc = frame.contentDocument;
    if (!doc?.head || doc.querySelector('script[data-md-lounge-bridge]')) return;
    const script = doc.createElement('script');
    script.dataset.mdLoungeBridge = '';
    script.textContent = BRIDGE;
    doc.head.append(script);
  },
};
