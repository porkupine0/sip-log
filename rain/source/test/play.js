// Plays the standalone file in fast mode (seconds instead of minutes) and checks the handoffs, a mix change and the sleep timer.
const { chromium } = require('playwright');
const path = require('path');
const OUT = p => path.join(__dirname, 'shots', p);
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [], log = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  await page.goto('file://' + path.join(__dirname, '..', 'dist', 'Cabin-Rain.html') + '?fast');
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT('01-idle.png'), fullPage: true });
  const st = () => page.evaluate(() => window.__cabin.state());
  log.push(['boot', await st()]);
  await page.click('#play');
  await page.waitForTimeout(400);
  log.push(['after tap', await st()]);
  // let several handoffs happen: intro hands off at 3 s, then every 4 s
  const samples = [];
  for (let i = 0; i < 16; i++) { await page.waitForTimeout(1000); samples.push(await st()); }
  await page.screenshot({ path: OUT('02-playing.png') });
  log.push(['after 16 s', samples[samples.length - 1]]);
  // both elements never silent at once: at every sample at least one is playing
  const gaps = samples.filter(s => s.els.every(e => e.paused)).length;
  // change the mix while playing
  await page.click('[data-act="preset"][data-id="storm"]');
  await page.waitForTimeout(1500);
  log.push(['after preset change', await st()]);
  // sleep timer: 20 "minutes" = 20 s in fast mode; the outro should fade and stop it
  await page.click('[data-act="timer"][data-m="20"]');
  const t0 = Date.now();
  let stoppedAfter = null;
  for (let i = 0; i < 40; i++) { await page.waitForTimeout(1000); const s = await st(); if (!s.playing) { stoppedAfter = Math.round((Date.now() - t0) / 1000); break; } }
  log.push(['after timer', await st(), 'stopped after s', stoppedAfter, await page.textContent('#now')]);
  await page.screenshot({ path: OUT('03-stopped.png') });
  // play again and pause by tap
  await page.click('#play');
  await page.waitForTimeout(1200);
  const again = await st();
  await page.click('#play');
  await page.waitForTimeout(300);
  const paused = await st();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  console.log(JSON.stringify({ log, gaps, blends: samples.map(s => s.blends), again: { playing: again.playing, engine: again.engine }, paused: { playing: paused.playing, els: paused.els }, overflow, errors }, null, 1));
  await browser.close();
})();
