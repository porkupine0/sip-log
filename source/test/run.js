const { chromium } = require('playwright');
const path = require('path');
const OUT = p => path.join(__dirname, 'shots', p);
const FILE = 'file://' + path.join(__dirname, '..', 'dist', 'Sip-Log.html');
(async () => {
  const scheme = process.argv[2] || 'light';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: scheme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(FILE);
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT(`01-first-run-${scheme}.png`) });
  // setup: boarded 3 days ago
  const start = await page.evaluate(() => { const d = new Date(Date.now() - 4 * 3600e3); d.setDate(d.getDate() - 3); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  await page.fill('#su-start', start);
  await page.click('[data-act="setup-save"]');
  await page.waitForTimeout(200);
  // quick logging
  await page.click('[data-act="add-drink"][data-p="0"]');
  await page.click('[data-act="add-water"][data-p="1"]');
  await page.click('[data-act="add-water"][data-p="0"]');
  await page.click('[data-act="start-drink"][data-p="1"]');
  await page.waitForTimeout(150);
  await page.screenshot({ path: OUT(`02-logged-${scheme}.png`) });
  // name the first drink via the timeline
  await page.locator('.tl-item', { has: page.locator('.who-chip', { hasText: 'Me' }) }).filter({ hasText: 'Drink' }).first().click();
  await page.waitForTimeout(250);
  await page.fill('#ed-name', 'coconut pat');
  await page.waitForTimeout(150);
  await page.screenshot({ path: OUT(`03-editor-sugg-${scheme}.png`) });
  await page.click('#ed-sugg button');
  await page.click('[data-ed="where"][data-v="Pool deck"]');
  await page.click('[data-ed="fav"]');
  await page.screenshot({ path: OUT(`04-editor-filled-${scheme}.png`) });
  await page.click('[data-ed="save"]');
  await page.waitForTimeout(200);
  // finish partner's drink and log "again"
  await page.click('[data-act="finish"]');
  await page.click('[data-act="again"][data-p="0"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT(`05-day-${scheme}.png`), fullPage: true });
  // past day: go back one day, add a drink there
  await page.click('[data-act="prevday"]');
  await page.click('[data-act="add-past"][data-p="1"]');
  await page.waitForTimeout(200);
  await page.fill('#ed-name', 'Aperol Spritz');
  await page.click('[data-ed="save"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT(`06-pastday-${scheme}.png`) });
  // seed more history for the trip view
  await page.evaluate(() => {
    const E = JSON.parse(localStorage.getItem('siplog.entries'));
    const S = JSON.parse(localStorage.getItem('siplog.settings'));
    const [y, m, d] = S.start.split('-').map(Number);
    const names = ['Piña Colada', 'Painkiller', 'Mojito', 'Espresso Martini', 'Aperol Spritz', 'Paloma', ''];
    let id = 0;
    for (let day = 0; day < 3; day++) for (let p = 0; p < 2; p++) {
      const n = 2 + ((day + p) % 4);
      for (let i = 0; i < n; i++) E.push({ id: 'seed' + (id++), kind: 'drink', p, t: new Date(y, m - 1, d + day, 13 + i * 2, 10 * i).getTime(), start: null, open: false, name: names[(i + p + day) % names.length], std: 1.5, where: i % 2 ? 'Pool deck' : 'Martini Bar', fav: i === 1, note: '' });
      for (let i = 0; i < n + (p ? 1 : -1); i++) E.push({ id: 'seed' + (id++), kind: 'water', p, t: new Date(y, m - 1, d + day, 10 + i * 2, 30).getTime(), unit: 'bottle', ml: 500, note: '' });
    }
    localStorage.setItem('siplog.entries', JSON.stringify(E));
  });
  await page.reload();
  await page.waitForTimeout(250);
  await page.click('.tabs [data-go="trip"]');
  await page.waitForTimeout(250);
  await page.screenshot({ path: OUT(`07-trip-${scheme}.png`), fullPage: true });
  // tooltip on a bar
  const bar = await page.$('#tripchart [data-i="1"]');
  await bar.hover();
  await page.waitForTimeout(100);
  await page.screenshot({ path: OUT(`08-trip-tip-${scheme}.png`), clip: { x: 0, y: 200, width: 390, height: 420 } });
  await page.click('.tabs [data-go="log"]');
  await page.click('[data-act="prevday"]');
  await page.waitForTimeout(150);
  const glance = await page.$('#glance');
  await glance.screenshot({ path: OUT(`09-glance-${scheme}.png`) });
  await page.click('[data-act="days"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT(`10-daypicker-${scheme}.png`) });
  await page.click('.daylist button');
  await page.click('.tabs [data-go="settings"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT(`11-settings-${scheme}.png`), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('siplog.entries')).length);
  console.log(JSON.stringify({ scheme, overflow, stored, errors }, null, 1));
  await browser.close();
})();
