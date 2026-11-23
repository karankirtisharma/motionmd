'use strict';

// Interface sounds: short recordings in assets/sound/, played through Web Audio so a press is heard the
// moment it happens. Uncompressed WAV on purpose: MP3 and AAC pad the start of a file, which delays a click.
// tickSound() in templates.js keeps its synthesized tick as the fallback when a file or audio is unavailable.
const CabinetSound = (() => {
  // Relative loudness inside the family, set from the measured loudness of each file so they sit level with
  // one another: the tap is heard most often and is the quietest, the camera shutter is bright and held back,
  // the air pass stays under everything. The Control Center volume scales all of them together.
  const level = {tick:.4, press:.8, select:.72, switch:.68, shutter:.5, save:.6, whoosh:.39};
  const buffers = {};
  let ctx;

  // Fetch and decode ahead of the first press. An offline context can decode before any user gesture;
  // the live context is only created inside play(), which always runs from one.
  async function load() {
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Offline) return;
    const decoder = new Offline(1, 1, 44100);
    await Promise.all(Object.keys(level).map(async name => {
      try {
        const response = await fetch('assets/sound/'+name+'.wav');
        if (response.ok) buffers[name] = await decoder.decodeAudioData(await response.arrayBuffer());
      } catch {}
    }));
  }

  function play(name, volume) {
    const buffer = buffers[name] || buffers.tick;
    if (!buffer) return false;
    try {
      ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      const source = ctx.createBufferSource(), gain = ctx.createGain();
      source.buffer = buffer;
      gain.gain.value = volume * (level[name] ?? .5);
      source.connect(gain).connect(ctx.destination);
      source.start();
      return true;
    } catch {
      return false;
    }
  }

  if (document.readyState === 'complete') load(); else addEventListener('load', load, {once:true});
  return {play};
})();
