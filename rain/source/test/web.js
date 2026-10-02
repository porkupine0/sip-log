// Installs the hosted build's service worker, goes offline, reloads and plays.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://localhost:8092/');
  await page.waitForFunction(() => document.querySelector('#status span').textContent === 'Offline ready', null, { timeout: 15000 });
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForTimeout(800);
  const title = await page.title();
  await page.click('#play');
  await page.waitForTimeout(2000);
  const st = await page.evaluate(() => window.__cabin.state());
  const site = await page.textContent('#site-url');
  const ms = await page.evaluate(() => navigator.mediaSession && navigator.mediaSession.metadata ? { title: navigator.mediaSession.metadata.title, artist: navigator.mediaSession.metadata.artist, art: navigator.mediaSession.metadata.artwork.length, state: navigator.mediaSession.playbackState } : null);
  console.log(JSON.stringify({ offlineTitle: title, playing: st.playing, engine: st.engine, t: st.els[st.cur].t, site, mediaSession: ms, errors }));
  await browser.close();
})();
