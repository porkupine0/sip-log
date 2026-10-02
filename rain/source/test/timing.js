// Measures how close each handoff lands to its planned point, for the media engine and the Web Audio fallback.
const { chromium } = require('playwright');
const path = require('path');
async function run(engine) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.join(__dirname, '..', 'dist', 'Cabin-Rain.html') + '?fast');
  await page.waitForTimeout(800);
  if (engine === 'webaudio') { await page.evaluate(() => window.__cabin.forceWebAudio()); await page.waitForTimeout(800); }
  await page.click('#play');
  await page.waitForTimeout(300);
  const res = await page.evaluate(() => new Promise(resolve => {
    const out = []; const t0 = performance.now();
    const iv = setInterval(() => {
      const s = window.__cabin.state();
      out.push({ ms: Math.round(performance.now() - t0), cur: s.cur, kind: s.curKind, blends: s.blends, els: s.els });
      if (performance.now() - t0 > 15000) { clearInterval(iv); resolve(out); }
    }, 20);
  }));
  // a handoff is when blends increments: look at the previous element's time then
  const offsets = [];
  for (let i = 1; i < res.length; i++) {
    if (res[i].blends > res[i - 1].blends) {
      const prev = res[i - 1], oldIdx = prev.cur, oldT = res[i].els[oldIdx].t;
      const planned = prev.kind === 'intro' ? 3.0 : 4.0;
      offsets.push(+(oldT - planned).toFixed(3));
    }
  }
  const silent = res.filter(r => r.els.every(e => e.paused)).length;
  const st = await page.evaluate(() => window.__cabin.state());
  await browser.close();
  return { engine: st.engine, handoffs: offsets.length, offsets, silentSamples: silent, errors };
}
(async () => { console.log(JSON.stringify(await run('media'))); console.log(JSON.stringify(await run('webaudio'))); })();
