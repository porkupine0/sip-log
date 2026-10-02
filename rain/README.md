# Cabin Rain

Endless rain for sleeping, made on your phone. There is no recording and no loop: the app synthesizes stretches of rain about 83 seconds long and blends each new one in over 8 seconds as the last one fades, with a fresh stretch made after every blend. There is no seam to hear and no pattern that comes round again.

**Open it:** https://porkupine0.github.io/sip-log/rain/

- Six weather presets: Soft rain, Steady rain, Downpour, Tent, Rain at sea, Far-off storm (rainfall shown per hour).
- Mixer: rain intensity, distant thunder, wind (Beaufort force), deep rumble (covers engine and hallway noise), drips, tone, and what the rain falls on.
- Sleep timer (20 min to 8 h) that fades out over a minute.
- Keeps playing with the screen locked and the ringer switch on silent; lock-screen controls pause and resume it.

## Put it on your phone (works with no internet)

- **iPhone:** open the link in Safari, tap Share, then **Add to Home Screen**. Open it once while online; after that it works in airplane mode. If the rain stops when you lock the phone, play it from a Safari tab instead.
- **Android:** open the link in Chrome, tap ⋮, then **Install app**.
- **Single file:** `Cabin-Rain.html` is the whole app in one file and runs offline in any desktop or Android browser.

## Editing

Source is in `rain/source/`. Rebuild from there with:

```
cd source
node make-icons.js
SITE_URL="https://porkupine0.github.io/sip-log/rain/" node build.js
cp dist/web/* .. && cp dist/Cabin-Rain.html ..
git push origin main main:gh-pages
```

`src/synth.js` is the rain synthesizer (also runs in Node: `node test/synth-check.js out/` renders the presets as WAV files). GitHub Pages serves the site from the `gh-pages` branch.
