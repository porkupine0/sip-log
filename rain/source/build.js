// Builds Cabin Rain:
//   dist/artifact.html     page body for the claude.ai Artifact
//   dist/Cabin-Rain.html   one self-contained file that runs offline in any browser
//   dist/web/              the same app plus manifest + service worker, for hosting as an installable app
const fs = require('fs');
const path = require('path');
const R = p => fs.readFileSync(path.join(__dirname, p), 'utf8');
const B64 = p => fs.readFileSync(path.join(__dirname, p)).toString('base64');

const fonts = `@font-face{font-family:"Marcellus";font-style:normal;font-weight:400;font-display:swap;src:url(data:font/woff2;base64,${B64('fonts/Marcellus.woff2')}) format("woff2")}
@font-face{font-family:"Josefin Sans";font-style:normal;font-weight:600;font-display:swap;src:url(data:font/woff2;base64,${B64('fonts/Josefin-Sans-wght-600.woff2')}) format("woff2")}`;
const css = R('src/style.css');
const body = R('src/body.html');
const synth = R('src/synth.js');
const app = R('src/app.js');
for (const [n, s] of [['synth', synth], ['app', app]]) if (s.includes('</script')) throw new Error(n + ' contains </script');
const scripts = (icon) => `<script>window.CABIN_URL = ${JSON.stringify(process.env.SITE_URL || '')}; window.CABIN_ICON = ${JSON.stringify(icon || '')};</script>
<script>\n${synth}\n</script>
<script>\n${app}\n</script>`;
const title = 'Cabin Rain';
const desc = 'Endless rain for sleeping, made on your phone. No loop, no seam, works offline and with the screen locked.';
const reset = ':root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}[hidden]{display:none!important}img{max-width:100%}';
const artifact = `<title>${title}</title>\n<style>\n${fonts}\n${css}\n</style>\n${body}\n${scripts('')}\n`;
const dist = path.join(__dirname, 'dist');
fs.mkdirSync(path.join(dist, 'web'), { recursive: true });
const iconB64 = n => fs.existsSync(path.join(dist, 'web', n)) ? 'data:image/png;base64,' + fs.readFileSync(path.join(dist, 'web', n)).toString('base64') : '';
function fullDoc({ web, icons, artwork }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta name="theme-color" content="#08121b">
<meta name="color-scheme" content="dark">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Cabin Rain">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
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
${scripts(artwork)}
</body>
</html>
`;
}
fs.writeFileSync(path.join(dist, 'artifact.html'), artifact);
fs.writeFileSync(path.join(dist, 'Cabin-Rain.html'), fullDoc({ web: false, icons: { favicon: iconB64('favicon-32.png'), apple: iconB64('apple-touch-icon.png') }, artwork: '' }));
fs.writeFileSync(path.join(dist, 'web', 'index.html'), fullDoc({ web: true, icons: { favicon: 'favicon-32.png', apple: 'apple-touch-icon.png' }, artwork: 'icon-512.png' }));
const version = require('crypto').createHash('sha1').update(artifact).digest('hex').slice(0, 10);
fs.writeFileSync(path.join(dist, 'web', 'sw.js'), `// Cabin Rain offline cache. Serves the app from cache, refreshes it in the background when online.
const CACHE = 'cabinrain-${version}';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './favicon-32.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('cabinrain-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
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
    const net = fetch(req).then(res => { if (res && res.ok) cache.put(key, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || new Response('Offline and not cached yet. Open Cabin Rain once while online.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }));
});
`);
fs.writeFileSync(path.join(dist, 'web', 'manifest.webmanifest'), JSON.stringify({
  name: 'Cabin Rain', short_name: 'Cabin Rain', description: desc, start_url: './', scope: './', display: 'standalone', orientation: 'portrait',
  background_color: '#08121b', theme_color: '#08121b',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ]
}, null, 2));
const kb = f => (fs.statSync(path.join(dist, f)).size / 1024).toFixed(0) + ' KB';
console.log(`built · artifact ${kb('artifact.html')} · standalone ${kb('Cabin-Rain.html')} · sw ${version}`);
