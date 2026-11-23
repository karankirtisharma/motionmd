'use strict';

// The catalogue controls release eligibility. The gallery always retains the approved visual target.
function approvedSource(film) {
  return film?.releaseState === 'released' && typeof film.mediaUrl === 'string' && film.mediaUrl.trim();
}

function mountFilm(film) {
  const region = app.querySelector('.player');
  if (!region) return;
  const shell = document.createElement('div');
  shell.className = 'native-film';
  const video = document.createElement('video');
  video.controls = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.poster = images[keyFor(film)];
  video.setAttribute('aria-label',film.title);
  for (const entry of film.captionTracks || []) {
    const track = document.createElement('track');
    track.kind = 'captions';
    track.src = entry.src;
    track.srclang = entry.srclang;
    track.label = entry.label;
    track.default = Boolean(entry.default);
    video.append(track);
  }
  const self = 'view/' + film.slug;
  video.addEventListener('loadedmetadata', () => {
    if (suspendedPreview?.id === self && Number.isFinite(video.duration)) {
      video.currentTime = Math.max(0, Math.min(viewTime, video.duration));
    }
  }, {once:true});
  // The fallback is scoped to this title, including films without a production study.
  video.addEventListener('error', () => {
    if (!region.isConnected) return;
    const studyId = 'study/' + film.slug;
    region.innerHTML = '<div class="film-error"><span class="tagline">'+esc(film.title)+'</span><h1>Film preview unavailable.</h1><div class="actions">'+
      (routes[studyId] ? link(studyId,'View case study','act') : link('film/'+film.slug,'Film overview','act'))+
      link('index','Back to films','glassbtn')+'</div></div>';
  }, {once:true});
  const nav = document.createElement('nav');
  nav.className = 'native-nav';
  nav.innerHTML = link('film/'+film.slug,icon('back')+' Film overview','glassbtn')+link('controls','Control Center','glassbtn');
  region.replaceChildren(shell);
  shell.append(video,nav);
  video.src = film.mediaUrl;
}

let sendState = { fingerprint:'', key:'', pending:false, receipt:'' };
function briefPayload() {
  return {
    version: 1,
    format: draft.format,
    industry: draft.industry,
    runtime: draft.runtime,
    timeline: draft.timeline,
    contact:{name:person.name.trim(),email:person.email.trim()},
    note: person.note.trim(),
    films: [...shortlist]
  };
}

function mountSubmission() {
  if (!runtimeConfig.briefEndpoint || proof || exampleSession) return;
  const panel = app.querySelector('.formbody');
  const body = JSON.stringify(briefPayload());
  if (sendState.fingerprint !== body) {
    sendState = {fingerprint:body,key:crypto.randomUUID(),pending:false,receipt:''};
  }
  const request = sendState;
  const button = document.createElement('button');
  const status = document.createElement('p');
  button.className = 'glassbtn';
  button.textContent = 'Send brief to studio';
  status.setAttribute('role','status');
  function display(message) {
    button.disabled = request.pending || Boolean(request.receipt);
    status.textContent = request.receipt ? 'Studio receipt · '+request.receipt : message;
  }
  display(request.pending ? 'Sending…' : '');
  button.addEventListener('click', async () => {
    if (request.pending || request.receipt) return;
    request.pending = true;
    display('Sending…');
    try {
      const response = await fetch(runtimeConfig.briefEndpoint, {
        method:'POST',
        headers:{'Content-Type':'application/json','Idempotency-Key':request.key},
        body,
        signal:AbortSignal.timeout(20000)
      });
      if (!response.ok) throw new Error('Delivery failed');
      const result = await response.json();
      if (result.accepted !== true || typeof result.receipt !== 'string' || !result.receipt.trim()) {
        throw new Error('Missing acknowledgement');
      }
      request.receipt = result.receipt;
    } catch {
      // A delivery can succeed on the server before a response arrives. Retrying reuses the key.
    } finally {
      request.pending = false;
      const message = 'Delivery unconfirmed. Retry or download your brief.';
      display(message);
      if (!panel.isConnected && activeRoute === 'brief/ready' && sendState === request) {
        view(routes[activeRoute]);
      }
    }
  });
  panel.append(button,status);
}
