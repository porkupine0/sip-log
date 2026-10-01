const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const OUT = p => path.join(__dirname, 'shots', p);
const FILE = 'file://' + path.join(__dirname, '..', 'dist', 'Sip-Log.html');
fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
(async () => {
  const scheme = process.argv[2] || 'light';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: scheme });
  // capture clipboard writes so copy buttons can be checked
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { window.__copied = t; return Promise.resolve(); } } }); });
  const page = await ctx.newPage();
  const errors = [], checks = {};
  const overflowAt = {};
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const overflow = async tag => { overflowAt[tag] = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1); };
  const tiles = () => page.$$eval('.people .tile', els => els.length);
  const tileNames = () => page.$$eval('.people .namebtn .nm', els => els.map(e => e.textContent));
  await page.goto(FILE);
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT(`01-first-run-${scheme}.png`), fullPage: true });

  // setup: boarded 3 days ago, four people
  const start = await page.evaluate(() => { const d = new Date(Date.now() - 4 * 3600e3); d.setDate(d.getDate() - 3); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  await page.fill('#su-start', start);
  await page.fill('#su-p0', 'Sam');
  await page.fill('#su-p1', 'Alex');
  await page.fill('#su-p2', 'Jordan');
  await page.fill('#su-p3', 'Riley');
  await page.click('[data-act="setup-save"]');
  await page.waitForTimeout(200);
  checks.afterSetup = { tiles: await tiles(), names: await tileNames(), compact: await page.$$eval('.people.compact', e => e.length) };

  // quick logging
  await page.click('[data-act="add-drink"][data-p="0"]');
  await page.click('[data-act="add-water"][data-p="1"]');
  await page.click('[data-act="add-water"][data-p="0"]');
  await page.click('[data-act="start-drink"][data-p="1"]');
  await page.click('[data-act="add-water"][data-p="3"]');
  await page.waitForTimeout(150);
  await page.screenshot({ path: OUT(`02-four-people-${scheme}.png`) });
  await overflow('log');

  // round of drinks for three of the four
  await page.click('[data-act="round"][data-kind="drink"]');
  await page.waitForTimeout(200);
  await page.click('[data-rd="p"][data-v="3"]');
  await page.fill('#rd-name', 'Coconut Patrón Margarita');
  await page.screenshot({ path: OUT(`03-round-${scheme}.png`) });
  await page.click('[data-rd="go"]');
  await page.waitForTimeout(200);
  checks.round = { toast: await page.textContent('#toast span'), drinks: await page.$$eval('.people .fig.drink .v', els => els.map(e => e.textContent)) };

  // water round for everyone (remembers last pick, so add Riley back)
  await page.click('[data-act="round"][data-kind="water"]');
  await page.waitForTimeout(150);
  const rileyPressed = await page.getAttribute('[data-rd="p"][data-v="3"]', 'aria-pressed');
  if (rileyPressed !== 'true') await page.click('[data-rd="p"][data-v="3"]');
  await page.click('[data-rd="go"]');
  await page.waitForTimeout(150);
  checks.waterRound = await page.$$eval('.people .fig.water .v', els => els.map(e => e.textContent));

  // rename Jordan and give an emoji
  await page.click('.namebtn[data-p="2"]');
  await page.waitForTimeout(200);
  await page.fill('#pe-name', 'Jo');
  await page.click('[data-pe="emoji"][data-v="🐬"]');
  await page.screenshot({ path: OUT(`04-person-${scheme}.png`) });
  checks.nameKeptAfterEmoji = await page.inputValue('#pe-name');
  await page.click('[data-pe="save"]');
  await page.waitForTimeout(150);
  checks.renamed = await tileNames();

  // timeline filter for one person, then edit an entry
  await page.click('[data-act="tlwho"][data-v="0"]');
  await page.waitForTimeout(100);
  checks.tlFiltered = await page.$$eval('.tl .tl-item', els => els.length);
  await page.locator('.tl-item').filter({ hasText: 'Drink' }).last().click();
  await page.waitForTimeout(250);
  await page.fill('#ed-name', 'pina col');
  await page.waitForTimeout(150);
  await page.screenshot({ path: OUT(`05-editor-sugg-${scheme}.png`) });
  await page.click('#ed-sugg button');
  await page.click('[data-ed="where"][data-v="Pool deck"]');
  await page.click('[data-ed="fav"]');
  await page.click('[data-ed="save"]');
  await page.waitForTimeout(200);
  await page.click('[data-act="tlwho"][data-v="-1"]');

  // finish Alex's timed drink, log "again" for Sam
  await page.click('[data-act="finish"]');
  await page.waitForTimeout(100);
  await page.click('[data-act="again"][data-p="0"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT(`06-day-${scheme}.png`), fullPage: true });

  // past day
  await page.click('[data-act="prevday"]');
  await page.click('[data-act="add-past"][data-p="1"]');
  await page.waitForTimeout(200);
  await page.fill('#ed-name', 'Aperol Spritz');
  await page.click('[data-ed="save"]');
  await page.waitForTimeout(200);

  // seed three days of history for four people
  await page.evaluate(() => {
    const E = JSON.parse(localStorage.getItem('siplog.entries'));
    const S = JSON.parse(localStorage.getItem('siplog.settings'));
    S.ports = ['Fort Lauderdale', 'Sea day', 'Nassau', 'Sea day'];
    localStorage.setItem('siplog.settings', JSON.stringify(S));
    const [y, m, d] = S.start.split('-').map(Number);
    const names = ['Piña Colada', 'Painkiller', 'Mojito', 'Espresso Martini', 'Aperol Spritz', 'Paloma', ''];
    const spots = ['Pool deck', 'Martini Bar', 'Sunset Bar', 'Show'];
    let id = 0;
    for (let day = 0; day < 3; day++) for (let p = 0; p < 4; p++) {
      const n = 2 + ((day + p) % 4);
      for (let i = 0; i < n; i++) {
        const t = new Date(y, m - 1, d + day, 12 + i * 2 + (p === 3 ? 3 : 0), 10 * i + p).getTime();
        E.push({ id: 'seed' + (id++), kind: 'drink', p, t, start: i % 2 ? t - (12 + p * 9) * 60000 : null, open: false, name: names[(i + p + day) % names.length], std: 1.5, where: spots[(i + p) % spots.length], fav: i === 1, note: '' });
      }
      for (let i = 0; i < n + (p % 2 ? 1 : -1) + (p === 1 ? 2 : 0); i++) E.push({ id: 'seed' + (id++), kind: 'water', p, t: new Date(y, m - 1, d + day, 9 + i * 2, 30).getTime(), unit: 'bottle', ml: 500, note: '' });
    }
    E.push({ id: 'brunch', kind: 'drink', p: 2, t: new Date(y, m - 1, d + 1, 10, 25).getTime(), start: null, open: false, name: 'Mimosa', std: 1, where: 'Dinner', fav: false, note: '' });
    localStorage.setItem('siplog.entries', JSON.stringify(E));
  });
  await page.reload();
  await page.waitForTimeout(250);
  await page.click('.tabs [data-go="trip"]');
  await page.waitForTimeout(250);
  await page.screenshot({ path: OUT(`07-trip-${scheme}.png`), fullPage: true });
  await overflow('trip');
  const bar = await page.$('#tripchart [data-i="1"]');
  await bar.hover();
  await page.waitForTimeout(100);
  await page.screenshot({ path: OUT(`08-trip-tip-${scheme}.png`), clip: { x: 0, y: 160, width: 390, height: 440 } });

  // fun stats
  await page.click('.tabs [data-go="stats"]');
  await page.waitForTimeout(250);
  await page.screenshot({ path: OUT(`09-stats-${scheme}.png`), fullPage: true });
  await overflow('stats');
  checks.awards = await page.$$eval('.award', els => els.map(e => e.querySelector('.aw-t').textContent + ' → ' + e.querySelector('.aw-w').textContent + ' (' + e.querySelector('.aw-v').textContent + ')'));
  checks.facts = await page.$$eval('.fact', els => els.map(e => e.querySelector('.k').textContent + ': ' + e.querySelector('.v').textContent));
  checks.funfact = await page.$eval('.funfact', e => e.textContent).catch(() => null);
  const hb = await page.$('#hourchart [data-i]');
  checks.hourBars = await page.$$eval('#hourchart path.mk', els => els.filter(e => e.getAttribute('d')).length);
  await page.click('[data-act="copy-stats"]');
  await page.waitForTimeout(100);
  checks.statsText = await page.evaluate(() => window.__copied);
  await page.click('[data-act="scope"][data-v="today"]');
  await page.waitForTimeout(150);
  await page.screenshot({ path: OUT(`10-stats-today-${scheme}.png`), fullPage: true });
  checks.todayAwards = await page.$$eval('.award .aw-t', els => els.map(e => e.textContent));

  // glance + day picker with four rows
  await page.click('.tabs [data-go="log"]');
  await page.click('[data-act="prevday"]');
  await page.waitForTimeout(150);
  await (await page.$('#glance')).screenshot({ path: OUT(`11-glance-${scheme}.png`) });
  await page.click('[data-act="days"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT(`12-daypicker-${scheme}.png`) });
  await page.click('.daylist button');

  // settings: hide Riley, then bring back; add a fifth person
  await page.click('.tabs [data-go="settings"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT(`13-settings-${scheme}.png`), fullPage: true });
  await overflow('settings');
  await page.click('.prow [data-act="person-edit"][data-p="3"]');
  await page.waitForTimeout(150);
  await page.click('[data-pe="hide"]');
  await page.click('[data-pe="hide"]');
  await page.waitForTimeout(150);
  checks.hiddenRow = await page.$$eval('.prow.off .pname', els => els.map(e => e.textContent));
  await page.click('.tabs [data-go="log"]');
  await page.waitForTimeout(150);
  checks.tilesAfterHide = await tiles();
  checks.glanceRowsAfterHide = await page.$$eval('#glance .axis-l', els => els.map(e => e.textContent));
  await page.click('.tabs [data-go="settings"]');
  await page.click('[data-act="person-show"][data-p="3"]');
  await page.click('.tabs [data-go="log"]');
  await page.click('[data-act="person-new"]');
  await page.waitForTimeout(150);
  await page.fill('#pe-name', 'Casey');
  await page.click('[data-pe="emoji"][data-v="🍍"]');
  await page.click('[data-pe="save"]');
  await page.waitForTimeout(150);
  checks.afterAdd = { tiles: await tiles(), names: await tileNames() };
  await page.screenshot({ path: OUT(`14-five-people-${scheme}.png`) });
  await overflow('log5');

  // merge a backup from another phone: Alex matches by name, Morgan is new
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('siplog.entries')).length);
  const code = JSON.stringify({ app: 'siplog', v: 2, settings: { people: [{ name: 'Morgan' }, { name: 'alex' }] }, entries: [
    { id: 'm1', kind: 'drink', p: 0, t: Date.now() - 3600e3, name: 'Mai Tai', std: 1.5, open: false },
    { id: 'm2', kind: 'water', p: 1, t: Date.now() - 1800e3, unit: 'bottle', ml: 500 },
    { id: 'seed0', kind: 'drink', p: 1, t: Date.now() - 900e3, name: 'Dup', std: 1 }
  ] });
  await page.click('.tabs [data-go="settings"]');
  await page.fill('#restore', code);
  await page.click('[data-act="merge"]');
  await page.waitForTimeout(150);
  checks.merge = await page.evaluate(() => ({ people: JSON.parse(localStorage.getItem('siplog.settings')).people.map(p => p.name), entries: JSON.parse(localStorage.getItem('siplog.entries')).length, alexWater: JSON.parse(localStorage.getItem('siplog.entries')).filter(e => e.id === 'm2')[0].p }));
  checks.merge.added = checks.merge.entries - before;
  checks.mergeToast = await page.textContent('#toast span');
  checks.stored = await page.evaluate(() => JSON.parse(localStorage.getItem('siplog.entries')).length);
  console.log(JSON.stringify({ scheme, overflowAt, checks, errors }, null, 1));
  await browser.close();
})();
