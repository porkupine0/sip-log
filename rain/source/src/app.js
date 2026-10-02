/* Cabin Rain: endless rain for sleeping, made on the device. Runs fully offline.
   How it avoids a loop: the synthesizer renders stretches of rain (about 83 s each) that fade in and out
   with equal-power curves. Two audio elements take turns; each new stretch starts as the last one begins
   fading, so the overlap keeps the loudness constant. After every blend a brand-new stretch is rendered,
   so nothing repeats on a schedule. Audio elements (not Web Audio) are used because iOS keeps them
   playing with the screen locked and the ringer switch on silent. */
(function () {
  'use strict';
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const SITE = window.CABIN_URL || '';
  const ICON = window.CABIN_ICON || '';
  const SR = 24000;
  const FAST = /(?:^|&)fast(?:=|&|$)/.test((location.search || '').slice(1)); // tests only: seconds instead of minutes
  const MIN = FAST ? 1000 : 60000;
  const XF = FAST ? 1.5 : 8;
  const SHAPES = FAST ? {
    intro: { inS: 0.4, bodyS: 2.6, outS: XF },
    switch: { inS: 0.3, bodyS: 2.7, outS: XF },
    normal: { inS: XF, bodyS: 2.5, outS: XF },
    outro: { inS: XF, bodyS: 1, outS: 3, longOut: true }
  } : {
    intro: { inS: 1.5, bodyS: 18.5, outS: XF },    // the first blend comes after 20 s
    switch: { inS: 0.5, bodyS: 19.5, outS: XF },   // used when the mix changes while playing
    normal: { inS: XF, bodyS: 67, outS: XF },      // then a fresh stretch every 75 s
    outro: { inS: XF, bodyS: 30, outS: 60, longOut: true } // sleep timer: a one-minute fade to silence
  };
  const STRETCH = SHAPES.normal.inS + SHAPES.normal.bodyS;
  const POOL = 4;

  // ---------- storage ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('cabinrain.' + k); if (v != null) return JSON.parse(v); } catch (e) { /* ignore */ } return d; },
    set(k, v) { try { localStorage.setItem('cabinrain.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };

  // ---------- presets and labels ----------
  const PRESETS = [
    { id: 'soft', name: 'Soft rain', note: 'Light rain on leaves', set: { surface: 'leaves', rain: 0.3, thunder: 0, wind: 0.1, rumble: 0.15, drips: 0.2, tone: 0.45 } },
    { id: 'steady', name: 'Steady rain', note: 'On the roof above you', set: { surface: 'roof', rain: 0.55, thunder: 0, wind: 0.15, rumble: 0.3, drips: 0.25, tone: 0.5 } },
    { id: 'downpour', name: 'Downpour', note: 'Heavy, with a deep rumble', set: { surface: 'roof', rain: 0.9, thunder: 0, wind: 0.3, rumble: 0.5, drips: 0.1, tone: 0.45 } },
    { id: 'tent', name: 'Tent', note: 'Taps on the canvas', set: { surface: 'tent', rain: 0.45, thunder: 0, wind: 0.1, rumble: 0.2, drips: 0.3, tone: 0.4 } },
    { id: 'sea', name: 'Rain at sea', note: 'Falling on open water', set: { surface: 'water', rain: 0.5, thunder: 0, wind: 0.35, rumble: 0.35, drips: 0, tone: 0.5 } },
    { id: 'storm', name: 'Far-off storm', note: 'Thunder rolling in the distance', set: { surface: 'leaves', rain: 0.65, thunder: 0.55, wind: 0.3, rumble: 0.45, drips: 0.1, tone: 0.4 } }
  ];
  const presetById = id => PRESETS.find(p => p.id === id);
  const SURFACES = [['leaves', 'Leaves'], ['roof', 'Roof'], ['tent', 'Tent canvas'], ['water', 'Open water']];
  const TIMERS = [[0, 'Off'], [20, '20 min'], [45, '45 min'], [60, '1 h'], [120, '2 h'], [240, '4 h'], [480, '8 h']];
  const US = /^en-US/i.test(navigator.language || '');
  const BEAUFORT = ['calm', 'light air', 'light breeze', 'gentle breeze', 'moderate breeze', 'fresh breeze', 'strong breeze'];
  function rainText(r) {
    const v = 0.4 * Math.pow(100, r);                       // millimetres per hour
    const cls = v < 2.5 ? 'light' : v < 7.6 ? 'moderate' : v < 50 ? 'heavy' : 'violent';
    const inch = v / 25.4;
    const amt = US ? `${inch < 0.1 ? inch.toFixed(2) : inch.toFixed(1)} in/h` : `${v < 10 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v)} mm/h`;
    return `≈${amt} · ${cls}`;
  }
  const thunderText = t => { if (t < 0.005) return 'Off'; const km = 25 - 20 * t; return US ? `≈${Math.round(km * 0.621)} mi away` : `≈${Math.round(km)} km away`; };
  const windText = w => { const f = Math.round(w * 6); return f ? `Force ${f} · ${BEAUFORT[f]}` : 'Calm'; };
  const levelText = v => v < 0.005 ? 'Off' : v < 0.34 ? 'Low' : v < 0.67 ? 'Medium' : 'High';
  const dripText = v => v < 0.005 ? 'Off' : v <= 0.5 ? 'One spot' : 'Two spots';
  const toneText = v => v < 0.34 ? 'Darker' : v < 0.67 ? 'Balanced' : 'Brighter';
  const SLIDERS = [
    ['rain', 'Rain', rainText, ''],
    ['thunder', 'Thunder', thunderText, ''],
    ['wind', 'Wind', windText, ''],
    ['rumble', 'Deep rumble', levelText, 'A low hum under the rain. Covers engine noise and hallway sounds.'],
    ['drips', 'Drips', dripText, 'Water dripping from an edge close by.'],
    ['tone', 'Tone', toneText, '']
  ];

  // ---------- settings ----------
  const S = { preset: 'steady', base: 'steady', set: clone(presetById('steady').set), timer: 0 };
  {
    const saved = store.get('settings', null);
    if (saved && typeof saved === 'object') {
      if (saved.preset === null || presetById(saved.preset)) S.preset = saved.preset;
      if (presetById(saved.base)) S.base = saved.base;
      if (saved.set) for (const k of Object.keys(S.set)) {
        const v = saved.set[k];
        if (k === 'surface' ? SURFACES.some(s => s[0] === v) : typeof v === 'number' && v >= 0 && v <= 1) S.set[k] = v;
      }
      if (TIMERS.some(t => t[0] === saved.timer)) S.timer = saved.timer;
    }
  }
  const save = () => store.set('settings', S);
  const sameSet = (a, b) => Object.keys(a).every(k => (typeof a[k] === 'number' ? Math.abs(a[k] - b[k]) < 0.005 : a[k] === b[k]));
  const matchPreset = () => { const p = PRESETS.find(x => sameSet(x.set, S.set)); return p ? p.id : null; };
  const mixName = () => { const p = S.preset && presetById(S.preset); if (p) return p.name; const b = presetById(S.base); return b ? `${b.name}, adjusted` : 'Your mix'; };

  // ---------- synthesis: in a worker when possible, on the main thread otherwise ----------
  const factory = window.cabinSynthFactory;
  const synthMain = factory();
  let worker = null, jobSeq = 0, mainChain = Promise.resolve();
  const pending = new Map();
  function runMain(job) {
    const p = mainChain.then(() => new Promise((res, rej) => setTimeout(() => { try { res(synthMain.render(job)); } catch (e) { rej(e); } }, 0)));
    mainChain = p.catch(() => {});
    return p;
  }
  function dropWorker() {
    if (!worker) return;
    try { worker.terminate(); } catch (e) { /* ignore */ }
    worker = null;
    const list = [...pending.values()];
    pending.clear();
    list.forEach(j => { clearTimeout(j.timer); runMain(j.job).then(j.resolve, j.reject); });
  }
  try {
    const src = 'const synth = (' + factory.toString() + ')();\n' +
      'self.onmessage = e => { const { id, job } = e.data; try { const r = synth.render(job); self.postMessage({ id, r }, r.pcm ? [r.pcm.buffer] : []); } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); } };';
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = e => {
      const j = pending.get(e.data.id); if (!j) return;
      pending.delete(e.data.id); clearTimeout(j.timer);
      if (e.data.error) j.reject(new Error(e.data.error)); else j.resolve(e.data.r);
    };
    worker.onerror = ev => { try { ev.preventDefault(); } catch (e) { /* ignore */ } dropWorker(); };
  } catch (e) { worker = null; }
  function synthCall(job) {
    if (!worker) return runMain(job);
    return new Promise((resolve, reject) => {
      const id = ++jobSeq;
      const entry = { job, resolve, reject, timer: setTimeout(() => { if (pending.has(id)) dropWorker(); }, 45000) };
      pending.set(id, entry);
      try { worker.postMessage({ id, job }); } catch (e) { pending.delete(id); clearTimeout(entry.timer); dropWorker(); runMain(job).then(resolve, reject); }
    });
  }

  // ---------- stretches of rain as WAV files in memory ----------
  function wavHeader(frames) {
    const b = new ArrayBuffer(44), v = new DataView(b), bytes = frames * 4;
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, SR, true);
    v.setUint32(28, SR * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, bytes, true);
    return b;
  }
  const SILENT = URL.createObjectURL(new Blob([wavHeader(SR / 4), new Int16Array(SR / 2)], { type: 'audio/wav' }));
  const keyOf = set => [set.surface, set.rain, set.thunder, set.wind, set.rumble, set.drips, set.tone].map(v => (typeof v === 'number' ? v.toFixed(2) : v)).join('|');
  const targetFor = set => Math.pow(10, (-20.5 + 4 * set.rain) / 20);
  const gains = new Map();
  function gainFor(set) {
    const k = keyOf(set);
    if (!gains.has(k)) {
      const p = synthCall({ sr: SR, set, seed: 4242, calib: true }).then(r => targetFor(set) / Math.max(1e-5, r.rms));
      p.catch(() => gains.delete(k));
      gains.set(k, p);
    }
    return gains.get(k);
  }
  let segSeq = 0;
  async function makeSeg(kind, set0) {
    const set = clone(set0);
    const gain = await gainFor(set);
    const shape = SHAPES[kind];
    const r = await synthCall(Object.assign({ sr: SR, set, seed: (Math.random() * 2147483646 + 1) | 0, gain, limit: Math.min(0.5, 4.5 * targetFor(set)) }, shape));
    const blob = new Blob([wavHeader(r.frames), r.pcm], { type: 'audio/wav' });
    return {
      id: ++segSeq, kind, key: keyOf(set), url: URL.createObjectURL(blob), dur: r.frames / SR,
      handoff: shape.longOut ? Infinity : shape.inS + shape.bodyS, thunder: r.thunder || [], strength: set.thunder,
      pcm: engine === 'media' && mediaProven ? null : r.pcm, uses: 0, born: ++bornSeq
    };
  }
  let bornSeq = 0;

  // ---------- players: two audio elements, or a Web Audio stand-in where files can't play ----------
  let engine = 'media', mediaProven = false, actx = null, master = null, volumeWorks = true;
  try { const probe = new Audio(); probe.volume = 0.5; volumeWorks = Math.abs(probe.volume - 0.5) < 0.01; } catch (e) { volumeWorks = false; }
  function ensureCtx() {
    if (!actx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return false;
      actx = new C(); master = actx.createGain(); master.connect(actx.destination);
    }
    if (actx.state !== 'running') actx.resume().catch(() => {});
    return true;
  }
  function bufferFor(seg) {
    if (seg.buf) return seg.buf;
    const n = seg.pcm.length / 2, b = actx.createBuffer(2, n, SR), L = b.getChannelData(0), R = b.getChannelData(1);
    for (let i = 0; i < n; i++) { L[i] = seg.pcm[2 * i] / 32768; R[i] = seg.pcm[2 * i + 1] / 32768; }
    seg.buf = b;
    return b;
  }
  class WAEl {
    constructor() { this._seg = null; this._loop = false; this._node = null; this._t0 = 0; this._off = 0; this._vol = 1; this._g = null; this._l = {}; this.paused = true; this.ended = false; this.src = ''; }
    addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }
    _emit(t) { (this._l[t] || []).forEach(f => f({ currentTarget: this, target: this, type: t })); }
    get loop() { return this._loop; }
    set loop(v) { this._loop = !!v; if (this._node) this._node.loop = this._loop; }
    get volume() { return this._vol; }
    set volume(v) { this._vol = v; if (this._g) this._g.gain.value = v; }
    get duration() { return this._seg ? this._seg.dur : NaN; }
    get currentTime() {
      if (this.paused || !this._node) return this._off;
      const t = actx.currentTime - this._t0, d = this.duration;
      return this._node.loop ? t % d : Math.min(t, d);
    }
    set currentTime(v) { this._off = Math.max(0, v || 0); if (!this.paused) { this._stopNode(); this._startNode(); } }
    play() {
      if (!actx || !this._seg || !this._seg.pcm) { const e = new Error('Not ready'); e.name = 'NotAllowedError'; return Promise.reject(e); }
      if (!this.paused) return Promise.resolve();
      this.paused = false; this.ended = false;
      this._startNode();
      return Promise.resolve();
    }
    pause() { if (this.paused) return; this._off = this.currentTime; this._stopNode(); this.paused = true; this._emit('pause'); }
    load() { /* nothing to do */ }
    removeAttribute() { /* nothing to do */ }
    remove() { this._stopNode(); }
    _startNode() {
      if (!this._g) { this._g = actx.createGain(); this._g.connect(master); }
      this._g.gain.value = this._vol;
      const n = actx.createBufferSource();
      n.buffer = bufferFor(this._seg); n.loop = this._loop; n.connect(this._g);
      n.onended = () => { if (this._node !== n) return; this._node = null; this.paused = true; this.ended = true; this._off = 0; this._emit('pause'); this._emit('ended'); };
      this._t0 = actx.currentTime - this._off;
      n.start(0, Math.min(this._off, Math.max(0, this.duration - 0.01)));
      this._node = n;
    }
    _stopNode() { const n = this._node; this._node = null; if (n) { n.onended = null; try { n.stop(); } catch (e) { /* ignore */ } try { n.disconnect(); } catch (e) { /* ignore */ } } }
  }
  function bindEl(el) {
    el.addEventListener('ended', onEnded);
    el.addEventListener('pause', onPause);
    el.addEventListener('playing', () => {
      if (engine !== 'media' || mediaProven || !el._seg) return;
      mediaProven = true;                     // files play here: the raw samples are no longer needed
      [introSeg, switchSeg, outroSeg].concat(pool).forEach(s => { if (s) s.pcm = null; });
    });
    el.addEventListener('timeupdate', () => { if (playing && el === els[cur] && curSeg && el.currentTime >= curSeg.handoff) handoff(); });
    el.addEventListener('error', () => { if (playing && el._seg && el === els[cur]) switchToWebAudio(); });
  }
  function makeMediaEl() {
    const a = new Audio();
    a.preload = 'auto';
    a.setAttribute('playsinline', '');
    a.setAttribute('aria-hidden', 'true');
    bindEl(a);
    document.body.appendChild(a);
    return a;
  }
  const els = [makeMediaEl(), makeMediaEl()];
  // pauses we make ourselves are counted, so the 'pause' event they fire isn't mistaken for the system stopping us
  function quietPause(el) { if (el.paused) return; el._quiet = (el._quiet || 0) + 1; el.pause(); }

  // ---------- the scheduler ----------
  let playing = false, starting = false, cur = 0, curSeg = null, curStarted = 0, handTimer = 0, blends = 0, timerEnd = 0, stoppedAt = 0, playToken = 0, unlocked = false;
  let introSeg = null, switchSeg = null, outroSeg = null, pool = [], filling = false, outroBusy = null, prepping = null;
  const inUse = seg => !!seg && (seg === curSeg || els.some(e => e._seg === seg));
  function release(seg) {
    if (!seg || seg.released || inUse(seg)) return false;
    seg.released = true;
    try { URL.revokeObjectURL(seg.url); } catch (e) { /* ignore */ }
    seg.pcm = null; seg.buf = null;
    return true;
  }
  function prune() {
    const key = keyOf(S.set);
    pool = pool.filter(s => !(s.key !== key && release(s)));
    let extra = pool.filter(s => s.key === key).length - POOL;
    while (extra > 0) {
      const victim = pool.filter(s => !inUse(s)).sort((a, b) => a.born - b.born)[0];
      if (!victim) break;
      release(victim); pool.splice(pool.indexOf(victim), 1); extra--;
    }
    if (introSeg && introSeg.key !== key && release(introSeg)) introSeg = null;
    if (switchSeg && switchSeg !== curSeg && release(switchSeg)) switchSeg = null;
    if (outroSeg && outroSeg.key !== key && release(outroSeg)) outroSeg = null;
  }
  function prepare() {
    const key = keyOf(S.set);
    if (introSeg && introSeg.key === key && !introSeg.released) return Promise.resolve(introSeg);
    if (prepping && prepping.key === key) return prepping.p;
    const p = makeSeg('intro', S.set).then(seg => {
      if (prepping && prepping.p === p) prepping = null;
      if (seg.key !== keyOf(S.set)) { release(seg); return null; }
      if (introSeg && introSeg !== seg) release(introSeg);
      introSeg = seg;
      return seg;
    }, err => { if (prepping && prepping.p === p) prepping = null; throw err; });
    prepping = { key, p };
    return p;
  }
  async function fill() {
    if (filling) return;
    filling = true;
    try {
      for (let guard = 0; guard < 10; guard++) {
        if (pool.filter(s => s.key === keyOf(S.set)).length >= POOL) break;
        const seg = await makeSeg('normal', S.set);
        if (seg.key === keyOf(S.set)) pool.push(seg); else release(seg);
      }
    } catch (e) { /* try again after the next blend */ } finally { filling = false; }
  }
  async function refresh() {
    if (filling || !playing) return;
    filling = true;
    try {
      const seg = await makeSeg('normal', S.set);
      if (seg.key === keyOf(S.set)) { pool.push(seg); prune(); } else release(seg);
    } catch (e) { /* the pool still has stretches to use */ } finally { filling = false; }
    if (pool.filter(s => s.key === keyOf(S.set)).length < POOL) fill();
  }
  async function prepareOutro() {
    const key = keyOf(S.set);
    if (!S.timer || outroBusy === key || (outroSeg && outroSeg.key === key && !outroSeg.released)) return;
    outroBusy = key;
    try {
      const seg = await makeSeg('outro', S.set);
      if (seg.key !== keyOf(S.set)) release(seg);
      else { if (outroSeg) release(outroSeg); outroSeg = seg; }
    } catch (e) { /* the timer falls back to a hard stop */ } finally { outroBusy = null; }
  }
  function unlock() {
    // iOS only lets an audio element play without a tap after it has been started from one
    if (unlocked) return;
    unlocked = true;
    if (engine === 'webaudio') { ensureCtx(); return; }
    for (const el of els) {
      if (!el._seg) el.src = SILENT;
      const p = el.play(); if (p && p.catch) p.catch(() => {});
      quietPause(el);
    }
  }
  function play() {
    if (playing) return;
    unlock();
    if (engine === 'webaudio' && !ensureCtx()) { toast('This browser cannot play the rain.'); return; }
    const token = ++playToken;
    playing = true; starting = true; stoppedAt = 0; blends = 0;
    timerEnd = S.timer ? Date.now() + S.timer * MIN : 0;
    const begin = seg => {
      if (token !== playToken || !playing) return;
      if (!seg) { prepare().then(begin, startFailed); return; }
      starting = false;
      for (const el of els) quietPause(el);
      startOn(0, seg);
      setMediaState('playing');
      fill();
      prepareOutro();
      ui();
    };
    if (introSeg && introSeg.key === keyOf(S.set) && !introSeg.released && (engine === 'media' || introSeg.pcm)) begin(introSeg);
    else { if (introSeg && engine !== 'media' && !introSeg.pcm) { release(introSeg); introSeg = null; } prepare().then(begin, startFailed); }
    ui();
  }
  function startFailed() { if (!playing) return; stop('error'); toast('The rain could not start. Tap the porthole to try again.'); }
  function startOn(i, seg) {
    const el = els[i];
    if (el._seg !== seg) { el.src = seg.url; el._seg = seg; }
    el.loop = seg.kind !== 'outro';         // if a handoff is ever missed, the stretch repeats instead of going silent
    try { el.currentTime = 0; } catch (e) { /* not loaded yet */ }
    try { el.volume = 1; } catch (e) { /* fixed on iOS */ }
    const p = el.play();
    if (p && p.catch) p.catch(err => playFailed(el, err));
    cur = i; curSeg = seg; curStarted = performance.now(); seg.uses++;
    arm();
  }
  function arm() {
    clearTimeout(handTimer);
    if (!playing || !curSeg || !isFinite(curSeg.handoff)) return;
    const left = curSeg.handoff - els[cur].currentTime;
    if (left <= 0.03) { handoff(); return; }
    handTimer = setTimeout(arm, Math.max(15, Math.min(left > 0.8 ? left - 0.5 : left, 4) * 1000));
  }
  function chooseNext() {
    const key = keyOf(S.set);
    if (timerEnd && outroSeg && outroSeg.key === key && !outroSeg.released && timerEnd - Date.now() <= (outroSeg.dur + STRETCH / 2) * 1000) return outroSeg;
    const ready = pool.filter(s => s.key === key && !s.released && (engine === 'media' || s.pcm));
    if (!ready.length) return null;
    const others = ready.filter(s => s !== curSeg);
    // least-played first, in random order among equals, so even a reused stretch never comes round on a schedule
    const list = (others.length ? others : ready).slice();
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    return list.sort((a, b) => a.uses - b.uses)[0];
  }
  function handoff() {
    clearTimeout(handTimer);
    if (!playing || starting || performance.now() - curStarted < 800) { if (playing) handTimer = setTimeout(arm, 300); return; }
    const next = chooseNext();
    if (!next) { handTimer = setTimeout(arm, 300); return; }
    const old = els[cur], i = 1 - cur, el = els[i];
    if (!el.paused) quietPause(el);
    old.loop = false;                        // let the old stretch finish its fade, then end on its own
    startOn(i, next);
    blends++;
    if (next.kind !== 'outro') refresh();
    ui();
  }
  function onEnded(e) {
    const el = e.currentTarget;
    if (playing && el === els[cur] && curSeg && curSeg.kind === 'outro') { stop('timer'); return; }
    prune();
  }
  function onPause(e) {
    const el = e.currentTarget;
    if (el._quiet > 0) { el._quiet--; return; }
    if (!playing || el.ended || el !== els[cur]) return;
    stop('system');                          // a call, an alarm, headphones out, or the lock screen
  }
  function playFailed(el, err) {
    if (!playing || el !== els[cur]) return;
    const name = err && err.name;
    if (name === 'AbortError') return;       // interrupted by our own pause or a new source
    if (name === 'NotAllowedError') { stop('blocked'); toast('Tap the porthole again to start the rain.'); return; }
    switchToWebAudio();
  }
  function switchToWebAudio() {
    if (engine === 'webaudio') return;
    const was = playing;
    engine = 'webaudio';
    stop('engine');
    curSeg = null;
    els.forEach(el => { try { el.pause(); el.removeAttribute('src'); el.load(); el.remove(); } catch (e) { /* ignore */ } });
    els.splice(0, 2, new WAEl(), new WAEl());
    els.forEach(bindEl);
    unlocked = false;
    // stretches without raw samples can't feed Web Audio; build new ones
    pool = pool.filter(s => s.pcm || !release(s));
    pool = pool.filter(s => s.pcm);
    [introSeg, switchSeg, outroSeg].forEach(s => { if (s && !s.pcm) release(s); });
    if (introSeg && !introSeg.pcm) introSeg = null;
    if (outroSeg && !outroSeg.pcm) outroSeg = null;
    if (switchSeg && !switchSeg.pcm) switchSeg = null;
    prepare().catch(() => {});
    if (was) toast('Tap the porthole again to start the rain.');
  }
  function stop(reason) {
    playing = false; starting = false; playToken++;
    clearTimeout(handTimer);
    els.forEach(quietPause);
    timerEnd = 0;
    stoppedAt = reason === 'timer' ? Date.now() : 0;
    setMediaState('paused');
    ui();
  }

  // changing the mix while it plays: a short stretch with the new settings takes over at once
  async function swap() {
    const key = keyOf(S.set);
    if (!playing || starting || !curSeg || curSeg.key === key) return;
    let seg;
    try { seg = await makeSeg('switch', S.set); } catch (e) { return; }
    if (!playing || starting || key !== keyOf(S.set)) { release(seg); return; }
    const old = els[cur], i = 1 - cur, el = els[i];
    if (!el.paused) quietPause(el);
    if (switchSeg && switchSeg !== seg && !inUse(switchSeg)) release(switchSeg);
    switchSeg = seg;
    startOn(i, seg);
    fadeAndPause(old);
    fill();
    prepare().catch(() => {});
    ui();
  }
  function fadeAndPause(el) {
    el.loop = false;
    if (!volumeWorks) { setTimeout(() => { if (el !== els[cur]) quietPause(el); }, 250); return; }
    const t0 = performance.now(), dur = 700;
    const step = () => {
      if (el === els[cur]) { try { el.volume = 1; } catch (e) { /* ignore */ } return; }
      const u = (performance.now() - t0) / dur;
      if (u >= 1) { quietPause(el); try { el.volume = 1; } catch (e) { /* ignore */ } return; }
      try { el.volume = Math.max(0, Math.cos(u * Math.PI / 2)); } catch (e) { /* ignore */ }
      setTimeout(step, 30);
    };
    step();
  }
  let applyTimer = 0;
  function settingsChanged(now) {
    save();
    ui();
    clearTimeout(applyTimer);
    applyTimer = setTimeout(() => {
      prune();
      if (playing && !starting) swap(); else prepare().catch(() => {});
      prepareOutro();
    }, now ? 0 : 350);
  }

  // ---------- lock screen ----------
  const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;
  function setMediaState(state) {
    if (!ms) return;
    try {
      if (window.MediaMetadata) ms.metadata = new MediaMetadata({ title: mixName(), artist: 'Cabin Rain', album: rainText(S.set.rain), artwork: ICON ? [{ src: ICON, sizes: '512x512', type: 'image/png' }] : [] });
      ms.playbackState = state;
    } catch (e) { /* ignore */ }
  }
  if (ms) {
    const h = (a, f) => { try { ms.setActionHandler(a, f); } catch (e) { /* unsupported action */ } };
    h('play', () => play());
    h('pause', () => stop('user'));
    h('stop', () => stop('user'));
    ['seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'].forEach(a => h(a, null));
  }

  // ---------- UI ----------
  const clock = ts => new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }
  function ui() {
    document.body.classList.toggle('playing', playing && !starting);
    document.body.classList.toggle('starting', playing && starting);
    $('#play').setAttribute('aria-label', playing ? 'Pause rain' : 'Play rain');
    $('#now').textContent = playing && starting ? 'Gathering clouds…'
      : playing ? (timerEnd ? `Raining until about ${clock(timerEnd)}` : 'Raining')
      : stoppedAt ? `Stopped at ${clock(stoppedAt)}. Sleep well.` : 'Tap the porthole to start';
    $('#detail').textContent = `${mixName()} · ${rainText(S.set.rain)}`;
    $('#fresh').textContent = playing && !starting
      ? (blends ? `${blends} fresh stretch${blends === 1 ? '' : 'es'} blended in so far` : `A fresh stretch blends in every ${Math.round(STRETCH)} seconds`)
      : '';
    $('#timer-hint').textContent = S.timer ? (playing && timerEnd ? `Fades out around ${clock(timerEnd)}` : `Starts counting when you press play`) : 'Fades out over a minute';
    $$('.preset').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === S.preset)));
    glassKick();
  }
  function renderControls() {
    $('#presets').innerHTML = PRESETS.map(p => `<button class="preset" type="button" data-act="preset" data-id="${p.id}" aria-pressed="${S.preset === p.id}"><b>${esc(p.name)}</b><span class="rate">${esc(rainText(p.set.rain))}</span><span class="note">${esc(p.note)}</span></button>`).join('');
    $('#surfaces').innerHTML = SURFACES.map(([id, label]) => `<button class="chip" type="button" data-act="surface" data-id="${id}" aria-pressed="${S.set.surface === id}">${esc(label)}</button>`).join('');
    $('#sliders').innerHTML = SLIDERS.map(([k, label, fmt, help]) => {
      const v = Math.round(S.set[k] * 100);
      return `<div class="slider"><label for="sl-${k}">${esc(label)}</label><output id="out-${k}" for="sl-${k}">${esc(fmt(S.set[k]))}</output><input id="sl-${k}" type="range" min="0" max="100" step="1" value="${v}" data-k="${k}" style="--fill:${v}%" aria-valuetext="${esc(fmt(S.set[k]))}">${help ? `<p class="help">${esc(help)}</p>` : ''}</div>`;
    }).join('');
    $('#timers').innerHTML = TIMERS.map(([m, label]) => `<button class="chip" type="button" data-act="timer" data-m="${m}" aria-pressed="${S.timer === m}">${esc(label)}</button>`).join('');
    $$('#sliders input').forEach(inp => {
      inp.addEventListener('input', () => {
        const k = inp.dataset.k, fmt = SLIDERS.find(s => s[0] === k)[2];
        S.set[k] = +inp.value / 100;
        S.preset = matchPreset();
        inp.style.setProperty('--fill', inp.value + '%');
        $('#out-' + k).textContent = fmt(S.set[k]);
        inp.setAttribute('aria-valuetext', fmt(S.set[k]));
        ui();
      });
      inp.addEventListener('change', () => settingsChanged(false));
    });
  }
  const ACT = {
    preset: t => { const p = presetById(t.dataset.id); if (!p) return; S.preset = p.id; S.base = p.id; S.set = clone(p.set); renderControls(); settingsChanged(true); },
    surface: t => { S.set.surface = t.dataset.id; S.preset = matchPreset(); $$('#surfaces .chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === S.set.surface))); settingsChanged(true); },
    'reset-mix': () => { const p = presetById(S.preset || S.base) || PRESETS[1]; S.preset = p.id; S.base = p.id; S.set = clone(p.set); renderControls(); settingsChanged(true); toast(`Back to ${p.name}`); },
    timer: t => {
      S.timer = +t.dataset.m; save();
      $$('#timers .chip').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.m === S.timer)));
      if (playing) timerEnd = S.timer ? Date.now() + S.timer * MIN : 0;
      prepareOutro();
      ui();
    },
    'copy-site': () => {
      const done = () => toast('Link copied');
      try { navigator.clipboard.writeText(SITE).then(done, () => toast(SITE)); } catch (e) { toast(SITE); }
    },
    'offline-help': () => { const o = $('#offline'); if (o) o.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  };
  $('#play').addEventListener('click', () => { if (playing) stop('user'); else play(); });
  document.addEventListener('click', e => { const t = e.target.closest('[data-act]'); if (t && ACT[t.dataset.act]) ACT[t.dataset.act](t, e); });

  // ---------- the porthole: rain on the glass, a ship's light on the horizon ----------
  const G = { cv: $('#glass'), ctx: null, w: 0, h: 0, s: 1, drops: [], streaks: [], raf: 0, last: 0, flash: 0, t: 0 };
  const reduce = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)'); } catch (e) { return { matches: false }; } })();
  let palette = null;
  function readPalette() {
    const cs = getComputedStyle(document.documentElement), g = n => cs.getPropertyValue(n).trim();
    palette = { sky: g('--sky'), horizon: g('--horizon'), sea: g('--sea'), drop: g('--droplet'), brass: g('--brass'), mist: g('--mist'), night: g('--night') };
  }
  function sizeGlass() {
    const r = G.cv.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    G.cv.width = Math.round(r.width * dpr); G.cv.height = Math.round(r.height * dpr);
    G.w = G.cv.width; G.h = G.cv.height; G.s = G.w / 260;
    G.ctx = G.cv.getContext('2d');
    if (!G.drops.length) for (let i = 0; i < 26; i++) G.drops.push(newDrop(true));
    draw();
  }
  function newDrop(anywhere) {
    const r = (0.7 + 1.9 * Math.pow(Math.random(), 2)) * G.s;
    return { x: Math.random() * G.w, y: anywhere ? Math.random() * G.h : Math.random() * G.h * 0.9, r, vy: 0, slide: false, age: 0 };
  }
  function animating() { return playing && !starting && !reduce.matches && document.visibilityState === 'visible'; }
  function glassKick() { if (animating() && !G.raf && G.ctx) { G.last = performance.now(); G.raf = requestAnimationFrame(frame); } else if (!animating()) draw(); }
  function frame(ts) {
    G.raf = 0;
    if (!animating()) { draw(); return; }
    const dt = Math.min(0.1, (ts - G.last) / 1000);
    if (dt >= 0.033) { G.last = ts; step(dt); draw(); }
    G.raf = requestAnimationFrame(frame);
  }
  function step(dt) {
    const I = S.set.rain, wind = S.set.wind;
    G.t += dt;
    // new drops land on the glass
    let n = (4 + 30 * I) * dt;
    while (n > 0) { if (Math.random() < n) G.drops.push(newDrop(false)); n -= 1; }
    for (const d of G.drops) {
      d.age += dt;
      if (!d.slide && d.r > 1.9 * G.s && Math.random() < 0.25 * dt) d.slide = true;
      if (d.slide) {
        d.vy = Math.min(90 * G.s, d.vy + 40 * G.s * dt);
        d.y += d.vy * dt; d.x += Math.sin(d.y * 0.05) * 0.2 * G.s;
        if (Math.random() < 6 * dt) G.drops.push({ x: d.x, y: d.y - d.r * 1.5, r: d.r * 0.35, vy: 0, slide: false, age: 0, trail: true });
      }
    }
    G.drops = G.drops.filter(d => d.y - d.r < G.h && !(d.trail && d.age > 6));
    if (G.drops.length > 110) G.drops.splice(0, G.drops.length - 110);
    // rain falling outside
    const want = Math.round(12 + 60 * I);
    while (G.streaks.length < want) G.streaks.push({ x: Math.random() * G.w * 1.2, y: Math.random() * G.h, len: (10 + 16 * Math.random()) * G.s, v: (260 + 160 * Math.random()) * G.s });
    if (G.streaks.length > want) G.streaks.length = want;
    for (const s of G.streaks) {
      s.y += s.v * dt; s.x -= s.v * dt * 0.18 * (0.3 + wind);
      if (s.y - s.len > G.h || s.x < -20) { s.y = -Math.random() * 20 * G.s; s.x = Math.random() * G.w * 1.2; }
    }
    // lightning a moment before each thunder roll
    if (curSeg && curSeg.thunder && curSeg.thunder.length && els[cur]) {
      const t = els[cur].currentTime;
      curSeg._lit = curSeg._lit || {};
      curSeg.thunder.forEach((th, i) => { if (!curSeg._lit[i] && t >= th - 1.4 && t < th) { curSeg._lit[i] = 1; G.flash = 0.25 + 0.35 * curSeg.strength; } });
    }
    G.flash = Math.max(0, G.flash - dt * 1.8);
  }
  function draw() {
    const c = G.ctx; if (!c) return;
    if (!palette) readPalette();
    const { w, h } = G, P = palette, live = animating();
    const sky = c.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, P.sky); sky.addColorStop(0.6, P.horizon); sky.addColorStop(0.605, P.sea); sky.addColorStop(1, P.sea);
    c.globalAlpha = 1; c.fillStyle = sky; c.fillRect(0, 0, w, h);
    // a ship's masthead light far off, blinking slowly
    c.fillStyle = P.brass; c.globalAlpha = live ? 0.45 + 0.35 * Math.sin(G.t * 1.3) : 0.55;
    c.beginPath(); c.arc(w * 0.27, h * 0.598, 1.6 * G.s, 0, Math.PI * 2); c.fill();
    if (live) {
      c.strokeStyle = P.drop; c.lineWidth = Math.max(1, 0.8 * G.s); c.globalAlpha = 0.22;
      c.beginPath();
      for (const s of G.streaks) { c.moveTo(s.x, s.y); c.lineTo(s.x + s.len * 0.18 * (0.3 + S.set.wind), s.y - s.len); }
      c.stroke();
    }
    for (const d of G.drops) {
      c.globalAlpha = d.trail ? 0.35 : 0.42; c.fillStyle = P.drop;
      c.beginPath(); c.arc(d.x, d.y, d.r, 0, Math.PI * 2); c.fill();
      c.globalAlpha = 0.7; c.fillStyle = P.mist;
      c.beginPath(); c.arc(d.x - d.r * 0.35, d.y - d.r * 0.35, Math.max(0.5, d.r * 0.32), 0, Math.PI * 2); c.fill();
    }
    if (G.flash > 0) { c.globalAlpha = G.flash; c.fillStyle = P.mist; c.fillRect(0, 0, w, h); }
    const vig = c.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w * 0.52);
    vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, P.night);
    c.globalAlpha = live ? 0.55 : 0.7; c.fillStyle = vig; c.fillRect(0, 0, w, h);
    c.globalAlpha = 1;
  }
  let rz;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(sizeGlass, 150); });
  document.addEventListener('visibilitychange', () => { glassKick(); if (document.visibilityState === 'visible') ui(); });
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (playing && timerEnd && Date.now() > timerEnd + 3 * MIN) stop('timer'); // the fade never came: stop anyway
    if (playing) ui();
  }, 1000);

  // ---------- offline status ----------
  function setStatus(state) {
    const el = $('#status'); if (!el) return;
    const map = { file: ['ok', 'Offline file'], ready: ['ok', 'Offline ready'], saving: ['', 'Saving offline…'], online: ['', 'Keep offline'] };
    const [cls, label] = map[state] || map.online;
    el.className = 'pill ' + cls;
    el.querySelector('span').textContent = label;
  }
  function initOffline() {
    let framed = false;
    try { framed = window.top !== window.self; } catch (e) { framed = true; }
    if (location.protocol === 'file:') { setStatus('file'); return; }
    if (!framed && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost') && document.querySelector('link[rel="manifest"]')) {
      // another app on the same site (Sip Log, one folder up) can control the very first visit; only our own worker counts
      const ours = c => !!c && c.scriptURL === new URL('sw.js', location.href).href;
      setStatus(ours(navigator.serviceWorker.controller) ? 'ready' : 'saving');
      navigator.serviceWorker.register('sw.js').then(reg => {
        if (reg.active) setStatus('ready');
        navigator.serviceWorker.ready.then(() => setStatus('ready'));
      }).catch(() => setStatus('online'));
      return;
    }
    setStatus('online');
  }
  // can this browser play a generated file at all? (a sandboxed preview might not)
  function probeMedia() {
    const a = new Audio();
    a.preload = 'metadata';
    a.addEventListener('error', () => { if (!playing) switchToWebAudio(); });
    a.src = SILENT;
    try { a.load(); } catch (e) { /* ignore */ }
  }

  // ---------- boot ----------
  if (SITE) { $('#site-url').textContent = SITE; $('#site-line').hidden = false; }
  renderControls();
  ui();
  readPalette();
  sizeGlass();
  initOffline();
  probeMedia();
  prepare().catch(() => {});                 // the opening stretch is ready before the first tap
  if (S.timer) prepareOutro();
  window.__cabin = { forceWebAudio: () => switchToWebAudio(), state: () => ({ playing, starting, engine, mediaProven, blends, cur, curKind: curSeg && curSeg.kind, curId: curSeg && curSeg.id, pool: pool.map(s => s.id), timerEnd, worker: !!worker, els: els.map(e => ({ paused: e.paused, t: +(e.currentTime || 0).toFixed(2), seg: e._seg && e._seg.id, loop: e.loop })) }) };
})();
