// Edge cases: six-person limit, reusing an empty hidden slot, and setup with blank names after logging.
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.join(__dirname, '..', 'dist', 'Sip-Log.html');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [], out = {};
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(FILE);
  await page.waitForTimeout(200);
  // log for Partner before finishing setup, then blank Partner and fill person 3
  await page.click('[data-act="add-drink"][data-p="1"]');
  await page.fill('#su-p1', '');
  await page.fill('#su-p2', 'Kim');
  await page.click('[data-act="setup-save"]');
  await page.waitForTimeout(150);
  out.setup = await page.evaluate(() => ({ people: JSON.parse(localStorage.getItem('siplog.settings')).people.map(p => p.name + (p.hidden ? ' (hidden)' : '')), entryOwner: JSON.parse(localStorage.getItem('siplog.entries'))[0].p }));
  out.tilesAfterSetup = await page.$$eval('.people .namebtn .nm', els => els.map(e => e.textContent));
  out.timelineWho = await page.$$eval('.tl .who-chip', els => els.map(e => e.textContent));
  // fill up to six people
  for (const n of ['Lee', 'Max', 'Ana', 'Bo']) {
    if (!(await page.$('[data-act="person-new"]'))) { out.stoppedAt = n; break; }
    await page.click('[data-act="person-new"]');
    await page.fill('#pe-name', n);
    await page.click('[data-pe="save"]');
    await page.waitForTimeout(80);
  }
  out.full = { people: await page.evaluate(() => JSON.parse(localStorage.getItem('siplog.settings')).people.length), addButton: !!(await page.$('[data-act="person-new"]')) };
  // hide someone with no entries: the slot can be reused
  const lastP = await page.$$eval('.people .namebtn', els => els[els.length - 1].dataset.p);
  await page.click(`.namebtn[data-p="${lastP}"]`);
  await page.click('[data-pe="hide"]');
  await page.click('[data-pe="hide"]');
  await page.waitForTimeout(80);
  out.addAfterHide = !!(await page.$('[data-act="person-new"]'));
  await page.click('[data-act="person-new"]');
  await page.fill('#pe-name', 'Zoe');
  await page.click('[data-pe="save"]');
  await page.waitForTimeout(80);
  out.reused = await page.evaluate(() => JSON.parse(localStorage.getItem('siplog.settings')).people.map(p => p.name + (p.hidden ? ' (hidden)' : '')));
  out.tiles = await page.$$eval('.people .tile', els => els.length);
  // name required
  await page.click('.namebtn[data-p="0"]');
  await page.fill('#pe-name', '');
  await page.click('[data-pe="save"]');
  out.emptyNameBlocked = !!(await page.$('#pe-name'));
  await page.keyboard.press('Escape');
  out.overlayClosed = !(await page.$('.overlay'));
  await page.screenshot({ path: path.join(__dirname, 'shots', 'edge-six.png'), fullPage: true });
  out.overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  console.log(JSON.stringify({ out, errors }, null, 1));
  await browser.close();
})();
