/* Cabin Rain synthesizer. Renders one stretch of stereo rain as 16-bit PCM.
   Each stretch fades in and out with equal-power curves, so two stretches overlapped
   at the handoff point keep a constant loudness: the listener hears one continuous storm.
   Self-contained so it can run in a Web Worker (built from this function's source) or in Node for tests. */
function cabinSynthFactory() {
  'use strict';
  const TAU = Math.PI * 2;

  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // What the rain lands on. Frequencies in Hz, decay times in ms, rates in drops per second at full intensity.
  const SURFACES = {
    leaves: { washHp: 520, washLp: 7200, wash: 0.17, near: 130, nearLo: 1700, nearHi: 6200, tauLo: 0.6, tauHi: 2.4, noisy: 0.25, nearAmp: 0.55, far: 2600, farHz: 3100, farQ: 0.6, farAmp: 0.42, thud: 6, thudAmp: 0.35, bubbles: 0 },
    roof: { washHp: 360, washLp: 8000, wash: 0.21, near: 210, nearLo: 1300, nearHi: 5200, tauLo: 0.4, tauHi: 1.6, noisy: 0.62, nearAmp: 0.46, far: 4200, farHz: 2300, farQ: 0.5, farAmp: 0.46, thud: 45, thudAmp: 0.28, bubbles: 0 },
    tent: { washHp: 420, washLp: 6000, wash: 0.15, near: 150, nearLo: 330, nearHi: 1150, tauLo: 2.6, tauHi: 8.5, noisy: 0.12, nearAmp: 0.62, far: 1900, farHz: 1500, farQ: 0.7, farAmp: 0.34, thud: 20, thudAmp: 0.32, bubbles: 0 },
    water: { washHp: 620, washLp: 9000, wash: 0.21, near: 160, nearLo: 1500, nearHi: 4800, tauLo: 0.3, tauHi: 1.0, noisy: 0.75, nearAmp: 0.3, far: 3600, farHz: 3500, farQ: 0.5, farAmp: 0.46, thud: 0, thudAmp: 0, bubbles: 28 }
  };

  // job: { sr, inS, bodyS, outS, longOut, set, seed, gain, limit, calib }
  // set: { surface, rain, thunder, wind, rumble, drips, tone } (all 0..1 except surface)
  function render(job) {
    const sr = job.sr || 24000;
    const set = job.set;
    const S = SURFACES[set.surface] || SURFACES.leaves;
    const rnd = mulberry(job.seed || 1);
    let xs = ((job.seed || 1) * 2654435761) | 0 || 123456789; // white-noise state (xorshift32)
    const calib = !!job.calib;
    const nIn = Math.round((calib ? 0 : job.inS) * sr);
    const nBody = Math.round((calib ? 8 : job.bodyS) * sr);
    const nOut = Math.round((calib ? 0 : job.outS) * sr);
    const N = nIn + nBody + nOut;
    const L = new Float32Array(N), R = new Float32Array(N);
    const I = Math.max(0, Math.min(1, set.rain));
    const curve = 0.12 + 1.6 * Math.pow(I, 1.5);          // drop density
    const level = 0.45 + 0.9 * I;                          // overall rain energy
    const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 2;

    // slow "gusts": the rain swells and eases over 7-45 seconds
    const gust = new Float32Array(N);
    {
      const depth = calib ? 0 : 0.1 + 0.16 * set.wind;
      const comps = [[7, 13, 0.5], [15, 25, 0.3], [30, 45, 0.2]].map(([a, b, amp]) => [TAU / ((a + (b - a) * rnd()) * sr), rnd() * TAU, amp]);
      for (let i = 0; i < N; i += 256) {
        let v = 1;
        for (const [w, ph, amp] of comps) v += depth * amp * Math.sin(w * i + ph);
        const end = Math.min(N, i + 256);
        for (let j = i; j < end; j++) gust[j] = v;
      }
    }

    // 1. the wash: shaped noise, slightly different in each ear
    {
      const a = Math.exp(-TAU * S.washHp / sr), b = 1 - Math.exp(-TAU * S.washLp / sr);
      const amp = S.wash * level * (0.55 + 0.6 * I);
      let lx = 0, ly1 = 0, ly2 = 0, lz1 = 0, lz2 = 0, rx = 0, ry1 = 0, ry2 = 0, rz1 = 0, rz2 = 0, lpx2 = 0, rpx2 = 0;
      for (let i = 0; i < N; i++) {
        xs ^= xs << 13; xs ^= xs >>> 17; xs ^= xs << 5; const wl = xs * 4.656612873077393e-10;
        xs ^= xs << 13; xs ^= xs >>> 17; xs ^= xs << 5; const wr = xs * 4.656612873077393e-10;
        ly1 = a * (ly1 + wl - lx); lx = wl; ly2 = a * (ly2 + ly1 - lpx2); lpx2 = ly1;
        ry1 = a * (ry1 + wr - rx); rx = wr; ry2 = a * (ry2 + ry1 - rpx2); rpx2 = ry1;
        lz1 += b * (ly2 - lz1); lz2 += b * (lz1 - lz2);
        rz1 += b * (ry2 - rz1); rz2 += b * (rz1 - rz2);
        const g = amp * gust[i];
        L[i] += lz2 * g; R[i] += rz2 * g;
      }
    }

    // 2. distant drops: thousands of tiny impulses through a broad band-pass, merging into patter
    {
      const rate = S.far * curve;
      const w0 = TAU * S.farHz / sr, al = Math.sin(w0) / (2 * S.farQ), a0 = 1 + al;
      const b0 = al / a0, a1 = -2 * Math.cos(w0) / a0, a2 = (1 - al) / a0;
      const amp = S.farAmp * level * 3.1;
      let next = -Math.log(1 - rnd()) / rate * sr;
      let lx1 = 0, lx2 = 0, ly1 = 0, ly2 = 0, rx1 = 0, rx2 = 0, ry1 = 0, ry2 = 0;
      for (let i = 0; i < N; i++) {
        let il = 0, ir = 0;
        while (next < i + 1) {
          const u = rnd(), v = (rnd() < 0.5 ? -1 : 1) * u * u * gust[i];
          const p = rnd();
          il += v * Math.cos(p * 1.5707963); ir += v * Math.sin(p * 1.5707963);
          next += -Math.log(1 - rnd()) / rate * sr;
        }
        const yl = b0 * il - b0 * lx2 - a1 * ly1 - a2 * ly2; lx2 = lx1; lx1 = il; ly2 = ly1; ly1 = yl;
        const yr = b0 * ir - b0 * rx2 - a1 * ry1 - a2 * ry2; rx2 = rx1; rx1 = ir; ry2 = ry1; ry1 = yr;
        L[i] += yl * amp; R[i] += yr * amp;
      }
    }

    // a single drop: damped resonance (tick, tap, plink) or a short noise burst (splat)
    function drop(n, A, pan, tau, f, noisy) {
      const gl = Math.cos(pan * 1.5707963), gr = Math.sin(pan * 1.5707963);
      const K = Math.min(N - n, Math.ceil(tau * 5));
      if (K <= 0) return;
      if (noisy) {
        const d = Math.exp(-1 / tau), bb = 0.25 + 0.7 * rnd();
        let e = A * 1.6, z = 0;
        for (let k = 0; k < K; k++) {
          xs ^= xs << 13; xs ^= xs >>> 17; xs ^= xs << 5;
          z += bb * (xs * 4.656612873077393e-10 - z);
          const v = z * e; L[n + k] += v * gl; R[n + k] += v * gr; e *= d;
        }
      } else {
        const w = TAU * f / sr, r = Math.exp(-1 / tau), c = 2 * r * Math.cos(w), r2 = r * r, ph = rnd() * TAU;
        let y1 = A * Math.sin(ph), y2 = A * Math.sin(ph - w) / r;
        for (let k = 0; k < K; k++) {
          L[n + k] += y1 * gl; R[n + k] += y1 * gr;
          const y0 = c * y1 - r2 * y2; y2 = y1; y1 = y0;
        }
      }
    }
    function scatter(rate, amp, cap, fLo, fHi, tauLo, tauHi, noisyShare, sigma) {
      if (rate <= 0 || amp <= 0) return;
      let t = -Math.log(1 - rnd()) / rate * sr;
      const ms = sr / 1000;
      while (t < N) {
        const n = t | 0;
        const A = Math.min(cap, amp * Math.exp(sigma * gauss())) * gust[n];
        const tau = (tauLo + (tauHi - tauLo) * rnd()) * ms;
        drop(n, A, rnd(), tau, fLo * Math.pow(fHi / fLo, rnd()), rnd() < noisyShare);
        t += -Math.log(1 - rnd()) / rate * sr;
      }
    }

    // 3. nearby drops, each with its own pitch, decay and place in the stereo field
    scatter(S.near * curve, S.nearAmp * level * 0.45, S.nearAmp * level * 0.75, S.nearLo, S.nearHi, S.tauLo, S.tauHi, S.noisy, 0.55);
    // 4. heavier drops: low thuds on a roof or tent, plops from leaves
    scatter(S.thud * curve, S.thudAmp * level * 0.4, S.thudAmp * level * 0.6, 160, 620, 3, 9, 0.2, 0.5);

    // 5. bubbles: drops landing on water ring with a rising pitch
    if (S.bubbles) {
      const rate = S.bubbles * curve, amp = 0.15 * level;
      let t = -Math.log(1 - rnd()) / rate * sr;
      while (t < N) {
        const n = t | 0, f0 = 1400 * Math.pow(Math.min(0.4 * sr, 8200) / 1400, rnd()), beta = 0.15 + 0.45 * rnd();
        const tau = (3 + 7 * rnd()) * sr / 1000, K = Math.min(N - n, Math.ceil(tau * 4.5));
        const A = Math.min(amp * 3, amp * Math.exp(0.6 * gauss())) * gust[n], pan = rnd();
        const gl = Math.cos(pan * 1.5707963), gr = Math.sin(pan * 1.5707963), d = Math.exp(-1 / tau);
        let ph = 0, e = A;
        for (let k = 0; k < K; k++) {
          ph += TAU * f0 * (1 + beta * k / K) / sr;
          const v = e * Math.sin(ph); L[n + k] += v * gl; R[n + k] += v * gr; e *= d;
        }
        t += -Math.log(1 - rnd()) / rate * sr;
      }
    }

    // 6. drips: one or two spots nearby, dripping at their own uneven pace
    if (set.drips > 0 && !calib) {
      const spots = set.drips > 0.5 ? 2 : 1;
      for (let s = 0; s < spots; s++) {
        const base = 520 + 700 * rnd(), pan = 0.15 + 0.7 * rnd(), mean = 1.1 + 1.6 * rnd();
        const gl = Math.cos(pan * 1.5707963), gr = Math.sin(pan * 1.5707963);
        const amp = 0.22 * set.drips * (0.7 + 0.5 * rnd());
        let t = rnd() * mean * sr;
        while (t < N) {
          const n = t | 0, f0 = base * (0.92 + 0.16 * rnd()), rise = 0.25 + 0.45 * rnd();
          const tau = (9 + 9 * rnd()) * sr / 1000, K = Math.min(N - n, Math.ceil(tau * 4.5)), d = Math.exp(-1 / tau);
          let ph = 0, e = amp * (0.8 + 0.4 * rnd());
          for (let k = 0; k < K; k++) {
            ph += TAU * f0 * (1 + rise * k / K) / sr;
            const v = e * Math.sin(ph); L[n + k] += v * gl; R[n + k] += v * gr; e *= d;
          }
          drop(n, amp * 0.5, pan, 0.6 * sr / 1000, 3000, true);
          t += mean * (0.55 + 0.9 * rnd()) * sr;
        }
      }
    }

    // 7. wind: band-passed noise whose pitch and strength drift
    if (set.wind > 0) {
      const amp = 0.9 * Math.pow(set.wind, 1.3);
      const q = 1 / 1.1;
      const lfo = [0, 1].map(() => [TAU / ((5 + 9 * rnd()) * sr), rnd() * TAU, TAU / ((11 + 14 * rnd()) * sr), rnd() * TAU]);
      for (let c = 0; c < 2; c++) {
        const out = c ? R : L, [w1, p1, w2, p2] = lfo[c];
        let low = 0, band = 0, f = 0, env = 0;
        for (let i = 0; i < N; i++) {
          if ((i & 63) === 0) {
            const m = 0.5 + 0.3 * Math.sin(w1 * i + p1) + 0.2 * Math.sin(w2 * i + p2);
            f = 2 * Math.sin(Math.PI * (210 + 520 * m) / sr);
            env = amp * (0.35 + 0.65 * m * m);
          }
          xs ^= xs << 13; xs ^= xs >>> 17; xs ^= xs << 5;
          low += f * band; const high = xs * 4.656612873077393e-10 - low - q * band; band += f * high;
          out[i] += band * env;
        }
      }
    }

    // 8. deep rumble: brown noise, mostly shared between the ears
    if (set.rumble > 0) {
      const amp = 0.06 * Math.pow(set.rumble, 1.2);
      const hp = Math.exp(-TAU * 38 / sr), lp = 1 - Math.exp(-TAU * 330 / sr);
      let c0 = 0, l0 = 0, r0 = 0, lpl = 0, lpr = 0, hxl = 0, hyl = 0, hxr = 0, hyr = 0;
      for (let i = 0; i < N; i++) {
        xs ^= xs << 13; xs ^= xs >>> 17; xs ^= xs << 5; c0 = 0.996 * c0 + xs * 4.656612873077393e-10;
        xs ^= xs << 13; xs ^= xs >>> 17; xs ^= xs << 5; l0 = 0.996 * l0 + xs * 4.656612873077393e-10;
        xs ^= xs << 13; xs ^= xs >>> 17; xs ^= xs << 5; r0 = 0.996 * r0 + xs * 4.656612873077393e-10;
        const sl = 0.75 * c0 + 0.4 * l0, srr = 0.75 * c0 + 0.4 * r0;
        hyl = hp * (hyl + sl - hxl); hxl = sl; hyr = hp * (hyr + srr - hxr); hxr = srr;
        lpl += lp * (hyl - lpl); lpr += lp * (hyr - lpr);
        L[i] += lpl * amp; R[i] += lpr * amp;
      }
    }

    // tone: darker or brighter overall
    {
      const fc = Math.min(0.46 * sr, 1700 * Math.pow(2, set.tone * 2.75));
      const b = 1 - Math.exp(-TAU * fc / sr);
      let l1 = 0, l2 = 0, r1 = 0, r2 = 0;
      for (let i = 0; i < N; i++) {
        l1 += b * (L[i] - l1); l2 += b * (l1 - l2); L[i] = l2;
        r1 += b * (R[i] - r1); r2 += b * (r1 - r2); R[i] = r2;
      }
    }

    if (calib) {
      let s = 0;
      const from = Math.round(0.5 * sr);
      for (let i = from; i < N; i++) s += L[i] * L[i] + R[i] * R[i];
      return { rms: Math.sqrt(s / (2 * (N - from))) };
    }

    // master level, then thunder on top at a fixed loudness
    const gain = job.gain || 1;
    for (let i = 0; i < N; i++) { L[i] *= gain; R[i] *= gain; }
    const thunder = [];
    if (set.thunder > 0) {
      const far = 1 - set.thunder;                         // 0 = nearer, 1 = very far
      const perMin = 0.55 + 0.9 * set.thunder;
      const first = nIn + 3 * sr, last = nIn + nBody - 14 * sr; // keep thunder clear of the crossfades
      let t = first + (-Math.log(1 - rnd()) * 60 / perMin) * sr * 0.6;
      while (t < last) {
        const s0 = t | 0, D = Math.round((8 + 8 * rnd()) * sr), dist = Math.min(1, far * 0.8 + 0.3 * rnd());
        thunder.push(s0 / sr);
        const peak = 0.07 + 0.11 * set.thunder;
        const rolls = [];
        const nr = 2 + Math.floor(rnd() * 4);
        for (let k = 0; k < nr; k++) rolls.push([k ? (0.25 + 0.5 * rnd()) * D : 0, k ? 0.35 + 0.6 * rnd() : 1, (0.12 + 0.35 * rnd()) * sr, (0.9 + 2.2 * rnd()) * sr]);
        const fc = 70 + 260 * (1 - dist), b = 1 - Math.exp(-TAU * fc / sr);
        let c0 = 0, l0 = 0, r0 = 0, al = 0, al2 = 0, ar = 0, ar2 = 0, flut = 1, fl = 0;
        const end = Math.min(N, s0 + D);
        let env = 0;
        for (let i = s0; i < end; i++) {
          const k = i - s0;
          if ((k & 31) === 0) {
            env = 0;
            for (const [st, a, att, dec] of rolls) {
              if (k < st) continue;
              const x = k - st;
              env += a * (x < att ? (x / att) * (x / att) * (3 - 2 * x / att) : Math.exp(-(x - att) / dec));
            }
            env *= Math.min(1, (D - k) / (1.5 * sr)) * peak;
            xs ^= xs << 13; xs ^= xs >>> 17; xs ^= xs << 5;
            fl += 0.08 * (xs * 4.656612873077393e-10 - fl);
            flut = 1 + 1.6 * fl;
          }
          xs ^= xs << 13; xs ^= xs >>> 17; xs ^= xs << 5; c0 = 0.997 * c0 + xs * 4.656612873077393e-10;
          xs ^= xs << 13; xs ^= xs >>> 17; xs ^= xs << 5; l0 = 0.997 * l0 + xs * 4.656612873077393e-10;
          xs ^= xs << 13; xs ^= xs >>> 17; xs ^= xs << 5; r0 = 0.997 * r0 + xs * 4.656612873077393e-10;
          al += b * ((0.8 * c0 + 0.35 * l0) - al); al2 += b * (al - al2);
          ar += b * ((0.8 * c0 + 0.35 * r0) - ar); ar2 += b * (ar - ar2);
          const g = env * flut * 0.2;
          L[i] += al2 * g; R[i] += ar2 * g;
        }
        t += (-Math.log(1 - rnd()) * 60 / perMin + 10) * sr;
      }
    }

    // peak limiter with 1 ms lookahead: keeps the odd fat drop or thunder roll from jumping out
    if (job.limit) {
      const T = job.limit, W = Math.max(1, Math.round(0.001 * sr)), rel = Math.exp(-1 / (0.06 * sr));
      const g = new Float32Array(N);
      for (let i = 0; i < N; i++) { const p = Math.max(Math.abs(L[i]), Math.abs(R[i])); g[i] = p > T ? T / p : 1; }
      for (let i = N - 2; i >= 0; i--) { const up = g[i + 1] + (1 - g[i + 1]) / W; if (up < g[i]) g[i] = up; }
      let last = 1;
      for (let i = 0; i < N; i++) { const rec = 1 - (1 - last) * rel; const v = g[i] < rec ? g[i] : rec; last = v; L[i] *= v; R[i] *= v; }
    }

    // equal-power fades, soft ceiling, 16-bit interleave
    const pcm = new Int16Array(N * 2);
    const outStart = nIn + nBody;
    for (let i = 0; i < N; i++) {
      let g = 1;
      if (i < nIn) g = Math.sin(1.5707963 * (i / nIn));
      else if (i >= outStart) { const u = (i - outStart) / nOut; g = job.longOut ? Math.cos(1.5707963 * u) * Math.cos(1.5707963 * u) : Math.cos(1.5707963 * u); }
      let l = L[i] * g, r = R[i] * g;
      // soft ceiling: rare peaks (a fat drop, a thunder roll) are rounded off instead of clipping
      if (l > 0.5) l = 0.5 + 0.45 * Math.tanh((l - 0.5) / 0.45); else if (l < -0.5) l = -0.5 - 0.45 * Math.tanh((-l - 0.5) / 0.45);
      if (r > 0.5) r = 0.5 + 0.45 * Math.tanh((r - 0.5) / 0.45); else if (r < -0.5) r = -0.5 - 0.45 * Math.tanh((-r - 0.5) / 0.45);
      pcm[2 * i] = Math.round(l * 32767); pcm[2 * i + 1] = Math.round(r * 32767);
    }
    return { pcm, frames: N, sr, thunder };
  }

  return { render, SURFACES };
}
if (typeof module !== 'undefined' && module.exports) module.exports = cabinSynthFactory;
