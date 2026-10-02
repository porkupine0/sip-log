// Two drinks at once: pick two in the picker, both show in Sipping now, finish them separately.
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
  const rows = () => page.$$eval('.siprow .sip-txt', r => r.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  await page.goto('file://' + path.join(__dirname, '..', 'dist', 'Sip-Log.html'));
  await page.waitForTimeout(300);
  await page.fill('#su-p0', 'Sam'); await page.fill('#su-p1', 'Alex');
  await page.click('[data-act="setup-save"]');
  await page.waitForTimeout(150);

  // Sam orders two different drinks at once
  await page.click('[data-act="start-drink"][data-p="0"]');
  await page.click('[data-pk="count"][data-v="2"]');
  await page.click('.pick[data-name="Mojito"]');
  await page.waitForTimeout(100);
  checks.hint = await page.textContent('.pk-hint');
  checks.badge = await page.$$eval('.pk-badge', b => b.map(x => x.closest('.pick').dataset.name || 'plain'));
  await page.screenshot({ path: OUT(`t1-picker-two-${scheme}.png`) });
  await page.click('.pick[data-name="Beer"]');
  await page.waitForTimeout(150);
  checks.toast = await page.textContent('#toast span');
  checks.rowsAfterTwo = await rows();
  // Alex: one drink, then a second one later with the normal flow
  await page.click('[data-act="start-drink"][data-p="1"]');
  await page.click('.pick[data-name="Piña Colada"]');
  await page.click('[data-act="start-drink"][data-p="1"]');
  await page.click('[data-pk="plain"]');
  await page.click('[data-act="start-water"][data-p="1"]');
  await page.waitForTimeout(150);
  checks.rowsAll = await rows();
  checks.tiles = await page.$$eval('.people .tile', t => t.map(x => x.querySelector('.fig.drink .v').firstChild.textContent + ' | ' + x.querySelector('.lastline').textContent.trim()));
  await page.screenshot({ path: OUT(`t2-sipping-now-${scheme}.png`), fullPage: true });
  // finish Sam's beer (half) and mojito (all) separately
  const E1 = await entries();
  const beer = E1.find(e => e.name === 'Beer'), mojito = E1.find(e => e.name === 'Mojito');
  await page.click(`[data-act="finish"][data-id="${beer.id}"][data-part="0.5"]`);
  await page.waitForTimeout(100);
  checks.afterBeer = { rows: await rows(), beer: (await entries()).find(e => e.id === beer.id) };
  await page.click(`[data-act="finish"][data-id="${mojito.id}"][data-part="1"]`);
  await page.waitForTimeout(100);
  checks.afterMojito = await rows();
  checks.samTile = await page.$eval('.people .tile .fig.drink .v', v => v.firstChild.textContent);
  // from + Drink, Two at once switches to Just ordered so both show under Sipping now
  await page.click('[data-act="add-drink"][data-p="0"]');
  await page.click('[data-pk="count"][data-v="2"]');
  checks.twoFromAddDrink = { mode: await page.getAttribute('[data-pk="mode"][aria-pressed="true"]', 'data-v'), hint: await page.textContent('.pk-hint') };
  await page.click('.pick[data-name="Aperol Spritz"]');
  await page.click('.pick[data-name="Espresso Martini"]');
  await page.waitForTimeout(100);
  checks.bothSipping = await rows();
  checks.samLine = await page.$eval('.people .tile .lastline', l => l.textContent.trim());
  // finish them one at a time
  const E2 = await entries();
  await page.click(`[data-act="finish"][data-id="${E2.find(e => e.name === 'Espresso Martini').id}"][data-part="1"]`);
  await page.waitForTimeout(100);
  checks.oneLeft = await rows();
  // two of the same, finished (switching back to Finished it): both get logged with the chosen amount
  await page.click('[data-act="add-drink"][data-p="0"]');
  await page.click('[data-pk="count"][data-v="2"]');
  await page.click('[data-pk="mode"][data-v="done"]');
  await page.click('[data-pk="part"][data-v="0.5"]');
  await page.click('.pick[data-name="Mojito"]');
  await page.click('.pick[data-name="Mojito"]');
  await page.waitForTimeout(100);
  checks.sameTwice = { toast: await page.textContent('#toast span'), last2: (await entries()).slice(-2).map(e => [e.name, e.part, e.open]) };
  // undo removes both
  await page.click('#toast [data-ti]:last-of-type');
  await page.waitForTimeout(100);
  checks.afterUndo = (await entries()).filter(e => e.name === 'Mojito').length;
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  console.log(JSON.stringify({ scheme, checks, overflow, errors }, null, 1));
  await browser.close();
})();
