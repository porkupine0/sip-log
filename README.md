# Sip Log

An offline drink and water counter for a cruise. One tap logs a drink or a water with the time. Add the drink's name if you like, record when it was finished (or start a timer when you order), and look back at any day of the trip.

- **Up to 6 people** on one phone. Tap a name on its counter to rename it or add an emoji. Use **Add a person** to add more. Removing someone hides their counter but keeps their history.
- **Round of drinks / Water round** logs the same thing for everyone at the table with one tap.
- **Fun stats** tab: awards (Hydration Hero, Night Owl, Early Bird, Slow Sipper, Explorer, Creature of Habit, Goal Getter, and a "Regular" award for your most-visited bar), a ship's tally (rounds together, busiest hour, busiest day, group favorite, sea days vs. port days), drinks by hour, and a side-by-side table. **Copy for the group chat** shares the awards as text.

**Open it:** https://porkupine0.github.io/sip-log/

## Put it on your phone (works with no internet)

- **iPhone:** open the link in Safari, tap Share, then **Add to Home Screen**. Open it once while online; after that it works in airplane mode. Always use the Home Screen icon: it keeps its own saved log, separate from Safari.
- **Android:** open the link in Chrome, tap ⋮, then **Install app**.
- **Single file:** `Sip-Log.html` is the whole app in one file and runs offline in any desktop or Android browser.

The log is saved on the phone. Settings → Backup and export copies a backup code (to move or merge logs between phones; people are matched by name) or a spreadsheet (CSV).

## Editing

Source is in `source/`. Rebuild with:

```
cd source
SITE_URL="https://porkupine0.github.io/sip-log/" node build.js
cp dist/web/* .. && cp dist/Sip-Log.html ..
git push origin main main:gh-pages
```

Drink-name suggestions come from the Sip & Sail catalog (`catalog.txt`). GitHub Pages serves the site from the `gh-pages` branch.
