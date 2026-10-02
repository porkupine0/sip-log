// The drink picker, partial finishes (¼ ½ ¾), in-progress water, and the "log right away" setting.
const { chromium } = require('playwright');
const path = require('path');
const OUT = p => path.join(__dirname, 'shots', p);
(async () => {
  const scheme = process.argv[2] || 'light';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: scheme });
  const page = await ctx.newPage();
  const errors = [], checks = {};
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const entries = () => page.evaluate(() => JSON.parse(localStorage.getItem('siplog.entries') || '[]'));
  const figs = () => page.$$eval('.people .tile', ts => ts.map(t => ({ name: t.querySelector('.nm').textContent, d: t.querySelector('.fig.drink .v').firstChild.textContent, w: t.querySelector('.fig.water .v').firstChild.textContent })));
  await page.goto('file://' + path.join(__dirname, '..', 'dist', 'Sip-Log.html'));
  await page.waitForTimeout(300);
  await page.fill('#su-p0', 'Sam'); await page.fill('#su-p1', 'Alex');
  await page.click('[data-act="setup-save"]');
  await page.waitForTimeout(200);

  // 1. + Drink opens the picker; with no history it offers cruise favorites
  await page.click('[data-act="add-drink"][data-p="0"]');
  await page.waitForTimeout(250);
  checks.firstPicker = { title: await page.textContent('#pk-title'), heads: await page.$$eval('.pk-h', h => h.map(x => x.textContent)), rows: await page.$$eval('.pick', r => r.length) };
  await page.screenshot({ path: OUT(`p1-picker-first-${scheme}.png`) });
  await page.click('.pick[data-name="Piña Colada"]');
  await page.waitForTimeout(200);
  checks.afterPick = { toast: await page.textContent('#toast span'), last: (await entries()).slice(-1)[0] };

  // 2. Started water for Sam, Just ordered (searched) for Alex
  await page.click('[data-act="start-water"][data-p="0"]');
  await page.click('[data-act="start-drink"][data-p="1"]');
  await page.waitForTimeout(200);
  checks.openMode = await page.getAttribute('[data-pk="mode"][data-v="open"]', 'aria-pressed');
  await page.fill('#pk-q', 'coconut pat');
  await page.waitForTimeout(150);
  await page.screenshot({ path: OUT(`p2-picker-search-${scheme}.png`) });
  await page.click('.pick[data-name="Coconut Patrón Margarita"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT(`p3-sipping-${scheme}.png`) });
  checks.sippingBoxes = await page.$$eval('.sipping', b => b.map(x => x.className + ' | ' + x.querySelector('p').textContent.replace(/\s+/g, ' ').trim()));

  // 3. Alex finished only half; Sam finished three quarters of the water
  const alexOpen = (await entries()).find(e => e.p === 1 && e.open);
  await page.click(`[data-act="finish"][data-id="${alexOpen.id}"][data-part="0.5"]`);
  await page.waitForTimeout(150);
  checks.halfToast = await page.textContent('#toast span');
  const samWater = (await entries()).find(e => e.p === 0 && e.kind === 'water' && e.open);
  await page.click(`[data-act="finish"][data-id="${samWater.id}"][data-part="0.75"]`);
  await page.waitForTimeout(150);
  checks.afterFinish = { figs: await figs(), alex: (await entries()).find(e => e.id === alexOpen.id), water: (await entries()).find(e => e.id === samWater.id) };

  // 4. picker again: Sam's own drinks first; log a quarter-finished one
  await page.click('[data-act="add-drink"][data-p="0"]');
  await page.waitForTimeout(200);
  checks.secondPicker = { heads: await page.$$eval('.pk-h', h => h.map(x => x.textContent)), firstRows: await page.$$eval('.pick', r => r.slice(0, 4).map(x => x.textContent.replace(/\s+/g, ' ').trim())) };
  await page.click('[data-pk="part"][data-v="0.25"]');
  await page.screenshot({ path: OUT(`p4-picker-history-${scheme}.png`) });
  await page.click('.pick[data-name="Piña Colada"]');
  await page.waitForTimeout(150);
  checks.quarter = (await entries()).slice(-1)[0];
  checks.figsNow = await figs();

  // 5. round of drinks with a recent name chip, just ordered
  await page.click('[data-act="round"][data-kind="drink"]');
  await page.waitForTimeout(150);
  await page.click('[data-rd="mode"][data-v="open"]');
  await page.click('[data-rd="name"][data-name="Coconut Patrón Margarita"]');
  await page.screenshot({ path: OUT(`p5-round-${scheme}.png`) });
  await page.click('[data-rd="go"]');
  await page.waitForTimeout(150);
  checks.round = { toast: await page.textContent('#toast span'), open: (await entries()).filter(e => e.open && e.name === 'Coconut Patrón Margarita').length };

  // 6. edit the half drink: amount chips, change to three quarters
  await page.locator('.tl-item', { hasText: 'Coconut Patrón Margarita' }).filter({ has: page.locator('.badge-part') }).first().click();
  await page.waitForTimeout(200);
  checks.editorPart = await page.getAttribute('[data-ed="part"][aria-pressed="true"]', 'data-v');
  await page.click('[data-ed="part"][data-v="0.75"]');
  await page.screenshot({ path: OUT(`p6-editor-${scheme}.png`) });
  await page.click('[data-ed="save"]');
  await page.waitForTimeout(150);
  checks.edited = (await entries()).find(e => e.id === alexOpen.id).part;

  // 7. edit a water to "still sipping" from the timeline, then finish it from the counter
  await page.locator('.tl-item', { hasText: 'Water' }).first().click();
  await page.waitForTimeout(150);
  await page.click('[data-ed="open"][data-v="1"]');
  checks.waterEditorFields = await page.$$eval('#ed-body .field > span:first-child', s => s.map(x => x.textContent));
  await page.click('[data-ed="save"]');
  await page.waitForTimeout(150);
  checks.waterReopened = (await entries()).filter(e => e.kind === 'water' && e.open).length;

  // 8. glance chart and timeline with partial marks
  await page.screenshot({ path: OUT(`p7-day-${scheme}.png`), fullPage: true });
  checks.marks = await page.$$eval('#glance .mk', m => m.map(x => x.getAttribute('class').replace('mk ', '')));
  checks.badges = await page.$$eval('.badge-part', b => b.map(x => x.textContent));
  checks.summary = await page.$$eval('.sumtable tbody tr', r => r.map(x => x.textContent.replace(/\s+/g, ' ').trim()));

  // 9. setting: log right away skips the picker
  await page.click('.tabs [data-go="settings"]');
  await page.click('[data-act="ask-drink"][data-v="0"]');
  await page.click('.tabs [data-go="log"]');
  const before = (await entries()).length;
  await page.click('[data-act="add-drink"][data-p="1"]');
  await page.waitForTimeout(150);
  checks.instant = { overlay: await page.$$eval('.overlay', o => o.length), added: (await entries()).length - before };
  await page.click('.tabs [data-go="settings"]');
  await page.click('[data-act="ask-drink"][data-v="1"]');

  // 10. trip, stats and CSV carry the fractions
  await page.click('.tabs [data-go="trip"]');
  await page.waitForTimeout(150);
  checks.tripStats = await page.$$eval('#v-trip .stat .v', v => v.map(x => x.textContent));
  await page.click('.tabs [data-go="stats"]');
  await page.waitForTimeout(150);
  checks.statsFacts = await page.$$eval('.fact', f => f.slice(0, 2).map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const csv = await page.evaluate(() => new Promise(res => { const orig = navigator.clipboard && navigator.clipboard.writeText; try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { res(t); return Promise.resolve(); } } }); } catch (e) { res('no clipboard'); } document.querySelector('.tabs [data-go="settings"]').click(); setTimeout(() => document.querySelector('[data-act="csv"]').click(), 100); }));
  checks.csvHead = csv.split('\n')[0];
  checks.csvPartial = csv.split('\n').filter(l => /"0\.(25|5|75)"/.test(l)).length;
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  console.log(JSON.stringify({ scheme, checks, overflow, errors }, null, 1));
  await browser.close();
})();
