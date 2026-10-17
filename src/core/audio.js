// Simple synthesized sound effects (WebAudio, no asset files) with mute, volume
// and captions. Every cue that carries gameplay information has a caption, and
// the same information is always shown in the HUD too (never sound-only).

export const CUES = Object.freeze({
  push: { caption: null },
  ollie: { caption: '[board pop]' },
  land: { caption: '[clean landing]' },
  bail: { caption: '[crash]' },
  grind: { caption: '[metal grinding]' },
  pickup: { caption: '[bolt chime]' },
  quest: { caption: '[quest complete fanfare]' },
  level: { caption: '[level complete jingle]' },
  fail: { caption: '[level failed tone]' },
  checkpoint: { caption: '[checkpoint chime]' },
  wall: { caption: '[thud]' },
  combo: { caption: '[combo banked]' },
  timer: { caption: '[timer beep: 10 seconds left]' },
  buy: { caption: '[cash register]' },
  ui: { caption: null },
});

/** Caption text for a cue, or null when the cue carries no information. */
export function captionFor(name) {
  return CUES[name] ? CUES[name].caption : null;
}

export function createAudio({ onCaption = () => {} } = {}) {
  let ctx = null;
  let master = null;
  let volume = 0.8;
  let muted = false;
  let captions = true;
  let noiseBuf = null;
  let rollGain = null;
  let grindGain = null;
  const lastCaption = {};

  function ensure() {
    if (ctx) return ctx;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch {
      ctx = null;
      return null;
    }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 16807) % 2147483647;
      d[i] = (seed / 2147483647) * 2 - 1;
    }
    // Rolling and grinding loops.
    rollGain = loop(400, 0.7, 'lowpass');
    grindGain = loop(2400, 4, 'bandpass');
    return ctx;
  }

  function loop(freq, q, type) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(master);
    src.start();
    return g;
  }

  function tone(freq, dur, { type = 'sine', gain = 0.3, slide = 0, delay = 0 } = {}) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noise(dur, { freq = 1000, gain = 0.3, type = 'bandpass' } = {}) {
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(master);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  const SOUNDS = {
    push: () => noise(0.18, { freq: 300, gain: 0.25, type: 'lowpass' }),
    ollie: () => {
      noise(0.05, { freq: 2500, gain: 0.5 });
      tone(180, 0.08, { type: 'square', gain: 0.12 });
    },
    land: () => noise(0.14, { freq: 220, gain: 0.5, type: 'lowpass' }),
    bail: () => {
      noise(0.45, { freq: 400, gain: 0.6, type: 'lowpass' });
      tone(140, 0.3, { type: 'sawtooth', gain: 0.12, slide: -80 });
    },
    grind: () => noise(0.12, { freq: 3000, gain: 0.3 }),
    pickup: () => {
      tone(880, 0.12, { gain: 0.2 });
      tone(1320, 0.18, { gain: 0.18, delay: 0.07 });
    },
    quest: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, { type: 'triangle', gain: 0.18, delay: i * 0.09 })),
    level: () => [392, 523, 659, 784].forEach((f, i) => tone(f, 0.3, { type: 'triangle', gain: 0.2, delay: i * 0.12 })),
    fail: () => [392, 330, 262].forEach((f, i) => tone(f, 0.3, { type: 'triangle', gain: 0.18, delay: i * 0.15 })),
    checkpoint: () => tone(1046, 0.2, { type: 'triangle', gain: 0.2 }),
    wall: () => noise(0.12, { freq: 150, gain: 0.45, type: 'lowpass' }),
    combo: () => tone(660, 0.15, { type: 'triangle', gain: 0.15, slide: 300 }),
    timer: () => tone(1200, 0.08, { type: 'square', gain: 0.1 }),
    buy: () => {
      tone(1568, 0.08, { type: 'square', gain: 0.1 });
      tone(2093, 0.12, { type: 'square', gain: 0.1, delay: 0.06 });
    },
    ui: () => tone(700, 0.04, { type: 'triangle', gain: 0.08 }),
  };

  return {
    /** Resume/create the context after a user gesture (browser autoplay rules). */
    unlock() {
      const c = ensure();
      if (c && c.state === 'suspended') c.resume().catch(() => {});
    },
    play(name) {
      const cap = captionFor(name);
      if (cap && captions) {
        const now = Date.now();
        // Do not repeat the same caption more than ~2 times a second.
        if (!lastCaption[name] || now - lastCaption[name] > 450) {
          lastCaption[name] = now;
          onCaption(cap, name);
        }
      }
      if (muted || volume <= 0) return;
      const c = ensure();
      if (!c || c.state !== 'running') return;
      try {
        SOUNDS[name] && SOUNDS[name]();
      } catch {
        /* never let audio break the game */
      }
    },
    /** Continuous sounds: rolling volume follows speed; grinding loop while on a rail. */
    update(speed, grounded, grinding) {
      if (!ctx || !rollGain) return;
      const t = ctx.currentTime;
      rollGain.gain.setTargetAtTime(grounded && !grinding ? Math.min(0.35, speed * 0.03) : 0, t, 0.05);
      grindGain.gain.setTargetAtTime(grinding ? 0.25 : 0, t, 0.04);
    },
    stopLoops() {
      if (!ctx || !rollGain) return;
      rollGain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      grindGain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
    },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      if (master) master.gain.value = muted ? 0 : volume;
    },
    setMuted(m) {
      muted = !!m;
      if (master) master.gain.value = muted ? 0 : volume;
    },
    setCaptions(on) {
      captions = !!on;
    },
    get state() {
      return { volume, muted, captions, context: ctx ? ctx.state : 'none' };
    },
  };
}
