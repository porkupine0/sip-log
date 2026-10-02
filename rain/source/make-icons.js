// Renders src/icon.svg to PNG icons with the preinstalled Chromium.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const svg = fs.readFileSync(__dirname + '/src/icon.svg', 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  fs.mkdirSync(__dirname + '/dist/web', { recursive: true });
  for (const [name, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180], ['favicon-32.png', 32]]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: __dirname + '/dist/web/' + name, clip: { x: 0, y: 0, width: size, height: size } });
  }
  await browser.close();
  console.log('icons done');
})();
