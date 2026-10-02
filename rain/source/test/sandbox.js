// Runs the artifact build inside a sandboxed iframe (like the claude.ai viewer) and plays it.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const art = fs.readFileSync(path.join(__dirname, '..', 'dist', 'artifact.html'), 'utf8');
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui;background:#fafafa}[hidden]{display:none!important}</style></head><body>${art}</body></html>`;
  const outer = `<!doctype html><html><body style="margin:0"><iframe id="f" sandbox="allow-scripts" style="border:0;width:390px;height:844px"></iframe><script>document.getElementById("f").srcdoc = ${JSON.stringify(doc).replace(/<\//g, '<\\/')};</script></body></html>`;
  fs.writeFileSync(path.join(__dirname, 'frame.html'), outer);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.join(__dirname, 'frame.html'));
  await page.waitForTimeout(1200);
  const f = page.frames().find(x => x !== page.mainFrame());
  const before = await f.evaluate(() => window.__cabin.state());
  await f.click('#play');
  await page.waitForTimeout(2500);
  const after = await f.evaluate(() => window.__cabin.state());
  await page.screenshot({ path: path.join(__dirname, 'shots', 'sandbox.png') });
  console.log(JSON.stringify({ before: { engine: before.engine, worker: before.worker }, after: { playing: after.playing, engine: after.engine, mediaProven: after.mediaProven, els: after.els }, errors }, null, 1));
  await browser.close();
})();
