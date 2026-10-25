// Interface sounds, synthesized with Web Audio (original — no sampled console sounds).
// Browsers start audio only after the first key press or click; sounds before that are skipped.

(function () {
  let ctx = null, master = null, enabled = true, gestured = false;
  try { enabled = localStorage.getItem('md-os:sound') !== 'off'; } catch (e) {}

  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    // gentle low-pass + short room so every sound shares one soft space
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9000;
    const verb = ctx.createConvolver(); verb.buffer = room(0.9);
    const wet = ctx.createGain(); wet.gain.value = 0.18;
    master.connect(lp); lp.connect(ctx.destination);
    lp.connect(verb); verb.connect(wet); wet.connect(ctx.destination);
  }

  function room(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  // One enveloped oscillator
  function tone(freq, { type = 'sine', at = 0, attack = 0.004, decay = 0.12, gain = 0.2, glide = 0 } = {}) {
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(freq * glide, t + attack + decay);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + attack + decay + 0.05);
  }

  // Filtered noise sweep (air / whoosh)
  function air({ at = 0, dur = 0.22, from = 800, to = 3200, gain = 0.08 } = {}) {
    const t = ctx.currentTime + at;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(from, t); bp.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.05);
  }

  let lastMove = 0;
  const sounds = {
    // soft glassy tick; pitch nudges with direction
    move(dir) {
      const now = performance.now();
      const quiet = now - lastMove < 70; lastMove = now;
      const f = { left: 1760, right: 1975, up: 2093, down: 1661 }[dir] || 1865;
      tone(f, { decay: 0.05, gain: quiet ? 0.05 : 0.09 });
      tone(f * 2, { decay: 0.03, gain: quiet ? 0.015 : 0.03 });
    },
    // tab/category change: a slightly rounder tick
    tab() { tone(1318, { decay: 0.08, gain: 0.09 }); tone(2637, { at: 0.01, decay: 0.05, gain: 0.03 }); },
    // confirm: two-note rising chime
    select() {
      tone(1318.5, { decay: 0.22, gain: 0.12 });
      tone(1975.5, { at: 0.055, decay: 0.32, gain: 0.1 });
      tone(3951, { at: 0.055, decay: 0.12, gain: 0.02, type: 'triangle' });
    },
    // back: short falling blip
    back() { tone(1174.7, { decay: 0.12, gain: 0.1, glide: 0.75 }); },
    // sheet / menu opening
    open() { air({ dur: 0.24, from: 600, to: 4200, gain: 0.05 }); tone(987.8, { at: 0.04, decay: 0.2, gain: 0.06 }); },
    close() { air({ dur: 0.2, from: 3600, to: 700, gain: 0.045 }); },
    // nothing further in that direction
    edge() { tone(220, { type: 'triangle', decay: 0.06, gain: 0.07 }); },
    // start-up: warm swell, rising rush of air, soft sub hit and a chime as Home lands
    fly() {
      [261.6, 392, 523.3, 659.3].forEach((f, i) => tone(f, { at: i * 0.05, attack: 0.18, decay: 1.4, gain: 0.045 }));
      air({ at: 0.05, dur: 1.0, from: 220, to: 7000, gain: 0.07 });
      tone(110, { at: 0.95, attack: 0.01, decay: 0.7, gain: 0.16, glide: 0.5 });
      air({ at: 0.95, dur: 0.5, from: 5000, to: 400, gain: 0.04 });
      tone(1975.5, { at: 1.0, attack: 0.01, decay: 0.9, gain: 0.05 });
      tone(2637, { at: 1.06, attack: 0.01, decay: 0.7, gain: 0.03 });
    },
  };

  window.MD_SOUND = {
    play(name, arg) {
      if (!enabled || !gestured) return; // nothing before the first key press or click
      unlock();
      if (!ctx) return;
      const run = () => sounds[name] && sounds[name](arg);
      if (ctx.state === 'running') run(); else ctx.resume().then(run);
    },
    // call from a user gesture: browsers only allow audio after one
    wake() { gestured = true; unlock(); },
    get enabled() { return enabled; },
    set enabled(v) { enabled = v; try { localStorage.setItem('md-os:sound', v ? 'on' : 'off'); } catch (e) {} },
  };
})();
