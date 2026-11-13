/**
 * Standalone preview: the intro mounted on a simulated host.
 *
 * Nothing here ships to the site. It exists so the interface, the miniature
 * and the scoped host rules can be exercised without the website repository,
 * and it labels itself as simulated wherever it speaks.
 *
 * Scenario: #name in the address (plain hash, works in hosted previews) or
 * ?case=name. Speed: ?speed=4 or the panel. Panel hidden with ?panel=0.
 * For captures and checks: ?hold=<host ms> freezes the simulated host at that
 * point, ?wait=<ms> sets the wait the intro calls long, ?graphics=still
 * forces the static fallback, ?entry=fail|slow and ?retry=slow shape the
 * acknowledgements.
 */
import { COPY } from '../config/copy.mjs';
import { mountLivingMaquette } from '../index.mjs';
import { createSimulatedHost, SCENARIOS } from '../host/simulated-host.mjs';

const query = new URLSearchParams(location.search);
const container = document.getElementById('living-maquette');
const assetBase = container.dataset.assetBase || './assets/';

const SCENARIO_LABELS = {
  site: 'Site replay · 131 s',
  normal: 'Normal · 80 s',
  early: 'Early ready · 4 s',
  returning: 'Already ready',
  slow: 'Slow, still active',
  'unknown-total': 'Unknown download size',
  stall: 'Suspected stall',
  failure: 'Failure, then retry',
};

function readScenario() {
  const fromHash = location.hash.replace(/^#/, '');
  const name = SCENARIOS[fromHash] ? fromHash : query.get('case');
  return SCENARIOS[name] ? name : 'site';
}

let current = null;

/** The bytes of a model published as { "base64": "…" }. */
async function wrappedModel(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Model unavailable (${response.status})`);
  const binary = atob((await response.json()).base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function start(scenario, speed) {
  current?.intro.dispose();
  current?.host.dispose();
  document.querySelector('.lm-arrival')?.remove();
  container.replaceChildren();

  const trace = [];
  const record = (event) => {
    trace.push(event);
    if (trace.length > 400) trace.shift();
    panel?.onTrace(event);
  };
  const host = createSimulatedHost({
    scenario,
    speed,
    failFirstEntry: query.get('entry') === 'fail',
    entryAckMs: query.get('entry') === 'slow' ? 6_000 : 700,
    retryAckMs: query.get('retry') === 'slow' ? 3_600_000 : 400,
    holdAtMs: query.has('hold') ? Number(query.get('hold')) : null,
    // ?route=<ms>: how long each selected room takes once the world is ready.
    routeMs: query.has('route') ? { lounge: Number(query.get('route')), 'motion-floor': Number(query.get('route')) } : null,
    onTrace: (event) => record(event),
  });
  const intro = mountLivingMaquette(container, {
    host,
    assetBase,
    // A hosted preview shows a placeholder where the site shows its name.
    ...(container.dataset.brand ? { brand: container.dataset.brand } : {}),
    // A host that cannot serve .glb files gets the same bytes as base64 in JSON
    // (tools/hosted-preview.mjs writes those files).
    ...(container.dataset.models === 'json' ? {
      sceneAssets: {
        mainModel: [
          Object.assign(() => wrappedModel(`${assetBase}models/Living_Maquette_meshopt.glb.json`), { meshopt: true }),
          () => wrappedModel(`${assetBase}models/Living_Maquette_quantized.glb.json`),
        ],
        workspaceModel: [
          Object.assign(() => wrappedModel(`${assetBase}models/MotionFloor_Furnishings_meshopt.glb.json`), { meshopt: true }),
          () => wrappedModel(`${assetBase}models/MotionFloor_Furnishings_quantized.glb.json`),
        ],
      },
    } : {}),
    // A sped-up simulation shortens the wait it calls long by the same factor.
    // A held one (captures) is not waiting at all.
    expectedWaitMs: query.has('wait') ? Number(query.get('wait')) : query.has('hold') ? 3_600_000 : 80_000 / speed,
    graphics: query.get('graphics') === 'still' ? 'still' : 'auto',
    // ?sticky=1 keeps the short-lived confirmation and hint line up (captures).
    ...(query.get('sticky') === '1' ? { noteMs: 3_600_000, confirmMs: 3_600_000 } : {}),
    // The simulated room confirms the hint for the device in use.
    entryHint: matchMedia('(pointer: coarse)').matches ? 'touch' : 'keyboard',
    onTrace: (event) => record({ source: 'adapter', t: Math.round(performance.now()), ...event }),
    onEvent: (name, detail) => record({ source: 'intro', type: name, ...detail }),
    onEntered: ({ destinationId, preferences }) => showArrival({ destinationId, preferences, lightVersion: false }),
    onLightVersion: ({ preferences }) => {
      showArrival({ destinationId: preferences.destinationId, preferences, lightVersion: true });
      intro.dispose();
    },
  });
  current = { host, intro, scenario, speed, trace };
  window.__lm = current; // for manual inspection and the automated checks
}

function showArrival({ destinationId, preferences, lightVersion }) {
  const arrival = document.createElement('section');
  arrival.className = 'lm-root lm-arrival';
  arrival.setAttribute('aria-labelledby', 'lm-arrival-title');
  const image = destinationId === 'motion-floor' ? 'P04_motion_floor.webp' : 'P06_arrival.webp';
  arrival.innerHTML = `
    <img class="lm-arrival-image" src="${assetBase}images/studies/${image}" alt="">
    <div class="lm-arrival-card lm-glass">
      <h2 id="lm-arrival-title" tabindex="-1">${lightVersion ? COPY.state.light_version_landing.status : COPY.welcomeHeading(destinationId)}</h2>
      <p>${lightVersion ? COPY.state.light_version_landing.supporting : COPY.arrivalSupporting(preferences.lightMode)}</p>
      <button class="lm-button lm-button--primary" type="button">Replay the intro</button>
      <p class="lm-arrival-foot">Simulated ${lightVersion ? 'Lite Version' : 'arrival'}: the still stands in for the site's own ${lightVersion ? 'studio page' : 'room'}. Handed over: ${destinationId}, ${preferences.lightMode} light, sound ${preferences.soundEnabled ? 'on' : 'off'}, ${preferences.reducedMotion ? 'reduced' : 'full'} motion.</p>
    </div>`;
  document.body.append(arrival);
  arrival.querySelector('button').addEventListener('click', () => start(current.scenario, current.speed));
  requestAnimationFrame(() => {
    arrival.dataset.visible = 'true';
    arrival.querySelector('h2').focus({ preventScroll: true });
  });
}

// ------------------------------------------------------------------ panel
function createPanel() {
  if (query.get('panel') === '0') return null;
  const element = document.createElement('aside');
  element.className = 'lm-demo';
  element.setAttribute('aria-label', 'Simulated host controls');
  element.innerHTML = `
    <details>
      <summary><span class="lm-demo-dot" aria-hidden="true"></span>Simulated host<span class="lm-demo-current"></span></summary>
      <div class="lm-demo-body">
        <label>Scenario
          <select data-demo="scenario">${Object.keys(SCENARIOS).map((name) => `<option value="${name}">${SCENARIO_LABELS[name] ?? name}</option>`).join('')}</select>
        </label>
        <label>Speed
          <select data-demo="speed"><option value="1">1×</option><option value="4">4×</option><option value="10">10×</option></select>
        </label>
        <button type="button" data-demo="restart">Restart</button>
        <p class="lm-demo-note">Loading, readiness and entry on this page come from a simulated host. The site's own loader replaces it in production.</p>
        <ol class="lm-demo-trace" data-demo="trace" aria-label="Recent host events"></ol>
        <p class="lm-demo-stats" data-demo="stats" aria-live="off"></p>
        <button type="button" data-demo="measure">Measure frame cost on this device</button>
      </div>
    </details>`;
  // First in the page: on a narrow screen it is a strip above the intro.
  document.body.prepend(element);
  const scenarioSelect = element.querySelector('[data-demo="scenario"]');
  const speedSelect = element.querySelector('[data-demo="speed"]');
  const traceList = element.querySelector('[data-demo="trace"]');
  const currentLabel = element.querySelector('.lm-demo-current');
  const restart = () => {
    // The address follows the scenario where the page is allowed to set it.
    try { history.replaceState(null, '', `#${scenarioSelect.value}`); } catch { /* a hosted frame may refuse */ }
    start(scenarioSelect.value, Number(speedSelect.value));
    sync();
  };
  scenarioSelect.addEventListener('change', restart);
  speedSelect.addEventListener('change', restart);
  element.querySelector('[data-demo="restart"]').addEventListener('click', restart);
  // Renderer observations for this device (preview only).
  const statsLine = element.querySelector('[data-demo="stats"]');
  const measureButton = element.querySelector('[data-demo="measure"]');
  let framesSeen = 0;
  let measured = '';
  let sceneReady = null; // kept here: the trace is a rolling window
  const describe = () => {
    const { intro, trace } = current;
    const stage = intro.stage;
    if (!stage) {
      statsLine.textContent = intro.graphics === 'still' ? 'Renderer: static still (no WebGL scene).' : 'Renderer: starting.';
      measureButton.hidden = true;
      return;
    }
    measureButton.hidden = false;
    const canvas = stage.renderer.domElement;
    const info = stage.renderer.info.render;
    const gl = stage.renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'WebGL2';
    const ready = sceneReady ?? (sceneReady = trace.find((event) => event.type === 'intro_scene_ready') ?? null);
    const frames = stage.stats.frames - framesSeen;
    framesSeen = stage.stats.frames;
    statsLine.textContent = `Renderer: ${canvas.width} x ${canvas.height} px buffer, ${info.calls} draw calls, ${Math.round(info.triangles / 1000)}k triangles, `
      + `${frames} frame${frames === 1 ? '' : 's'} in the last second (drawn only while something moves, 30 a second at most). `
      + `${ready ? `Scene ready ${ready.sinceMountMs} ms after mount. ` : ''}${measured}${gpu}.`;
  };
  setInterval(describe, 1000);
  let measuring = false;
  measureButton.addEventListener('click', () => {
    const stage = current.intro.stage;
    if (!stage || measuring) return;
    // One full frame per animation frame, shadow pass included, each timed
    // until the GPU has finished it (reading a pixel back waits for that).
    measuring = true;
    measureButton.disabled = true;
    const gl = stage.renderer.getContext();
    const pixel = new Uint8Array(4);
    const startYaw = stage.yaw;
    const times = [];
    const began = performance.now();
    const finish = () => {
      if (current.intro.stage === stage) stage.setYaw(startYaw);
      times.sort((a, b) => a - b);
      measured = times.length
        ? `Measured ${times[Math.floor(times.length / 2)].toFixed(1)} ms a frame with shadows (median of ${times.length}, slowest ${times[times.length - 1].toFixed(1)} ms). `
        : '';
      measuring = false;
      measureButton.disabled = false;
      describe();
    };
    const step = () => {
      if (current.intro.stage !== stage) { finish(); return; } // restarted meanwhile
      const before = performance.now();
      stage.setYaw(startYaw + Math.sin((times.length + 1) * 0.2) * 0.2);
      stage.renderOnce();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      times.push(performance.now() - before);
      if (times.length < 60 && performance.now() - began < 2500) requestAnimationFrame(step);
      else finish();
    };
    requestAnimationFrame(step);
  });
  function sync() {
    scenarioSelect.value = current.scenario;
    speedSelect.value = String(current.speed);
    currentLabel.textContent = ` · ${SCENARIO_LABELS[current.scenario] ?? current.scenario}${current.speed !== 1 ? ` · ${current.speed}×` : ''}`;
    traceList.replaceChildren();
    sceneReady = null;
    measured = '';
  }
  return {
    sync,
    onTrace(event) {
      // Show what matters for scope: host patches with the controller's verdict, and actions.
      if (event.source !== 'adapter') return;
      const scope = event.scope ? `a${event.scope.attemptId ?? '·'}${event.scope.destinationId ? ` ${event.scope.destinationId}#${event.scope.destinationRequestId}` : ''}` : '';
      const verdict = event.accepted === undefined ? '' : event.accepted ? 'accepted' : `rejected (${event.reason ?? 'stale'})`;
      const text = [event.direction === 'to-host' ? '→' : '←', event.type, event.phase ?? '', event.readyForEntry ? 'ready' : '', scope, verdict].filter(Boolean).join(' ');
      // Progress ticks repeat: count them on one line instead of filling the list.
      const latest = traceList.firstElementChild;
      if (latest && latest.dataset.text === text) {
        latest.dataset.count = String(Number(latest.dataset.count) + 1);
        latest.textContent = `${text}  ×${latest.dataset.count}`;
        return;
      }
      const item = document.createElement('li');
      item.dataset.verdict = event.accepted === false ? 'rejected' : 'ok';
      item.dataset.text = text;
      item.dataset.count = '1';
      item.textContent = text;
      traceList.prepend(item);
      while (traceList.children.length > 40) traceList.lastChild.remove();
    },
  };
}

const speed = Math.max(0.25, Number(query.get('speed')) || 1);
let panel = null;
start(readScenario(), speed);
panel = createPanel();
panel?.sync();
window.addEventListener('hashchange', () => {
  const name = location.hash.replace(/^#/, '');
  if (SCENARIOS[name] && name !== current.scenario) { start(name, current.speed); panel?.sync(); }
});
