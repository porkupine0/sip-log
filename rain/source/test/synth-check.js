// Renders every preset, times it, writes WAVs for listening/inspection, and checks the crossfade seam.
const factory = require('../src/synth.js');
const fs = require('fs');
const path = require('path');
const { render } = factory();
const OUT = process.argv[2] || path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const SR = 24000;
const PRESETS = {
  soft: { surface: 'leaves', rain: 0.3, thunder: 0, wind: 0.1, rumble: 0.15, drips: 0.2, tone: 0.45 },
  steady: { surface: 'roof', rain: 0.55, thunder: 0, wind: 0.15, rumble: 0.3, drips: 0.25, tone: 0.5 },
  downpour: { surface: 'roof', rain: 0.9, thunder: 0, wind: 0.3, rumble: 0.5, drips: 0.1, tone: 0.45 },
  tent: { surface: 'tent', rain: 0.45, thunder: 0, wind: 0.1, rumble: 0.2, drips: 0.3, tone: 0.4 },
  sea: { surface: 'water', rain: 0.5, thunder: 0, wind: 0.35, rumble: 0.35, drips: 0, tone: 0.5 },
  storm: { surface: 'leaves', rain: 0.65, thunder: 0.55, wind: 0.3, rumble: 0.45, drips: 0.1, tone: 0.4 }
};
function wav(pcm, sr) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.byteLength, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 4, 28);
  h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([h, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)]);
}
function stats(pcm, from, to) {
  let s = 0, pk = 0, clip = 0;
  for (let i = from * 2; i < to * 2; i++) { const v = pcm[i] / 32768; s += v * v; const a = Math.abs(v); if (a > pk) pk = a; if (a > 0.97) clip++; }
  const rms = Math.sqrt(s / ((to - from) * 2));
  return { rmsDb: +(20 * Math.log10(rms)).toFixed(1), peakDb: +(20 * Math.log10(pk)).toFixed(1), crest: +(pk / rms).toFixed(1), clip };
}
const report = {};
for (const [name, set] of Object.entries(PRESETS)) {
  let t = Date.now();
  const cal = render({ sr: SR, set, seed: 7, calib: true });
  const target = Math.pow(10, (-22 + 4 * set.rain) / 20);
  const gain = target / cal.rms;
  const tCal = Date.now() - t;
  t = Date.now();
  const limit = Math.min(0.5, 4.5 * target);
  const A = render({ sr: SR, inS: 8, bodyS: 67, outS: 8, set, seed: 11, gain, limit });
  const tSeg = Date.now() - t;
  const B = render({ sr: SR, inS: 8, bodyS: 67, outS: 8, set, seed: 12, gain, limit });
  fs.writeFileSync(path.join(OUT, `${name}.wav`), wav(A.pcm, SR));
  // seam: A's fade-out overlapped with B's fade-in, with timing errors of 0, 0.3 s and 1 s
  const hand = 75 * SR, xf = 8 * SR;
  const seam = {};
  for (const jit of [0, 0.3, 1]) {
    const off = Math.round(jit * SR);
    const span = 30 * SR, start = hand - 10 * SR;
    const mix = new Float32Array(span * 2);
    for (let i = 0; i < span; i++) {
      const ia = start + i, ib = ia - hand - off;
      for (let c = 0; c < 2; c++) {
        let v = ia < A.frames ? A.pcm[2 * ia + c] : 0;
        if (ib >= 0 && ib < B.frames) v += B.pcm[2 * ib + c];
        mix[2 * i + c] = v / 32768;
      }
    }
    // loudness in 0.5 s windows, smoothed: report the spread across the seam
    const win = SR / 2, vals = [];
    for (let i = 0; i + win <= span; i += win) { let s = 0; for (let k = i; k < i + win; k++) s += mix[2 * k] ** 2 + mix[2 * k + 1] ** 2; vals.push(10 * Math.log10(s / (2 * win))); }
    const before = vals.slice(0, 16), during = vals.slice(20, 36), after = vals.slice(44, 60);
    const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
    seam['jitter ' + jit + 's'] = { before: +avg(before).toFixed(2), during: +avg(during).toFixed(2), after: +avg(after).toFixed(2), minDuring: +Math.min(...during).toFixed(2), maxDuring: +Math.max(...during).toFixed(2) };
    if (jit === 0 && name === 'steady') fs.writeFileSync(path.join(OUT, `seam-${name}.wav`), wav(Int16Array.from(mix, v => Math.max(-32768, Math.min(32767, Math.round(v * 32767)))), SR));
  }
  report[name] = { calMs: tCal, segMs: tSeg, gain: +gain.toFixed(2), body: stats(A.pcm, 10 * SR, 70 * SR), thunder: A.thunder.map(x => +x.toFixed(1)), seam };
}
console.log(JSON.stringify(report, null, 1));
