// A newer version reaches an open app by itself: build A is served, the app is opened, build B replaces it,
// "Check for an update" runs, and the page reloads into B with a toast.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const SITE = path.join(require('os').tmpdir(), 'siplog-update-test');
const copy = () => { fs.rmSync(SITE, { recursive: true, force: true }); fs.mkdirSync(SITE, { recursive: true }); for (const f of fs.readdirSync(path.join(ROOT, 'dist', 'web'))) fs.copyFileSync(path.join(ROOT, 'dist', 'web', f), path.join(SITE, f)); };
const buildStamp = () => (fs.readFileSync(path.join(ROOT, 'dist', 'web', 'index.html'), 'utf8').match(/SIPLOG_BUILD = "([^"]+)"/) || [])[1];
(async () => {
  execSync('node build.js', { cwd: ROOT, env: Object.assign({}, process.env, { SITE_URL: 'http://localhost:8094/' }) });
  copy();
  const A = buildStamp();
  const server = spawn('http-server', [SITE, '-p', '8094', '-c-1', '-s'], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto('http://localhost:8094/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();                                  // now controlled by build A
    await page.waitForTimeout(500);
    const before = await page.evaluate(() => window.SIPLOG_BUILD);
    await new Promise(r => setTimeout(r, 1100));
    execSync('node build.js', { cwd: ROOT, env: Object.assign({}, process.env, { SITE_URL: 'http://localhost:8094/' }) });
    copy();                                               // build B goes live
    const B = buildStamp();
    await page.click('.tabs [data-go="settings"]');
    await page.waitForTimeout(200);
    const label = await page.textContent('[data-act="check-update"] + span');
    await Promise.all([page.waitForEvent('load', { timeout: 15000 }), page.click('[data-act="check-update"]')]);
    await page.waitForTimeout(900);
    const after = await page.evaluate(() => window.SIPLOG_BUILD);
    const toast = await page.textContent('#toast span').catch(() => null);
    console.log(JSON.stringify({ A, B, before, after, updated: after === B && before === A, labelBefore: label, toast, errors }));
  } finally {
    await browser.close();
    server.kill();
  }
})();
