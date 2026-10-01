// Old installs stored people as plain strings. Make sure they load, keep their entries and show both tiles.
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.join(__dirname, '..', 'dist', 'Sip-Log.html');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(FILE);
  await page.evaluate(() => {
    const now = Date.now();
    const d = new Date(now - 4 * 3600e3);
    const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    localStorage.setItem('siplog.settings', JSON.stringify({ people: ['Erin', 'Partner'], start, days: 10, ports: [], cutoff: 4, waterUnit: 'bottle', waterGoal: 5, limit: '', pkg: '', price: 16, theme: 'auto', setupDone: true, lastBackup: 0 }));
    localStorage.setItem('siplog.entries', JSON.stringify([
      { id: 'a', kind: 'drink', p: 0, t: now - 60000, name: 'Mojito', std: 1.5, open: false },
      { id: 'b', kind: 'water', p: 1, t: now - 30000, unit: 'bottle', ml: 500 }
    ]));
  });
  await page.reload();
  await page.waitForTimeout(250);
  const names = await page.$$eval('.people .namebtn .nm', els => els.map(e => e.textContent));
  const drinks = await page.$$eval('.people .fig.drink .v', els => els.map(e => e.textContent));
  const waters = await page.$$eval('.people .fig.water .v', els => els.map(e => e.textContent));
  const compact = await page.$$eval('.people.compact', e => e.length);
  const roundbar = await page.$$eval('.roundbar', e => e.length);
  const people = await page.evaluate(() => JSON.parse(localStorage.getItem('siplog.settings')).people);
  await page.screenshot({ path: path.join(__dirname, 'shots', 'migrate.png') });
  console.log(JSON.stringify({ names, drinks, waters, compact, roundbar, people, errors }));
  await browser.close();
})();
