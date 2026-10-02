// All three apps on one origin: each keeps its own offline cache, and each opens offline.
const { chromium } = require('playwright');
const ROOT = 'http://localhost:8093';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const ready = () => page.evaluate(() => navigator.serviceWorker.ready.then(r => r.scope));
  await page.goto(ROOT + '/sip-log/'); const s1 = await ready(); await page.waitForTimeout(500);
  await page.goto(ROOT + '/sip-log/rain/');
  const firstStatus = await page.textContent('#status span');
  await page.waitForFunction(() => document.querySelector('#status span').textContent === 'Offline ready', null, { timeout: 15000 });
  const s2 = await ready(); await page.waitForTimeout(500);
  await page.goto(ROOT + '/sip-and-sail/'); const s3 = await ready(); await page.waitForTimeout(1500);
  const caches = await page.evaluate(() => caches.keys());
  await ctx.setOffline(true);
  const out = {};
  for (const p of ['/sip-log/rain/', '/sip-log/', '/sip-and-sail/']) {
    try { await page.goto(ROOT + p); await page.waitForTimeout(600); out[p] = { title: await page.title(), controller: await page.evaluate(() => navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL) }; }
    catch (e) { out[p] = { error: e.message.split('\n')[0] }; }
  }
  await page.goto(ROOT + '/sip-log/rain/');
  await page.waitForTimeout(600);
  await page.click('#play');
  await page.waitForTimeout(1500);
  const st = await page.evaluate(() => window.__cabin.state());
  console.log(JSON.stringify({ scopes: [s1, s2, s3], firstStatus, caches, offline: out, rainPlaysOffline: st.playing && st.els[st.cur].t > 0.5, errors }, null, 1));
  await browser.close();
})();
