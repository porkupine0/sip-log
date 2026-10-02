// Builds Sip Log:
//   dist/artifact.html   page body for the claude.ai Artifact
//   dist/Sip-Log.html    one self-contained file that runs offline in any browser
//   dist/web/            the same app plus manifest + service worker, for hosting as an installable app
const fs = require('fs');
const path = require('path');
const R = p => fs.readFileSync(path.join(__dirname, p), 'utf8');
const B64 = p => fs.readFileSync(path.join(__dirname, p)).toString('base64');

// Drink names and strengths come from the Sip & Sail catalog (alcoholic drinks only).
function catalog() {
  const root = path.join(__dirname, '..', 'sip-and-sail');
  const saved = path.join(__dirname, 'catalog.txt');
  if (!fs.existsSync(path.join(root, 'src', 'core.js'))) return fs.readFileSync(saved, 'utf8').trim();
  const core = require(path.join(root, 'src', 'core.js'));
  const dd = path.join(root, 'data');
  const files = fs.readdirSync(dd).filter(f => f.endsWith('.txt')).sort();
  const T = f => fs.readFileSync(path.join(dd, f), 'utf8');
  const d = core.parseData(T('00-ingredients.txt'), files.filter(f => !/^(00|90)/.test(f)).map(T).join('\n'), T('90-lists.txt'));
  if (d.errors.length) throw new Error(d.errors.join('\n'));
  const generic = [['Beer', 1], ['Glass of wine', 1], ['Glass of bubbly', 1], ['Shot', 1], ['Double', 2], ['Hard seltzer', 1], ['Cocktail', 1.5], ['Frozen drink', 1.3], ['Spiked coffee', 1], ['Rum and Coke', 1.3], ['Vodka cranberry', 1.3]];
  const rows = generic.map(([n, s]) => `${n}|${s}`).concat(d.recipes.filter(r => !r.zero).map(r => `${r.name}|${(Math.round(r.std * 10) / 10)}`));
  fs.writeFileSync(saved, rows.join('\n') + '\n');
  return rows.join('\n');
}
const cat = catalog();
if (cat.includes('</script')) throw new Error('catalog contains </script');

const fonts = `@font-face{font-family:"Limelight";font-style:normal;font-weight:400;font-display:swap;src:url(data:font/woff2;base64,${B64('fonts/Limelight.woff2')}) format("woff2")}
@font-face{font-family:"Josefin Sans";font-style:normal;font-weight:600;font-display:swap;src:url(data:font/woff2;base64,${B64('fonts/Josefin-Sans-wght-600.woff2')}) format("woff2")}`;
const css = R('src/style.css');
const body = R('src/body.html');
const scripts = `<script type="text/plain" id="catalog-data">\n${cat}\n</script>
<script>window.SIPLOG_URL = ${JSON.stringify(process.env.SITE_URL || '')}; window.SIPLOG_BUILD = ${JSON.stringify(new Date().toISOString())};</script>
<script>\n${R('src/app.js')}\n</script>`;
const title = 'Sip Log';
const desc = 'Offline drink and water counter for your cruise: one-tap logging, finish times, a daily timeline and a day-by-day trip history.';
const reset = ':root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}[hidden]{display:none!important}img{max-width:100%}';
const artifact = `<title>${title}</title>\n<style>\n${fonts}\n${css}\n</style>\n${body}\n${scripts}\n`;
const dist = path.join(__dirname, 'dist');
fs.mkdirSync(path.join(dist, 'web'), { recursive: true });
const iconB64 = n => fs.existsSync(path.join(dist, 'web', n)) ? 'data:image/png;base64,' + fs.readFileSync(path.join(dist, 'web', n)).toString('base64') : '';
function fullDoc({ web, icons }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta name="theme-color" content="#0f2d44">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Sip Log">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="icon" type="image/png" href="${icons.favicon}">
<link rel="apple-touch-icon" href="${icons.apple}">
${web ? '<link rel="manifest" href="manifest.webmanifest">\n' : ''}<style>
${reset}
${fonts}
${css}
</style>
</head>
<body>
${body}
${scripts}
</body>
</html>
`;
}
fs.writeFileSync(path.join(dist, 'artifact.html'), artifact);
fs.writeFileSync(path.join(dist, 'Sip-Log.html'), fullDoc({ web: false, icons: { favicon: iconB64('favicon-32.png'), apple: iconB64('apple-touch-icon.png') } }));
fs.writeFileSync(path.join(dist, 'web', 'index.html'), fullDoc({ web: true, icons: { favicon: 'favicon-32.png', apple: 'apple-touch-icon.png' } }));
const version = require('crypto').createHash('sha1').update(artifact).digest('hex').slice(0, 10);
fs.writeFileSync(path.join(dist, 'web', 'sw.js'), `// Sip Log offline cache. Serves the app from cache, refreshes it in the background when online.
const CACHE = 'siplog-${version}';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './favicon-32.png'];
self.addEventListener('install', e => {
  // cache: 'reload' skips the browser's HTTP cache, so a new version never installs old files
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(a => new Request(a, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('siplog-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const scope = new URL(self.registration.scope).pathname;
  const isApp = req.mode === 'navigate' && (url.pathname === scope || url.pathname === scope + 'index.html');
  const isAsset = ASSETS.some(a => new URL(a, self.registration.scope).pathname === url.pathname);
  if (!isApp && !isAsset) return;
  const key = isApp ? './index.html' : req;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(key, { ignoreSearch: true });
    const net = fetch(url.href, { cache: 'no-cache' }).then(res => { if (res && res.ok) cache.put(key, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || new Response('Offline and not cached yet. Open Sip Log once while online.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }));
});
`);
fs.writeFileSync(path.join(dist, 'web', 'manifest.webmanifest'), JSON.stringify({
  name: 'Sip Log', short_name: 'Sip Log', description: desc, start_url: './', scope: './', display: 'standalone', orientation: 'portrait',
  background_color: '#07131c', theme_color: '#0f2d44',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ]
}, null, 2));
const kb = f => (fs.statSync(path.join(dist, f)).size / 1024).toFixed(0) + ' KB';
console.log(`built · ${cat.split('\n').length} drink names · artifact ${kb('artifact.html')} · standalone ${kb('Sip-Log.html')} · sw ${version}`);
