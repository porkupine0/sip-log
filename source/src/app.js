/* Sip Log: drink and water counter with a day-by-day timeline. Runs fully offline. */
(function () {
  'use strict';
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').trim();
  const pad = n => String(n).padStart(2, '0');
  const SITE = window.SIPLOG_URL || '';
  const RECIPES_URL = 'https://porkupine0.github.io/sip-and-sail/';

  // Drink names from the Sip & Sail catalog ("name|standard drinks")
  const CATALOG = ($('#catalog-data') ? $('#catalog-data').textContent : '').split('\n').map(l => l.trim()).filter(Boolean)
    .map(l => { const [name, std] = l.split('|'); return { name, std: +std, n: norm(name) }; });
  const catalogByName = new Map(CATALOG.map(c => [c.n, c]));

  // ---------- storage ----------
  const mem = {};
  const store = {
    get(k, d) {
      try { const v = localStorage.getItem('siplog.' + k); if (v != null) return JSON.parse(v); } catch (e) { /* ignore */ }
      return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : d;
    },
    set(k, v) { mem[k] = v; try { localStorage.setItem('siplog.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };
  const S = Object.assign({
    people: [{ name: 'Me' }, { name: 'Partner' }], start: '', days: 10, ports: [], cutoff: 4,
    waterUnit: 'bottle', waterGoal: 5, limit: '', pkg: '', price: 16,
    theme: 'auto', setupDone: false, lastBackup: 0, askDrink: true
  }, store.get('settings', {}));
  let E = store.get('entries', []);
  if (!Array.isArray(E)) E = [];
  const saveS = () => store.set('settings', S);
  const saveE = () => store.set('entries', E);
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* ignore */ }

  const STRENGTHS = [['Light', 1, 'beer, wine, spritz'], ['Regular', 1.5, 'most cocktails'], ['Strong', 2, 'doubles, Long Islands']];
  const WATER = { glass: ['Glass', 240, '8 oz'], cup: ['Large cup', 355, '12 oz'], bottle: ['Bottle', 500, '16.9 oz'], liter: ['Liter', 1000, '33.8 oz'] };
  const SPOTS = ['Pool deck', 'Martini Bar', 'Sunset Bar', 'Lounge', 'Dinner', 'Show', 'Casino', 'Cabin', 'Ashore', 'Other'];
  const EMOJI = ['🦈', '🐬', '🐙', '🦀', '🐠', '🐢', '🦜', '🌴', '⚓', '🍍', '🥥', '🌞'];
  const MAX_PEOPLE = 6;

  // ---------- people: stable slots, so old entries keep their owner even if someone is hidden ----------
  function normalizePeople() {
    if (!Array.isArray(S.people) || !S.people.length) S.people = [{ name: 'Me' }];
    S.people = S.people.slice(0, MAX_PEOPLE).map(p => typeof p === 'string' ? { name: p, emoji: '', hidden: false } : Object.assign({ name: '', emoji: '', hidden: false }, p));
    if (S.people.every(p => p.hidden)) S.people[0].hidden = false;
  }
  normalizePeople();
  const nameOf = p => (S.people[p] && S.people[p].name) || `Person ${p + 1}`;
  const labelOf = p => ((S.people[p] && S.people[p].emoji) ? S.people[p].emoji + ' ' : '') + nameOf(p);
  const visibleIdx = () => S.people.map((_, i) => i).filter(i => !S.people[i].hidden);
  const freeSlot = () => { const h = S.people.findIndex((x, i) => x.hidden && !E.some(e => (e.p || 0) === i)); return h >= 0 ? h : S.people.length < MAX_PEOPLE ? S.people.length : -1; };
  const canAdd = () => freeSlot() >= 0;
  const shownIn = list => { const v = visibleIdx(); list.forEach(e => { const p = e.p || 0; if (!v.includes(p)) v.push(p); }); return v.sort((a, b) => a - b); };

  // ---------- dates: a cruise day runs from the cutoff hour to the cutoff hour next morning ----------
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = k => { const [y, m, d] = k.split('-').map(Number); return { y, m, d }; };
  const dayKey = ts => ymd(new Date(ts - (+S.cutoff || 0) * 3600e3));
  const curKey = () => dayKey(Date.now());
  const dayIndex = k => { const a = parse(S.start), b = parse(k); return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 864e5); };
  const keyAt = i => { const a = parse(S.start); const d = new Date(Date.UTC(a.y, a.m - 1, a.d + i)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
  const inTrip = k => { const i = dayIndex(k); return i >= 0 && i < (+S.days || 0); };
  const dateLabel = (k, o) => { const { y, m, d } = parse(k); return new Date(y, m - 1, d, 12).toLocaleDateString(undefined, o || { weekday: 'short', month: 'short', day: 'numeric' }); };
  const dayStart = k => { const { y, m, d } = parse(k); return new Date(y, m - 1, d, +S.cutoff || 0, 0, 0, 0).getTime(); };
  const dayName = k => inTrip(k) ? `Day ${dayIndex(k) + 1}` : dateLabel(k, { month: 'short', day: 'numeric' });
  const portOf = k => (inTrip(k) && S.ports[dayIndex(k)]) || '';
  if (!S.start) S.start = curKey();

  // ---------- formatting ----------
  const fmtTime = ts => new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const fmt1 = n => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '');
  function fmtDur(min) { min = Math.max(0, Math.round(min)); if (min < 60) return min + ' min'; const h = Math.floor(min / 60), m = min % 60; return h + ' h' + (m ? ' ' + m + ' min' : ''); }
  function ago(ts) { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'just now' : fmtDur(m) + ' ago'; }
  function volume(ml) { return (ml >= 1000 ? fmt1(ml / 1000) + ' L' : Math.round(ml) + ' ml') + ' · ' + Math.round(ml / 29.5735) + ' oz'; }
  const money = n => '$' + Math.round(n).toLocaleString();
  const toInput = ts => { const d = new Date(ts); return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fromInput = v => { if (!v) return null; const [a, b] = v.split('T'); const { y, m, d } = parse(a); const [hh, mm] = (b || '0:0').split(':').map(Number); return new Date(y, m - 1, d, hh || 0, mm || 0).getTime(); };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const hourLabel = h => { h = ((h % 24) + 24) % 24; return h === 0 ? '12 AM' : h < 12 ? h + ' AM' : h === 12 ? '12 PM' : (h - 12) + ' PM'; };
  const fmtHour = h => { h = +h || 0; return h === 0 ? 'midnight' : h < 12 ? h + ' AM' : h === 12 ? 'noon' : (h - 12) + ' PM'; };
  const joinNames = arr => arr.length < 2 ? arr.join('') : arr.slice(0, -1).join(', ') + ' & ' + arr[arr.length - 1];
  const buzz = () => { try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) { /* ignore */ } };
  // portions: how much of a drink or a water was actually finished
  const PARTS = [[1, 'All'], [0.75, '¾'], [0.5, '½'], [0.25, '¼']];
  const FRAC = { 0.25: '¼', 0.5: '½', 0.75: '¾' };
  const partOf = e => (e && e.part > 0 && e.part < 1 ? e.part : 1);
  const partWord = v => (v >= 1 ? 'all' : FRAC[v] || fmt1(v));
  function fmtQ(n) { // quarter amounts as 2½
    const r = Math.round(n * 4) / 4;
    if (Math.abs(r - n) > 0.01) return fmt1(n);
    const whole = Math.floor(r + 1e-9), f = +(r - whole).toFixed(2);
    return f ? (whole ? String(whole) : '') + FRAC[f] : String(whole);
  }
  const many = (n, one, more) => (n > 0 && n <= 1 ? one : more);
  const POPULAR = ['Coconut Patrón Margarita', 'Piña Colada', 'Classic Margarita', 'Mojito', 'Aperol Spritz', 'Espresso Martini', 'Painkiller', 'Caribbean Rum Punch', 'Beer', 'Glass of wine'];

  // ---------- icons ----------
  const I = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    timer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 1.5M9.5 2.5h5"/></svg>',
    again: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 20v-4.5h4.5"/></svg>',
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    drink: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16c0 5-3.6 8-8 8s-8-3-8-8zM12 13v6.5M8 20h8"/></svg>',
    water: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.8c3.4 4.3 6.5 8 6.5 11.4a6.5 6.5 0 0 1-13 0C5.5 10.8 8.6 7.1 12 2.8z"/></svg>',
    cheers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h7l-.6 5.5a2.9 2.9 0 0 1-5.8 0zM6.5 12.4V19M4 19.5h5M14 4h7l-.6 5.5a2.9 2.9 0 0 1-5.8 0zM17.5 12.4V19M15 19.5h5"/></svg>',
    person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="8" r="3.5"/><path d="M3.5 19.5c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M19 8v6M16 11h6"/></svg>',
    sipw: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3.5c2.4 3 4.3 5.6 4.3 7.9a4.3 4.3 0 0 1-8.6 0c0-2.3 1.9-4.9 4.3-7.9z"/><circle cx="17" cy="16" r="4.5"/><path d="M17 13.8V16l1.4.9"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>'
  };

  // ---------- theme ----------
  const hostTheme = document.documentElement.getAttribute('data-theme');
  function applyTheme() {
    const r = document.documentElement;
    if (S.theme === 'auto') { if (hostTheme) r.setAttribute('data-theme', hostTheme); else r.removeAttribute('data-theme'); }
    else r.setAttribute('data-theme', S.theme);
  }

  // ---------- data helpers ----------
  const forDay = k => E.filter(e => dayKey(e.t) === k);
  const tripEntries = () => E.filter(e => inTrip(dayKey(e.t)));
  const byPerson = (list, p) => list.filter(e => (e.p || 0) === p);
  // drinks and waters are amounts (a half-finished drink counts ½); orders and bottles count glasses
  function stats(list) {
    const drinks = list.filter(e => e.kind === 'drink');
    const waters = list.filter(e => e.kind === 'water');
    const done = drinks.filter(e => !e.open).sort((a, b) => a.t - b.t);
    const first = done[0], last = done[done.length - 1];
    const sum = (arr, f) => arr.reduce((a, e) => a + f(e), 0);
    return {
      drinks: sum(drinks, partOf), orders: drinks.length,
      waters: sum(waters, partOf), bottles: waters.length,
      std: sum(drinks, e => (+e.std || 0) * partOf(e)),
      ml: sum(waters, e => (+e.ml || 0) * partOf(e)),
      first, last,
      open: drinks.filter(e => e.open).sort((a, b) => a.t - b.t),
      openW: waters.filter(e => e.open).sort((a, b) => a.t - b.t),
      pace: done.length >= 2 && last.t - first.t >= 5 * 60000 ? (last.t - first.t) / (done.length - 1) / 60000 : null
    };
  }
  function lastNamed(p) {
    let best = null;
    for (const e of E) if (e.kind === 'drink' && (e.p || 0) === p && e.name && (!best || e.t > best.t)) best = e;
    return best;
  }
  function recentNames() {
    const seen = new Map();
    E.filter(e => e.kind === 'drink' && e.name).sort((a, b) => b.t - a.t).forEach(e => { const n = norm(e.name); if (!seen.has(n)) seen.set(n, e); });
    return [...seen.values()];
  }
  const stdFor = name => { const c = name && catalogByName.get(norm(name)); return c ? c.std : null; };
  // every drink name logged so far: this person's own first (favorites, then most recent), then everyone else's
  function drinkHistory(p) {
    const map = new Map();
    E.filter(e => e.kind === 'drink' && e.name).sort((a, b) => b.t - a.t).forEach(e => {
      const n = norm(e.name);
      let h = map.get(n);
      if (!h) { h = { name: e.name.trim(), last: e, mine: null, count: 0, fav: false }; map.set(n, h); }
      if ((e.p || 0) === p) { h.count++; if (!h.mine) h.mine = e; }
      if (e.fav) h.fav = true;
    });
    const list = [...map.values()];
    const own = list.filter(h => h.mine).sort((a, b) => (b.fav - a.fav) || b.mine.t - a.mine.t);
    const others = list.filter(h => !h.mine).sort((a, b) => (b.fav - a.fav) || b.last.t - a.last.t);
    return own.concat(others);
  }

  // ---------- overlays, toasts, clipboard ----------
  const layer = $('#layer');
  const stack = [];
  let ignorePop = 0;
  function openOverlay(html, opts) {
    opts = opts || {};
    const el = document.createElement('div');
    el.className = 'overlay';
    el.innerHTML = html;
    $('#toast').hidden = true;
    let pushed = false;
    try { history.pushState({ siplog: stack.length + 1 }, ''); pushed = true; } catch (e) { pushed = false; }
    layer.appendChild(el);
    stack.push({ el, pushed, onClose: opts.onClose });
    document.body.style.overflow = 'hidden';
    el.addEventListener('click', e => { if (e.target === el) closeTop(); });
    setTimeout(() => { const f = el.querySelector('[data-autofocus]'); if (f) try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 40);
    return el;
  }
  function removeTop() {
    const e = stack.pop(); if (!e) return null;
    e.el.remove();
    if (e.onClose) e.onClose();
    if (!stack.length) document.body.style.overflow = '';
    return e;
  }
  function closeTop() { const e = removeTop(); if (e && e.pushed) { ignorePop++; try { history.back(); } catch (err) { ignorePop--; } } }
  window.addEventListener('popstate', () => { if (ignorePop > 0) { ignorePop--; return; } if (stack.length) removeTop(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && stack.length) closeTop(); });

  let toastTimer;
  function toast(msg, actions) {
    const t = $('#toast');
    t.innerHTML = `<span>${esc(msg)}</span>` + (actions || []).map((a, i) => `<button type="button" data-ti="${i}">${esc(a[0])}</button>`).join('');
    (actions || []).forEach((a, i) => { t.querySelector(`[data-ti="${i}"]`).onclick = () => { t.hidden = true; a[1](); }; });
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, actions && actions.length ? 6000 : 2600);
  }
  function copyText(text, okMsg) {
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      toast(ok ? okMsg : 'Copy was blocked here. Select the text and copy it manually.');
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => toast(okMsg), fallback);
      else fallback();
    } catch (e) { fallback(); }
  }

  // ---------- navigation ----------
  const VIEWS = ['log', 'trip', 'stats', 'settings'];
  let view = 'log';
  let sel = curKey();
  let tripWho = -1, tlWho = -1, statsScope = 'trip';
  let lastRound = null;
  function go(v) {
    view = v;
    VIEWS.forEach(x => { $('#v-' + x).hidden = x !== v; });
    $$('.tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.go === v ? 'page' : 'false'));
    render();
    try { window.scrollTo(0, 0); } catch (e) { /* ignore */ }
  }
  function render() {
    if (view === 'log') renderLog();
    else if (view === 'trip') renderTrip();
    else if (view === 'stats') renderStats();
    else renderSettings();
  }

  // ---------- LOG ----------
  function renderLog() {
    const k = sel, cur = curKey(), isToday = k === cur;
    const list = forDay(k);
    const vis = visibleIdx();
    const compact = vis.length >= 3;
    const i = dayIndex(k);
    let h = '';
    if (!S.setupDone) h += setupHTML();
    h += `<div class="dayhead">
      <button class="icon-btn" type="button" data-act="prevday" aria-label="Previous day">${I.left}</button>
      <button class="daytitle" type="button" data-act="days" aria-label="Choose a day">
        <span class="d">${inTrip(k) ? `Day ${i + 1} <span class="muted" style="font-size:.6em">of ${S.days}</span>` : esc(dateLabel(k, { month: 'short', day: 'numeric' }))}</span>
        <span class="s">${esc(dateLabel(k, { weekday: 'long', month: 'short', day: 'numeric' }))}${portOf(k) ? ` · <b>${esc(portOf(k))}</b>` : ''}${isToday ? ' · Today' : ''}</span>
      </button>
      <button class="icon-btn" type="button" data-act="nextday" aria-label="Next day" ${k >= cur ? 'disabled' : ''}>${I.right}</button>
    </div>
    ${isToday ? '' : '<button class="btn small back-today" type="button" data-act="today">Back to today</button>'}
    ${isToday && vis.length >= 2 ? `<div class="roundbar" role="group" aria-label="Log for several people at once"><button class="btn small" type="button" data-act="round" data-kind="drink">${I.cheers}Round of drinks</button><button class="btn small" type="button" data-act="round" data-kind="water">${I.water}Water round</button></div>` : ''}
    <div class="people ${compact ? 'compact' : ''}">${vis.map(p => tileHTML(p, byPerson(list, p), isToday, k, compact)).join('')}</div>
    ${canAdd() ? `<button class="btn small addp" type="button" data-act="person-new">${I.person}Add a person</button>` : ''}
    <section class="card" aria-label="Day at a glance">
      <div class="section-head"><h2>Day at a glance</h2><div class="legend"><span><i class="sw drink dot"></i>Drinks</span><span><i class="sw water dia"></i>Water</span></div></div>
      <div class="chartbox" id="glance"></div>
    </section>
    ${timelineHTML(list, k, isToday)}
    ${summaryHTML(k, list)}
    <p class="foot">A day runs from ${fmtHour(S.cutoff)} to ${fmtHour(S.cutoff)}, so a 1 AM nightcap counts toward the night before.</p>`;
    $('#v-log').innerHTML = h;
    drawGlance(k, list);
  }

  function setupHTML() {
    const ppl = S.people.map(p => p.name).concat(['', '', '', '']).slice(0, 4);
    return `<div class="setup">
      <p class="eyebrow">Set up your cruise</p>
      <h2>Which day is Day 1?</h2>
      <p>Pick the date you boarded so every day gets its cruise-day number, then name everyone you're tracking. You can change all of this later.</p>
      <div class="grid2">
        <label class="field" for="su-start"><span>Day 1 (boarding day)</span><input id="su-start" type="date" value="${esc(S.start)}"></label>
        <label class="field" for="su-days"><span>Cruise length (days)</span><input id="su-days" type="number" min="1" max="60" inputmode="numeric" value="${esc(S.days)}"></label>
        ${ppl.map((n, i) => `<label class="field" for="su-p${i}"><span>Person ${i + 1}${i ? ' (optional)' : ''}</span><input id="su-p${i}" value="${esc(n)}" placeholder="${i === 0 ? 'Me' : 'Optional'}" maxlength="16" autocomplete="off"></label>`).join('')}
      </div>
      <div class="btn-row"><button class="btn go" type="button" data-act="setup-save">Start logging</button></div>
    </div>`;
  }

  // something still being sipped: one tap if it's all gone, or say how much was finished
  function sipBox(e) {
    const isW = e.kind === 'water';
    return `<div class="sipping ${isW ? 'w' : ''}">
      <p>Sipping <b>${esc(isW ? 'water' : (e.name || 'a drink'))}</b> · <span data-dur="${e.start || e.t}">${fmtDur((Date.now() - (e.start || e.t)) / 60000)}</span></p>
      <button class="btn small fin" type="button" data-act="finish" data-id="${e.id}" data-part="1">${I.check}Finished</button>
      <div class="partrow" role="group" aria-label="Only finished part of it"><span class="cap">Only part of it?</span><div class="g3">${PARTS.slice(1).map(([v, l]) => `<button type="button" data-act="finish" data-id="${e.id}" data-part="${v}" aria-label="Finished ${l} of it">${l}</button>`).join('')}</div></div>
    </div>`;
  }
  function tileHTML(p, list, isToday, k, compact) {
    const st = stats(list);
    const goal = +S.waterGoal || 0, lim = +S.limit || 0;
    const open = st.open[st.open.length - 1], openW = st.openW[st.openW.length - 1];
    const ln = isToday ? lastNamed(p) : null;
    const nameBtn = `<button class="namebtn" type="button" data-act="person-edit" data-p="${p}" aria-label="Rename ${esc(nameOf(p))}"><span class="nm">${esc(labelOf(p))}</span><span class="pen" aria-hidden="true">${I.pencil}</span></button>`;
    const actions = isToday
      ? (compact
        ? `<div class="btn2"><button class="big drink" type="button" data-act="add-drink" data-p="${p}">${I.plus}Drink</button><button class="big water" type="button" data-act="add-water" data-p="${p}">${I.plus}Water</button></div>`
        : `<button class="big drink" type="button" data-act="add-drink" data-p="${p}">${I.plus}Drink</button><button class="big water" type="button" data-act="add-water" data-p="${p}">${I.plus}Water</button>`) +
        `<div class="mini-row">
          <button class="mini" type="button" data-act="start-drink" data-p="${p}">${I.timer}<span>${compact ? 'Ordered' : 'Just ordered'}</span></button>
          <button class="mini w" type="button" data-act="start-water" data-p="${p}" title="Start a water you'll sip for a while">${I.sipw}<span>Start water</span></button>
          ${ln ? `<button class="mini" type="button" data-act="again" data-p="${p}" data-id="${ln.id}" title="Log another ${esc(ln.name)}">${I.again}<span>${esc(ln.name)}</span></button>` : ''}
        </div>`
      : `<button class="btn small" type="button" data-act="add-past" data-p="${p}">Add to ${esc(dayName(k))}</button>`;
    return `<div class="tile ${compact ? 'compact' : ''}">
      <div class="who">${nameBtn}${st.std ? `<span class="muted small">≈${fmt1(st.std)} std</span>` : ''}</div>
      <div class="figs">
        <div class="fig drink"><span class="v">${fmtQ(st.drinks)}${lim ? `<span class="of">/${lim}</span>` : ''}</span><span class="k"><i></i>${many(st.drinks, 'drink', 'drinks')}</span></div>
        <div class="fig water"><span class="v">${fmtQ(st.waters)}${goal ? `<span class="of">/${goal}</span>` : ''}</span><span class="k"><i></i>water</span></div>
      </div>
      ${lim ? `<div class="meter drinkm ${st.drinks > lim ? 'over' : ''}" role="img" aria-label="${fmtQ(st.drinks)} of ${lim} drinks"><i style="width:${Math.min(100, st.drinks / lim * 100)}%"></i></div>` : ''}
      ${goal ? `<div class="meter" role="img" aria-label="${fmtQ(st.waters)} of ${goal} waters"><i style="width:${Math.min(100, st.waters / goal * 100)}%"></i></div>` : ''}
      ${open ? sipBox(open) : ''}
      ${openW ? sipBox(openW) : ''}
      ${actions}
      <p class="lastline">${st.last ? `Last drink ${fmtTime(st.last.t)}${isToday ? ` · <span data-ago="${st.last.t}">${ago(st.last.t)}</span>` : ''}` : 'No drinks yet'}${st.pace ? ` · one every ${fmtDur(st.pace)}` : ''}</p>
      ${isToday && st.drinks - st.waters >= 2 ? `<p class="nudge">${fmtQ(st.drinks - st.waters)} drinks ahead of water. Time for a bottle?</p>` : ''}
    </div>`;
  }

  // Day at a glance: one row per person, drinks (circles) and water (diamonds) on a clock axis
  function drawGlance(k, list) {
    const box = $('#glance'); if (!box) return;
    const rows = shownIn(list);
    const W = Math.max(260, box.clientWidth || 340);
    const left = Math.min(92, Math.max(48, Math.max(...rows.map(p => labelOf(p).length)) * 7 + 12)), right = 12, top = 20, row = 34;
    const H = top + rows.length * row + 8;
    const t0 = dayStart(k), t1 = t0 + 24 * 3600e3;
    const x = t => left + (t - t0) / (t1 - t0) * (W - left - right);
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Timeline of drinks and water for ${esc(dayName(k))}">`;
    for (let hr = 0; hr <= 24; hr++) {
      const clock = ((+S.cutoff || 0) + hr) % 24;
      if (clock % 4 !== 0) continue;
      const xx = x(t0 + hr * 3600e3);
      s += `<line class="grid-l" x1="${xx}" x2="${xx}" y1="${top - 4}" y2="${H - 6}"/><text class="axis-t" x="${xx}" y="${top - 8}" text-anchor="middle">${clock === 0 ? '12a' : clock === 12 ? '12p' : clock < 12 ? clock + 'a' : (clock - 12) + 'p'}</text>`;
    }
    rows.forEach((p, r) => {
      const cy = top + r * row + row / 2, lab = labelOf(p);
      s += `<line class="grid-l" x1="${left}" x2="${W - right}" y1="${cy}" y2="${cy}"/><text class="axis-l" x="${left - 8}" y="${cy + 4}" text-anchor="end">${esc(lab.length > 11 ? lab.slice(0, 10) + '…' : lab)}</text>`;
    });
    const now = Date.now();
    if (now > t0 && now < t1) s += `<line x1="${x(now)}" x2="${x(now)}" y1="${top - 4}" y2="${H - 6}" stroke="var(--ink)" stroke-width="1" opacity=".5"/>`;
    // a wedge for the share of a drink that was finished, starting at 12 o'clock
    const pie = (cx, cy, r, f) => { const a = f * 2 * Math.PI; return `M${cx} ${cy}L${cx} ${cy - r}A${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}Z`; };
    const diamond = (cx, cy, h, cls) => `<rect class="mk ${cls}" x="${cx - h}" y="${cy - h}" width="${2 * h}" height="${2 * h}" transform="rotate(45 ${cx} ${cy})"/>`;
    list.slice().sort((a, b) => a.t - b.t).forEach(e => {
      const r = rows.indexOf(e.p || 0);
      const cy = top + r * row + row / 2, cx = x(Math.min(Math.max(e.t, t0), t1));
      const part = partOf(e);
      const label = `${fmtTime(e.t)} · ${e.kind === 'water' ? 'Water' : (e.name || 'Drink')}${e.open ? ' (sipping)' : part < 1 ? ` (${partWord(part)} finished)` : ''} · ${nameOf(e.p || 0)}`;
      let mark;
      if (e.kind === 'water') {
        if (e.open) mark = diamond(cx, cy, 4.5, 'm-wopen');
        else if (part < 1) mark = diamond(cx, cy, 4.5, 'm-wopen') + diamond(cx, cy, 4.5 * Math.sqrt(part), 'm-wfill');
        else mark = diamond(cx, cy, 4.5, 'm-water');
      } else if (e.open) mark = `<circle class="mk m-open" cx="${cx}" cy="${cy}" r="5.5"/>`;
      else if (part < 1) mark = `<circle class="mk m-open" cx="${cx}" cy="${cy}" r="5.5"/><path class="mk m-dfill" d="${pie(cx, cy, 5.5, part)}"/>`;
      else mark = `<circle class="mk m-drink" cx="${cx}" cy="${cy}" r="5.5"/>`;
      s += `<g class="hitg"><circle class="hit" cx="${cx}" cy="${cy}" r="12" tabindex="0" role="button" aria-label="${esc(label)}" data-act="edit" data-id="${e.id}" data-tip-x="${cx}" data-tip-y="${cy - 8}"/>${mark}</g>`;
    });
    s += '</svg><div class="tip" hidden></div>';
    box.innerHTML = s;
    bindTips(box, el => {
      const e = E.find(x => x.id === el.dataset.id); if (!e) return null;
      return [fmtTime(e.t), `${e.kind === 'water' ? 'Water' : (e.name || 'Drink')}${e.open ? ', still sipping' : partOf(e) < 1 ? `, ${partWord(partOf(e))} finished` : ''}`, nameOf(e.p || 0), e.kind === 'water' ? 'water' : 'drink'];
    });
  }
  function bindTips(box, content) {
    const tip = box.querySelector('.tip');
    const show = el => {
      const c = content(el); if (!c) return;
      tip.textContent = '';
      const strong = document.createElement('strong'); strong.textContent = c[0]; tip.appendChild(strong);
      const line = document.createElement('div');
      const key = document.createElement('span'); key.className = 'key'; key.style.background = c[3] === 'water' ? 'var(--water)' : 'var(--drink)';
      line.appendChild(key); line.appendChild(document.createTextNode(c[1])); tip.appendChild(line);
      if (c[2]) { const w = document.createElement('div'); w.style.opacity = '.75'; w.textContent = c[2]; tip.appendChild(w); }
      const bx = +el.dataset.tipX, W = box.clientWidth;
      tip.style.left = Math.min(Math.max(bx, 70), W - 70) + 'px';
      tip.style.top = el.dataset.tipY + 'px';
      tip.hidden = false;
    };
    const hide = () => { tip.hidden = true; };
    $$('[data-tip-x]', box).forEach(el => {
      el.addEventListener('pointerenter', () => show(el));
      el.addEventListener('pointerleave', hide);
      el.addEventListener('focus', () => show(el));
      el.addEventListener('blur', hide);
    });
  }

  function timelineHTML(list, k, isToday) {
    const whoList = shownIn(list);
    if (tlWho >= 0 && !whoList.includes(tlWho)) tlWho = -1;
    const mine = tlWho >= 0 ? byPerson(list, tlWho) : list;
    const sorted = mine.slice().sort((a, b) => b.t - a.t);
    const multi = whoList.length > 1;
    let rows = '';
    sorted.forEach((e, idx) => {
      if (idx > 0) {
        const gap = (sorted[idx - 1].t - e.t) / 60000;
        if (gap >= 1) rows += `<li class="tl-gap" aria-hidden="true">${fmtDur(gap)} later</li>`;
      }
      const isW = e.kind === 'water', part = partOf(e);
      const bits = [];
      if (e.start && !e.open) bits.push(`${isW ? 'started' : 'ordered'} ${fmtTime(e.start)} · ${fmtDur((e.t - e.start) / 60000)}`);
      if (e.open) bits.push(`started ${fmtTime(e.start || e.t)}`);
      if (isW) bits.push(`${part < 1 ? partWord(part) + ' of a ' : ''}${(WATER[e.unit] || ['Water'])[0].toLowerCase()} · ${volume((e.ml || 0) * part)}`);
      else if (part < 1 && !e.open) bits.push(`finished ${partWord(part)}`);
      if (e.where) bits.push(e.where);
      if (e.note) bits.push('“' + e.note + '”');
      rows += `<li><button class="tl-item" type="button" data-act="edit" data-id="${e.id}">
        <time datetime="${new Date(e.t).toISOString()}">${fmtTime(e.t)}</time>
        <span class="tl-ico ${isW ? 'water' : 'drink'}" aria-hidden="true">${isW ? I.water : I.drink}</span>
        <span class="tl-main"><b>${esc(isW ? 'Water' : (e.name || 'Drink'))}${e.fav ? ' <span style="color:var(--drink)" aria-label="favorite">♥</span>' : ''}${e.open ? '<span class="badge-sip">Sipping</span>' : part < 1 ? `<span class="badge-part" aria-label="${partWord(part)} finished">${partWord(part)}</span>` : ''}</b>
          <span>${multi ? `<span class="who-chip">${esc(labelOf(e.p || 0))}</span>` : ''}${esc(bits.join(' · '))}</span></span>
        <span class="tl-side">${isW ? '' : '≈' + fmt1((+e.std || 0) * part)}</span>
      </button></li>`;
    });
    const filter = multi && list.length ? `<div class="chips" role="group" aria-label="Show entries for">${[[-1, 'Everyone']].concat(whoList.map(p => [p, labelOf(p)])).map(([v, l]) => `<button class="chip" type="button" data-act="tlwho" data-v="${v}" aria-pressed="${tlWho === v}">${esc(l)}</button>`).join('')}</div>` : '';
    return `<section aria-label="Timeline" style="display:grid;gap:10px">
      <div class="section-head"><h2>Timeline</h2><button class="linkish" type="button" data-act="add-past" data-p="${tlWho >= 0 ? tlWho : -1}">${isToday ? 'Add an earlier one' : 'Add to this day'}</button></div>
      ${filter}
      ${sorted.length ? `<ul class="tl">${rows}</ul>` : `<div class="empty"><p>${list.length ? 'Nothing logged for this person on this day.' : isToday ? 'Nothing logged yet today.' : 'Nothing logged on this day.'}</p><p class="small">Tap + Drink to pick what you're having, or + Water for a water. Tap any entry later to change the time, how much was finished, or where you were.</p></div>`}
    </section>`;
  }

  function summaryHTML(k, list) {
    if (!list.length) return '';
    const who = shownIn(list);
    const rows = who.map(p => {
      const st = stats(byPerson(list, p));
      return `<tr><td>${esc(labelOf(p))}</td><td>${fmtQ(st.drinks)}</td><td>${fmt1(st.std)}</td><td>${fmtQ(st.waters)}</td><td>${st.ml ? fmt1(st.ml / 1000) + ' L' : '–'}</td></tr>`;
    }).join('');
    const firstLast = who.map(p => {
      const st = stats(byPerson(list, p));
      if (!st.drinks) return '';
      return `<p class="small"><b>${esc(nameOf(p))}:</b> first drink ${st.first ? fmtTime(st.first.t) : '–'}, last ${st.last ? fmtTime(st.last.t) : '–'}${st.pace ? `, about one every ${fmtDur(st.pace)}` : ''}${st.waters ? `, ${fmt1(st.waters / st.drinks)} ${st.waters === st.drinks ? 'water' : 'waters'} per drink` : ''}.</p>`;
    }).join('');
    return `<section class="card" aria-label="Day summary">
      <div class="section-head"><h2>${esc(dayName(k))} summary</h2><button class="btn small" type="button" data-act="copy-day">${I.copy}Copy</button></div>
      <div class="tablewrap"><table class="sumtable"><thead><tr><th>Who</th><th>Drinks</th><th>≈ Std</th><th>Water</th><th>Volume</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${firstLast}
    </section>`;
  }

  function dayText(k) {
    const list = forDay(k).sort((a, b) => a.t - b.t);
    const lines = [`Sip Log · ${dayName(k)} · ${dateLabel(k, { weekday: 'long', month: 'short', day: 'numeric' })}${portOf(k) ? ' · ' + portOf(k) : ''}`];
    shownIn(list).forEach(p => {
      const mine = byPerson(list, p), st = stats(mine);
      if (!mine.length) return;
      lines.push('', `${labelOf(p)}: ${fmtQ(st.drinks)} ${many(st.drinks, 'drink', 'drinks')} (≈${fmt1(st.std)} std), ${fmtQ(st.waters)} ${many(st.waters, 'water', 'waters')} (${volume(st.ml)})`);
      mine.forEach(e => lines.push(`  ${fmtTime(e.t)}  ${e.kind === 'water' ? 'Water' : (e.name || 'Drink')}${e.open ? ' (sipping)' : partOf(e) < 1 ? ` (${partWord(partOf(e))} finished)` : ''}${e.start && !e.open ? ` (${e.kind === 'water' ? 'started' : 'ordered'} ${fmtTime(e.start)})` : ''}${e.where ? ' @ ' + e.where : ''}`));
    });
    return lines.join('\n');
  }

  // ---------- quick actions ----------
  function addEntries(entries, msg, details) {
    entries.forEach(e => E.push(e)); saveE(); buzz();
    render();
    const ids = new Set(entries.map(e => e.id));
    const acts = [['Undo', () => { E = E.filter(x => !ids.has(x.id)); saveE(); render(); }]];
    if (details) acts.unshift([details === 'edit' ? 'Edit' : 'Add details', () => openEditor(entries[0].id, { focusName: details !== 'edit' })]);
    toast(msg, acts);
  }
  const newDrink = (p, extra) => Object.assign({ id: uid(), kind: 'drink', p, t: Date.now(), start: null, open: false, name: '', std: 1.5, where: '', fav: false, note: '' }, extra || {});
  const newWater = (p, t, extra) => { const u = WATER[S.waterUnit] ? S.waterUnit : 'bottle'; return Object.assign({ id: uid(), kind: 'water', p, t: t || Date.now(), unit: u, ml: WATER[u][1], note: '' }, extra || {}); };
  function quickDrink(p) {
    const st = stats(byPerson(forDay(curKey()), p));
    addEntries([newDrink(p)], `Drink ${st.orders + 1} for ${nameOf(p)} at ${fmtTime(Date.now())}`, true);
  }
  function quickWater(p) {
    const st = stats(byPerson(forDay(curKey()), p));
    addEntries([newWater(p)], `Water ${st.bottles + 1} for ${nameOf(p)}`);
  }
  function startWater(p) {
    const now = Date.now();
    addEntries([newWater(p, now, { start: now, open: true })], `Water started for ${nameOf(p)}. Tap Finished when it's done.`);
  }
  function startDrink(p) {
    const now = Date.now();
    addEntries([newDrink(p, { t: now, start: now, open: true })], `Timer started for ${nameOf(p)}. Tap Finished when it's done.`, true);
  }
  function again(p, id) {
    const src = E.find(e => e.id === id); if (!src) return;
    const st = stats(byPerson(forDay(curKey()), p));
    addEntries([newDrink(p, { name: src.name, std: src.std || 1.5, where: src.where || '' })], `${src.name} (drink ${st.orders + 1}) for ${nameOf(p)}`);
  }
  // part: 1 if it was all finished, or ¾, ½, ¼
  function finish(id, part) {
    const e = E.find(x => x.id === id); if (!e) return;
    const prev = { t: e.t, open: e.open, start: e.start, part: e.part };
    e.open = false; e.t = Date.now(); if (!e.start) e.start = prev.t;
    if (part > 0 && part < 1) e.part = part; else delete e.part;
    saveE(); buzz(); render();
    const what = e.kind === 'water' ? 'Water' : (e.name || 'Drink');
    toast(`${what}: ${part < 1 ? partWord(part) + ' finished' : 'finished'} after ${fmtDur((e.t - e.start) / 60000)}`, [['Undo', () => {
      e.t = prev.t; e.open = prev.open; e.start = prev.start;
      if (prev.part) e.part = prev.part; else delete e.part;
      saveE(); render();
    }]]);
  }
  const whenAgo = ts => {
    const m = (Date.now() - ts) / 60000;
    if (m < 60) return m < 1 ? 'just now' : Math.round(m) + ' min ago';
    if (m < 1440) return Math.round(m / 60) + ' h ago';
    const d = Math.round(m / 1440);
    return d === 1 ? 'yesterday' : d + ' days ago';
  };

  // + Drink: pick from this person's past drinks, everyone's recent ones, or the recipe list
  function openPicker(p, mode) {
    let part = 1;
    const hist = drinkHistory(p);
    const stdOf = h => +((h.mine || h.last).std) || stdFor(h.name) || 1.5;
    const el = openOverlay(`<div class="panel" role="dialog" aria-modal="true" aria-labelledby="pk-title">
      <div class="panel-bar"><h2 id="pk-title">${esc(labelOf(p))}: which drink?</h2><button class="icon-btn" type="button" data-act="close" aria-label="Close">${I.x}</button></div>
      <div id="pk-top" style="display:grid;gap:10px"></div>
      <div class="pk-search">${I.search}<label class="sr" for="pk-q">Search drinks or type a name</label><input id="pk-q" type="search" placeholder="Search ${CATALOG.length ? Math.floor(CATALOG.length / 10) * 10 + '+ ' : ''}drinks or type a name" autocomplete="off" autocorrect="off" enterkeyhint="done"></div>
      <div class="pk-list" id="pk-list"></div>
    </div>`);
    const top = $('#pk-top', el), list = $('#pk-list', el), input = $('#pk-q', el);
    const row = (name, std, meta, fav) => `<button class="pick" type="button" data-pk="pick" data-name="${esc(name)}" data-std="${std}"><span class="pk-n">${fav ? '<span class="heart" aria-label="favorite">♥</span> ' : ''}${esc(name)}</span><span class="pk-m">${esc(meta)}</span></button>`;
    const drawTop = () => {
      top.innerHTML = `<div class="seg wide" role="group" aria-label="Status"><button type="button" data-pk="mode" data-v="done" aria-pressed="${mode === 'done'}">Finished it</button><button type="button" data-pk="mode" data-v="open" aria-pressed="${mode === 'open'}">Just ordered</button></div>
        ${mode === 'done'
          ? `<div class="field"><span>How much did ${esc(nameOf(p))} finish?</span><div class="chips" role="group" aria-label="How much was finished">${PARTS.map(([v, l]) => `<button class="chip ${v < 1 ? 'frac' : ''}" type="button" data-pk="part" data-v="${v}" aria-pressed="${part === v}" aria-label="${v === 1 ? 'All of it' : l + ' of it'}">${v === 1 ? 'All of it' : l}</button>`).join('')}</div></div>`
          : `<p class="muted small">Starts a timer. Tap Finished on ${esc(nameOf(p))}'s counter when it's done, or say how much was left.</p>`}`;
    };
    const drawList = () => {
      const typed = input.value.trim(), q = norm(typed);
      let h = '';
      if (!q) {
        h += `<button class="pick plain" type="button" data-pk="plain"><span class="pk-n">${I.drink}Just a drink, no name</span><span class="pk-m">add it later</span></button>`;
        const own = hist.filter(x => x.mine).slice(0, 8), others = hist.filter(x => !x.mine).slice(0, 8);
        if (own.length) h += `<p class="pk-h">${esc(nameOf(p))}'s drinks</p>` + own.map(x => row(x.name, stdOf(x), `×${x.count} · ${whenAgo(x.mine.t)}`, x.fav)).join('');
        if (others.length) h += `<p class="pk-h">Others have had</p>` + others.map(x => row(x.name, stdOf(x), `${nameOf(x.last.p || 0)} · ${whenAgo(x.last.t)}`, x.fav)).join('');
        if (hist.length < 4) {
          const seen = new Set(hist.map(x => norm(x.name)));
          const pop = POPULAR.filter(n => !seen.has(norm(n)) && catalogByName.has(norm(n))).slice(0, 8);
          if (pop.length) h += `<p class="pk-h">Cruise favorites</p>` + pop.map(n => row(catalogByName.get(norm(n)).name, stdFor(n), `≈${fmt1(stdFor(n))} std`, false)).join('');
        }
      } else {
        const pool = hist.map(x => ({ name: x.name, std: stdOf(x), meta: x.mine ? `×${x.count} · ${whenAgo(x.mine.t)}` : `${nameOf(x.last.p || 0)} · ${whenAgo(x.last.t)}`, fav: x.fav, mine: 1 }))
          .concat(CATALOG.map(c => ({ name: c.name, std: c.std, meta: `≈${fmt1(c.std)} std`, fav: false, mine: 0 })));
        const seen = new Set();
        const hits = pool.filter(c => { const n = norm(c.name); if (seen.has(n) || !n.includes(q)) return false; seen.add(n); return true; })
          .sort((a, b) => (norm(b.name).startsWith(q) - norm(a.name).startsWith(q)) || (b.mine - a.mine) || a.name.length - b.name.length).slice(0, 8);
        if (!hits.some(c => norm(c.name) === q)) h += `<button class="pick add" type="button" data-pk="typed"><span class="pk-n">${I.plus}Log “${esc(typed)}”</span><span class="pk-m">new name</span></button>`;
        h += hits.map(c => row(c.name, c.std, c.meta, c.fav)).join('');
      }
      list.innerHTML = h;
    };
    const commit = (name, std) => {
      const now = Date.now();
      const st = stats(byPerson(forDay(curKey()), p));
      const e = mode === 'open'
        ? newDrink(p, { t: now, start: now, open: true, name, std })
        : newDrink(p, Object.assign({ name, std }, part < 1 ? { part } : {}));
      closeTop();
      addEntries([e], mode === 'open'
        ? `Timer started: ${name || 'a drink'} for ${nameOf(p)}`
        : `${name || 'Drink'}${part < 1 ? ` (${partWord(part)})` : ''} for ${nameOf(p)} · drink ${st.orders + 1} today`, 'edit');
    };
    el.addEventListener('click', ev => {
      const b = ev.target.closest('[data-pk]'); if (!b) return;
      const a = b.dataset.pk;
      if (a === 'mode') { mode = b.dataset.v; drawTop(); }
      else if (a === 'part') { part = +b.dataset.v; drawTop(); }
      else if (a === 'pick') commit(b.dataset.name, +b.dataset.std || stdFor(b.dataset.name) || 1.5);
      else if (a === 'plain') commit('', 1.5);
      else if (a === 'typed') { const n = input.value.trim(); if (n) commit(n, stdFor(n) || 1.5); }
    });
    input.addEventListener('input', drawList);
    input.addEventListener('keydown', ev => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      const n = input.value.trim(); if (!n) return;
      const known = hist.find(x => norm(x.name) === norm(n));
      commit(known ? known.name : n, known ? stdOf(known) : (stdFor(n) || 1.5));
    });
    drawTop();
    drawList();
  }

  // Round: one tap logs a drink or a water for everyone selected
  function openRound(kind) {
    const vis = visibleIdx();
    const chosen = new Set((lastRound || vis).filter(p => vis.includes(p)));
    if (!chosen.size) vis.forEach(p => chosen.add(p));
    let name = '', std = null, mode = 'done';
    const recent = drinkHistory(-1).slice(0, 8);
    const el = openOverlay(`<div class="panel" role="dialog" aria-modal="true" aria-labelledby="rd-title">
      <div class="panel-bar"><h2 id="rd-title">${kind === 'water' ? 'Water for the table' : 'Round of drinks'}</h2><button class="icon-btn" type="button" data-act="close" aria-label="Close">${I.x}</button></div>
      <div id="rd-body" style="display:grid;gap:16px"></div></div>`);
    const body = $('#rd-body', el);
    const draw = () => {
      body.innerHTML = `
        <div class="seg wide" role="group" aria-label="Status"><button type="button" data-rd="mode" data-v="done" aria-pressed="${mode === 'done'}">${kind === 'water' ? 'Drank it' : 'Finished'}</button><button type="button" data-rd="mode" data-v="open" aria-pressed="${mode === 'open'}">${kind === 'water' ? 'Just started' : 'Just ordered'}</button></div>
        <div class="field"><span>Who's in?</span><div class="chips">${vis.map(p => `<button class="chip" type="button" data-rd="p" data-v="${p}" aria-pressed="${chosen.has(p)}">${esc(labelOf(p))}</button>`).join('')}</div></div>
        ${kind === 'drink' ? `<label class="field" for="rd-name"><span>Same drink for everyone? (optional)</span><input id="rd-name" value="${esc(name)}" placeholder="e.g. Champagne toast" autocomplete="off"></label>
          ${recent.length ? `<div class="chips" role="group" aria-label="Recent drinks">${recent.map(h => `<button class="chip" type="button" data-rd="name" data-name="${esc(h.name)}" data-std="${+(h.last.std) || ''}" aria-pressed="${norm(name) === norm(h.name)}">${esc(h.name)}</button>`).join('')}</div>` : ''}
          <p class="muted small">Leave it blank and add names one by one later from the timeline.</p>` : ''}
        <button class="big ${kind === 'water' ? 'water' : 'drink'}" type="button" data-rd="go" ${chosen.size ? '' : 'disabled'}>${kind === 'water' ? I.water : I.cheers}${mode === 'open' ? `Start ${chosen.size === 1 ? 'a timer' : `timers for ${chosen.size}`}` : `Log ${chosen.size} ${kind === 'water' ? (chosen.size === 1 ? 'water' : 'waters') : (chosen.size === 1 ? 'drink' : 'drinks')}`}</button>`;
    };
    body.addEventListener('click', ev => {
      const b = ev.target.closest('[data-rd]'); if (!b) return;
      const nm = $('#rd-name', body); if (nm) name = nm.value.trim();
      if (b.dataset.rd === 'p') { const p = +b.dataset.v; if (chosen.has(p)) chosen.delete(p); else chosen.add(p); draw(); return; }
      if (b.dataset.rd === 'mode') { mode = b.dataset.v; draw(); return; }
      if (b.dataset.rd === 'name') { name = b.dataset.name; std = +b.dataset.std || null; draw(); return; }
      if (b.dataset.rd === 'go' && chosen.size) {
        lastRound = [...chosen];
        const now = Date.now();
        const ps = [...chosen].sort((a, c) => a - c);
        const sipping = mode === 'open' ? { start: now, open: true } : {};
        const known = recent.find(h => norm(h.name) === norm(name));
        const strength = (known && norm(name) && (std || +known.last.std)) || stdFor(name) || 1.5;
        const items = ps.map(p => kind === 'water' ? newWater(p, now, sipping) : newDrink(p, Object.assign({ t: now, name, std: strength }, sipping)));
        closeTop();
        addEntries(items, mode === 'open'
          ? `${kind === 'water' ? 'Water' : (name || 'Drinks')} started for ${joinNames(ps.map(nameOf))}`
          : `${kind === 'water' ? 'Water' : (name || 'Round')} logged for ${joinNames(ps.map(nameOf))}`);
      }
    });
    draw();
  }

  // ---------- people editor ----------
  function openPerson(p) {
    const isNew = p == null;
    const cur = isNew ? { name: '', emoji: '', hidden: false } : Object.assign({}, S.people[p]);
    const others = S.people.filter((x, i) => i !== p && !x.hidden).length;
    const el = openOverlay(`<div class="panel" role="dialog" aria-modal="true" aria-labelledby="pe-title">
      <div class="panel-bar"><h2 id="pe-title">${isNew ? 'Add a person' : 'Edit ' + esc(nameOf(p))}</h2><button class="icon-btn" type="button" data-act="close" aria-label="Close">${I.x}</button></div>
      <div id="pe-body" style="display:grid;gap:16px"></div></div>`);
    const body = $('#pe-body', el);
    let armed = 0;
    const draw = () => {
      body.innerHTML = `
        <label class="field" for="pe-name"><span>Name</span><input id="pe-name" value="${esc(cur.name)}" placeholder="e.g. Sam" maxlength="16" autocomplete="off" data-autofocus></label>
        <div class="field"><span>Emoji (optional, makes the timeline easier to scan)</span><div class="chips">${['' ].concat(EMOJI).map(em => `<button class="chip emo" type="button" data-pe="emoji" data-v="${em}" aria-pressed="${cur.emoji === em}" aria-label="${em ? 'Emoji ' + em : 'No emoji'}">${em || 'None'}</button>`).join('')}</div></div>
        <div class="btn-row"><button class="btn navy" type="button" data-pe="save">${isNew ? 'Add to the log' : 'Save'}</button>
        ${!isNew && others ? `<button class="btn danger" type="button" data-pe="hide">${armed ? 'Tap again to remove' : 'Remove from counters'}</button>` : ''}</div>
        ${!isNew && others ? '<p class="muted small">Removing hides their counters but keeps everything they logged in the history.</p>' : ''}`;
    };
    body.addEventListener('click', ev => {
      const b = ev.target.closest('[data-pe]'); if (!b) return;
      const nm = $('#pe-name', body); cur.name = nm.value.trim();
      const a = b.dataset.pe;
      if (a !== 'hide') armed = 0;
      if (a === 'emoji') { cur.emoji = b.dataset.v; draw(); const n = $('#pe-name', body); if (n) n.value = cur.name; return; }
      if (a === 'save') {
        if (!cur.name) { nm.focus(); nm.placeholder = 'Type a name first'; return; }
        if (isNew) {
          // someone removed earlier with the same name gets their history back
          let slot = S.people.findIndex(x => x.hidden && norm(x.name) === norm(cur.name));
          if (slot < 0) slot = freeSlot();
          if (slot < 0) { toast(`Sip Log tracks up to ${MAX_PEOPLE} people. Show a hidden person again in Settings instead.`); return; }
          S.people[slot] = { name: cur.name, emoji: cur.emoji, hidden: false };
        } else Object.assign(S.people[p], { name: cur.name, emoji: cur.emoji });
        saveS(); closeTop(); render();
        toast(isNew ? `${cur.name} added` : 'Saved');
        return;
      }
      if (a === 'hide') {
        if (!armed) { armed = 1; draw(); return; }
        S.people[p].hidden = true; saveS(); closeTop(); render();
        toast(`${nameOf(p)} removed from the counters`, [['Undo', () => { S.people[p].hidden = false; saveS(); render(); }]]);
      }
    });
    draw();
  }

  // ---------- entry editor ----------
  function openEditor(id, opts) {
    opts = opts || {};
    const existing = id ? E.find(e => e.id === id) : null;
    let d;
    if (existing) d = JSON.parse(JSON.stringify(existing));
    else {
      const base = opts.day && opts.day !== curKey() ? dayStart(opts.day) + (20 - (+S.cutoff || 0)) * 3600e3 : Date.now();
      d = { id: uid(), kind: opts.kind || 'drink', p: opts.p >= 0 ? opts.p : visibleIdx()[0], t: base, start: null, open: false, name: '', std: 1.5, where: '', fav: false, note: '', unit: S.waterUnit, ml: (WATER[S.waterUnit] || WATER.bottle)[1] };
    }
    if (!d.unit) d.unit = S.waterUnit;
    if (!d.ml) d.ml = (WATER[d.unit] || WATER.bottle)[1];
    if (d.std == null) d.std = 1.5;
    const whoChoices = () => { const v = visibleIdx(); if (!v.includes(d.p || 0)) v.push(d.p || 0); return v.sort((a, b) => a - b); };
    const el = openOverlay(`<div class="panel" role="dialog" aria-modal="true" aria-labelledby="ed-title"><div class="panel-bar"><h2 id="ed-title">${existing ? 'Edit entry' : 'Add an entry'}</h2><button class="icon-btn" type="button" data-act="close" aria-label="Close">${I.x}</button></div><div id="ed-body" style="display:grid;gap:16px"></div></div>`, { onClose: () => render() });
    const body = $('#ed-body', el);
    let delArmed = 0;
    const strengthHTML = () => {
      const recipeStd = stdFor(d.name);
      const chips = STRENGTHS.map(([l, v, hint]) => `<button class="chip" type="button" data-ed="std" data-v="${v}" aria-pressed="${Math.abs(d.std - v) < 0.01 && recipeStd !== d.std}" title="${esc(hint)}">${l} ≈${v}</button>`).join('') +
        (recipeStd != null ? `<button class="chip" type="button" data-ed="std" data-v="${recipeStd}" aria-pressed="${Math.abs(d.std - recipeStd) < 0.01}">This recipe ≈${fmt1(recipeStd)}</button>` : '');
      return `<span>Strength</span><div class="chips">${chips}</div><span class="muted small">Counts as about ${fmt1(d.std)} standard drinks (0.6 oz of alcohol each).</span>`;
    };
    const amountHTML = () => `<div class="field"><span>How much was finished</span><div class="chips">${PARTS.map(([v, l]) => `<button class="chip ${v < 1 ? 'frac' : ''}" type="button" data-ed="part" data-v="${v}" aria-pressed="${partOf(d) === v}" aria-label="${v === 1 ? 'All of it' : l + ' of it'}">${v === 1 ? 'All of it' : l}</button>`).join('')}</div></div>`;
    const statusHTML = () => `<div class="field"><span>Status</span><div class="seg" role="group" aria-label="Status"><button type="button" data-ed="open" data-v="0" aria-pressed="${!d.open}">Finished</button><button type="button" data-ed="open" data-v="1" aria-pressed="${!!d.open}">Still sipping</button></div></div>`;
    const finishedHTML = () => `<label class="field" for="ed-t"><span>Finished at</span><span class="inline"><input id="ed-t" type="datetime-local" value="${toInput(d.t)}"><button class="btn small" type="button" data-ed="now">Now</button></span></label>`;
    const startHTML = word => `<label class="field" for="ed-start"><span>${word} at ${d.open ? '' : '(optional, shows how long it lasted)'}</span><span class="inline"><input id="ed-start" type="datetime-local" value="${d.start ? toInput(d.start) : ''}"><button class="btn small" type="button" data-ed="start-now">Now</button>${d.start && !d.open ? '<button class="btn small" type="button" data-ed="start-clear">Clear</button>' : ''}</span></label>`;
    const draw = () => {
      const isW = d.kind === 'water';
      const who = whoChoices();
      body.innerHTML = `
        <div class="seg" role="group" aria-label="Type"><button type="button" data-ed="kind" data-v="drink" aria-pressed="${!isW}">Drink</button><button type="button" data-ed="kind" data-v="water" aria-pressed="${isW}">Water</button></div>
        ${who.length > 1 ? `<div class="field"><span>Who</span><div class="chips">${who.map(p => `<button class="chip" type="button" data-ed="p" data-v="${p}" aria-pressed="${(d.p || 0) === p}">${esc(labelOf(p))}</button>`).join('')}</div></div>` : ''}
        ${isW ? `
          <div class="field"><span>Size</span><div class="chips">${Object.entries(WATER).map(([k, [l, ml, oz]]) => `<button class="chip" type="button" data-ed="unit" data-v="${k}" aria-pressed="${d.unit === k}">${l} · ${oz}</button>`).join('')}</div></div>
          ${statusHTML()}
          ${d.open ? '' : finishedHTML() + amountHTML()}
          ${startHTML('Started')}
        ` : `
          <label class="field" for="ed-name"><span>Drink name (optional)</span><input id="ed-name" value="${esc(d.name || '')}" placeholder="e.g. Coconut Patrón Margarita" autocomplete="off"></label>
          <div class="sugg" id="ed-sugg" hidden></div>
          ${statusHTML()}
          ${d.open ? '' : finishedHTML() + amountHTML()}
          ${startHTML('Ordered')}
          <div class="field" id="ed-strength">${strengthHTML()}</div>
          <div class="field"><span>Where (optional)</span><div class="chips">${SPOTS.map(s => `<button class="chip" type="button" data-ed="where" data-v="${esc(s)}" aria-pressed="${d.where === s}">${esc(s)}</button>`).join('')}</div></div>
          <div class="field"><span>Order it again?</span><div class="chips"><button class="chip" type="button" data-ed="fav" aria-pressed="${!!d.fav}">${d.fav ? '♥ Yes, a favorite' : '♡ Mark as favorite'}</button></div></div>
        `}
        <label class="field" for="ed-note"><span>Note (optional)</span><textarea id="ed-note" placeholder="${isW ? 'e.g. after the gym' : 'e.g. less sweet next time'}">${esc(d.note || '')}</textarea></label>
        <p class="small" id="ed-err" style="color:var(--danger)" hidden></p>
        <div class="btn-row"><button class="btn navy" type="button" data-ed="save">${existing ? 'Save changes' : 'Add it'}</button>${existing ? `<button class="btn danger" type="button" data-ed="delete">${delArmed ? 'Tap again to delete' : 'Delete'}</button>` : ''}</div>`;
      const name = $('#ed-name', body);
      if (name) {
        name.addEventListener('input', () => { d.name = name.value; const r = stdFor(d.name); if (r != null) d.std = r; const sw = $('#ed-strength', body); if (sw) sw.innerHTML = strengthHTML(); showSugg(); });
        name.addEventListener('focus', showSugg);
      }
    };
    const readInputs = () => {
      const t = $('#ed-t', body), st = $('#ed-start', body), nt = $('#ed-note', body), nm = $('#ed-name', body);
      if (t && t.value) d.t = fromInput(t.value);
      if (st) d.start = st.value ? fromInput(st.value) : null;
      if (nt) d.note = nt.value.trim();
      if (nm) d.name = nm.value.trim();
    };
    function showSugg() {
      const box = $('#ed-sugg', body), nm = $('#ed-name', body); if (!box || !nm) return;
      const q = norm(nm.value);
      const recent = recentNames().map(e => ({ name: e.name, std: e.std, recent: true }));
      let list;
      if (!q) list = recent.slice(0, 5);
      else {
        const pool = recent.concat(CATALOG.map(c => ({ name: c.name, std: c.std })));
        const seen = new Set();
        list = pool.filter(c => { const n = norm(c.name); if (seen.has(n) || !n.includes(q) || n === q) return false; seen.add(n); return true; })
          .sort((a, b) => (norm(b.name).startsWith(q) - norm(a.name).startsWith(q)) || ((b.recent ? 1 : 0) - (a.recent ? 1 : 0)) || a.name.length - b.name.length).slice(0, 6);
      }
      box.hidden = !list.length;
      box.innerHTML = list.map(c => `<button type="button" data-ed="pick" data-name="${esc(c.name)}" data-std="${c.std}"><span>${esc(c.name)}</span><span>${c.recent && !q ? 'recent · ' : ''}≈${fmt1(+c.std || 1.5)}</span></button>`).join('');
    }
    body.addEventListener('click', ev => {
      const b = ev.target.closest('[data-ed]'); if (!b) return;
      const a = b.dataset.ed;
      if (a !== 'delete') delArmed = 0;
      if (a === 'save') {
        readInputs();
        const err = $('#ed-err', body);
        if (!d.t || isNaN(d.t)) { err.textContent = 'Pick a time for this entry.'; err.hidden = false; return; }
        if (d.start && !d.open && d.start > d.t) { err.textContent = `The ${d.kind === 'water' ? 'started' : 'ordered'} time is after the finished time. Fix one of them.`; err.hidden = false; return; }
        if (d.open && !d.start) d.start = d.t;
        if (d.open) { d.t = d.start; delete d.part; }
        if (!(d.part > 0 && d.part < 1)) delete d.part;
        if (d.kind === 'water') { delete d.std; delete d.where; delete d.fav; delete d.name; if (!d.start) delete d.start; if (!d.open) delete d.open; }
        else { delete d.unit; delete d.ml; }
        const i = E.findIndex(e => e.id === d.id);
        if (i >= 0) E[i] = d; else E.push(d);
        saveE();
        if (!existing) sel = dayKey(d.t);
        closeTop();
        toast(existing ? 'Saved' : `Added to ${dayName(dayKey(d.t))}`);
        return;
      }
      if (a === 'delete') {
        if (!delArmed) { delArmed = 1; b.textContent = 'Tap again to delete'; return; }
        const gone = existing;
        E = E.filter(e => e.id !== d.id); saveE(); closeTop();
        toast('Entry deleted', [['Undo', () => { E.push(gone); saveE(); render(); }]]);
        return;
      }
      readInputs();
      if (a === 'kind') d.kind = b.dataset.v;
      else if (a === 'p') d.p = +b.dataset.v;
      else if (a === 'unit') { d.unit = b.dataset.v; d.ml = WATER[d.unit][1]; }
      else if (a === 'now') d.t = Date.now();
      else if (a === 'start-now') d.start = Date.now();
      else if (a === 'start-clear') d.start = null;
      else if (a === 'open') { d.open = b.dataset.v === '1'; if (d.open) { d.start = d.start || d.t; } else if (!existing || existing.open) d.t = Date.now(); }
      else if (a === 'std') d.std = +b.dataset.v;
      else if (a === 'part') d.part = +b.dataset.v;
      else if (a === 'where') d.where = d.where === b.dataset.v ? '' : b.dataset.v;
      else if (a === 'fav') d.fav = !d.fav;
      else if (a === 'pick') { d.name = b.dataset.name; const s = +b.dataset.std; if (s) d.std = s; }
      draw();
    });
    draw();
    if (opts.focusName) { const n = $('#ed-name', body); if (n) try { n.focus(); } catch (e) { /* ignore */ } }
  }

  // ---------- day picker ----------
  function openDays() {
    const keys = new Set();
    for (let i = 0; i < (+S.days || 0); i++) keys.add(keyAt(i));
    E.forEach(e => keys.add(dayKey(e.t)));
    const cur = curKey();
    const list = [...keys].filter(k => k <= cur || forDay(k).length).sort();
    if (!list.includes(cur)) list.push(cur);
    const vis = visibleIdx();
    openOverlay(`<div class="panel" role="dialog" aria-modal="true" aria-labelledby="dp-title">
      <div class="panel-bar"><h2 id="dp-title">Pick a day</h2><button class="icon-btn" type="button" data-act="close" aria-label="Close">${I.x}</button></div>
      <div class="daylist">${list.map(k => {
        const items = forDay(k), st = stats(items);
        const who = vis.length > 1 ? vis.map(p => `${nameOf(p)} ${fmtQ(stats(byPerson(items, p)).drinks)}`).join(' · ') : '';
        return `<button type="button" data-act="pickday" data-k="${k}" aria-current="${k === sel}"><b>${esc(dayName(k))}${k === cur ? ' · Today' : ''}</b><span class="tot"><b>${fmtQ(st.drinks)}</b> ${many(st.drinks, 'drink', 'drinks')}<br>${fmtQ(st.waters)} water</span><span>${esc(dateLabel(k))}${portOf(k) ? ' · ' + esc(portOf(k)) : ''}${who ? ' · ' + esc(who) : ''}</span></button>`;
      }).join('')}</div>
    </div>`);
  }

  // ---------- TRIP ----------
  const tripFilt = list => tripWho < 0 ? list : byPerson(list, tripWho);
  function tripDays() {
    const out = [];
    for (let i = 0; i < (+S.days || 0); i++) out.push(keyAt(i));
    return out;
  }
  function renderTrip() {
    const days = tripDays();
    const cur = curKey();
    const whoList = shownIn(tripEntries());
    if (tripWho >= 0 && !whoList.includes(tripWho)) tripWho = -1;
    const filt = tripFilt;
    const all = filt(tripEntries());
    const st = stats(all);
    const elapsed = Math.max(1, Math.min(days.length, dayIndex(cur) + 1));
    const ratio = st.drinks ? st.waters / st.drinks : 0;
    const names = {}, spots = {}, favs = {};
    all.filter(e => e.kind === 'drink').forEach(e => {
      if (e.name) names[e.name] = (names[e.name] || 0) + 1;
      if (e.where) spots[e.where] = (spots[e.where] || 0) + 1;
      if (e.fav && e.name) favs[e.name] = (favs[e.name] || 0) + 1;
    });
    const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const tableRows = days.map((k, i) => {
      const s = stats(filt(forDay(k)));
      const future = k > cur;
      return `<tr class="click ${k === cur ? 'today' : ''} ${future ? 'future' : ''}" data-act="pickday" data-k="${k}" tabindex="0"><td>Day ${i + 1} · ${esc(dateLabel(k, { month: 'short', day: 'numeric' }))}${portOf(k) ? `<br><span class="muted small">${esc(portOf(k))}</span>` : ''}</td><td>${future ? '–' : fmtQ(s.drinks)}</td><td>${future ? '–' : fmt1(s.std)}</td><td>${future ? '–' : fmtQ(s.waters)}</td></tr>`;
    }).join('');
    const pkg = +S.pkg || 0, price = +S.price || 0;
    const outside = E.filter(e => !inTrip(dayKey(e.t))).length;
    $('#v-trip').innerHTML = `
      <div class="section-head"><h2 style="font-family:var(--font-display);font-weight:400;font-size:26px">${esc(S.days)}-day cruise</h2><span class="muted small">${esc(dateLabel(days[0] || cur, { month: 'short', day: 'numeric' }))} – ${esc(dateLabel(days[days.length - 1] || cur, { month: 'short', day: 'numeric' }))}</span></div>
      ${whoList.length > 1 ? `<div class="chips" role="group" aria-label="Show">${[[-1, 'Everyone']].concat(whoList.map(p => [p, labelOf(p)])).map(([v, l]) => `<button class="chip" type="button" data-act="tripwho" data-v="${v}" aria-pressed="${tripWho === v}">${esc(l)}</button>`).join('')}</div>` : ''}
      <div class="stats">
        <div class="stat"><span class="k">Drinks</span><span class="v">${fmtQ(st.drinks)}</span><span class="d">${fmt1(st.drinks / elapsed)} a day so far</span></div>
        <div class="stat"><span class="k">Standard drinks</span><span class="v">≈${fmt1(st.std)}</span><span class="d">${fmt1(st.std / elapsed)} a day</span></div>
        <div class="stat"><span class="k">Water</span><span class="v">${fmtQ(st.waters)}</span><span class="d">${st.ml ? volume(st.ml) : 'none yet'}</span></div>
        <div class="stat"><span class="k">Water per drink</span><span class="v">${st.drinks ? fmt1(ratio) : '–'}</span><span class="d">${st.drinks ? (ratio >= 1 ? 'At least one each. Nice.' : 'Aim for one per drink') : 'Log a drink to see this'}</span></div>
      </div>
      <section class="card" aria-label="Drinks and water by day">
        <div class="section-head"><h2>Drinks and water by day</h2><div class="legend"><span><i class="sw drink"></i>Drinks</span><span><i class="sw water"></i>Water</span></div></div>
        <div class="chartbox" id="tripchart"></div>
        <div class="tablewrap"><table class="sumtable" aria-label="Totals by day"><thead><tr><th>Day</th><th>Drinks</th><th>≈ Std</th><th>Water</th></tr></thead><tbody>${tableRows}</tbody></table></div>
        <p class="muted small">Tap a day to open its log.${outside ? ` ${outside} entr${outside === 1 ? 'y is' : 'ies are'} outside the cruise dates; adjust Day 1 in Settings if that's wrong.` : ''}</p>
      </section>
      ${Object.keys(favs).length ? `<section class="card"><h2 style="font-size:18px">Favorites ♥</h2><div class="list">${top(favs).map(([n, c]) => `<div><span>${esc(n)}</span><span>×${c}</span></div>`).join('')}</div></section>` : ''}
      ${Object.keys(names).length ? `<section class="card"><h2 style="font-size:18px">Most ordered</h2><div class="list">${top(names).map(([n, c]) => `<div><span>${esc(n)}</span><span>×${c}</span></div>`).join('')}</div></section>` : ''}
      ${Object.keys(spots).length ? `<section class="card"><h2 style="font-size:18px">Favorite spots</h2><div class="list">${top(spots).map(([n, c]) => `<div><span>${esc(n)}</span><span>×${c}</span></div>`).join('')}</div></section>` : ''}
      ${pkg ? `<section class="card"><h2 style="font-size:18px">Drink package value</h2><div class="list">${whoList.map(p => { const s = stats(byPerson(tripEntries(), p)); const value = s.orders * price, paid = pkg * elapsed; return `<div><span>${esc(nameOf(p))}: ≈${money(value)} of drinks</span><span>${money(paid)} paid so far</span></div>`; }).join('')}</div><p class="muted small">Uses ${money(price)} per drink and ${money(pkg)} per day, both editable in Settings.</p></section>` : ''}
      <div class="btn-row"><button class="btn" type="button" data-act="copy-trip">${I.copy}Copy trip summary</button><button class="btn" type="button" data-go="stats">See fun stats</button></div>
      ${backupNudge()}`;
    drawTripChart(days, filt, cur);
  }
  function niceStep(max) { const raw = max / 4; const p = Math.pow(10, Math.floor(Math.log10(raw || 1))); const f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
  function barPath(x, y, w, h, y0) {
    if (h <= 0) return '';
    const r = Math.min(4, h, w / 2);
    return `M${x} ${y0}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y0}Z`;
  }
  function chartTips(box, data, fmt, W) {
    const tip = box.querySelector('.tip');
    const show = el => {
      const lines = fmt(data[+el.dataset.i]);
      tip.textContent = '';
      const st = document.createElement('strong'); st.textContent = lines[0]; tip.appendChild(st);
      lines.slice(1).forEach(([c, txt]) => { const ln = document.createElement('div'); const key = document.createElement('span'); key.className = 'key'; key.style.background = `var(--${c})`; ln.appendChild(key); ln.appendChild(document.createTextNode(txt)); tip.appendChild(ln); });
      tip.style.left = Math.min(Math.max(+el.dataset.tipX, 70), W - 70) + 'px';
      tip.style.top = el.dataset.tipY + 'px';
      tip.hidden = false;
    };
    $$('[data-tip-x]', box).forEach(el => {
      el.addEventListener('pointerenter', () => show(el));
      el.addEventListener('pointerleave', () => { tip.hidden = true; });
      el.addEventListener('focus', () => show(el));
      el.addEventListener('blur', () => { tip.hidden = true; });
    });
  }
  function drawTripChart(days, filt, cur) {
    const box = $('#tripchart'); if (!box || !days.length) return;
    const data = days.map(k => { const s = stats(filt(forDay(k))); return { k, d: s.drinks, w: s.waters }; });
    const W = Math.max(260, box.clientWidth || 340), H = 190;
    const left = 30, right = 6, top = 16, bottom = 30;
    const maxV = Math.max(4, ...data.map(v => Math.max(v.d, v.w)));
    const step = Math.max(1, niceStep(maxV));
    const yMax = Math.ceil(maxV / step) * step;
    const pw = W - left - right, ph = H - top - bottom;
    const band = pw / data.length;
    const bw = Math.max(3, Math.min(24, (band - 8) / 2));
    const y = v => top + ph - v / yMax * ph;
    const y0 = top + ph;
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Drinks and water per cruise day">`;
    for (let v = 0; v <= yMax; v += step) s += `<line class="grid-l" x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}"/><text class="axis-t" x="${left - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    const maxD = Math.max(...data.map(v => v.d));
    data.forEach((v, i) => {
      const cx = left + band * i + band / 2;
      const xd = cx - bw - 1, xw = cx + 1;
      s += `<g class="hitg"><rect class="hit" x="${left + band * i}" y="${top}" width="${band}" height="${ph + bottom}" tabindex="0" role="button" aria-label="${esc(`Day ${i + 1}: ${fmtQ(v.d)} drinks, ${fmtQ(v.w)} water`)}" data-act="pickday" data-k="${v.k}" data-tip-x="${cx}" data-tip-y="${Math.min(y(Math.max(v.d, v.w)), y0 - 10)}" data-i="${i}"/>`;
      s += `<path class="mk" d="${barPath(xd, y(v.d), bw, y0 - y(v.d), y0)}" fill="var(--drink)"/><path class="mk" d="${barPath(xw, y(v.w), bw, y0 - y(v.w), y0)}" fill="var(--water)"/></g>`;
      if (v.d && v.d === maxD) s += `<text class="bar-label" x="${xd + bw / 2}" y="${y(v.d) - 5}" text-anchor="middle">${fmtQ(v.d)}</text>`;
      s += `<text class="axis-t" x="${cx}" y="${H - 12}" text-anchor="middle" style="${v.k === cur ? 'font-weight:700;fill:var(--ink)' : ''}">${i + 1}</text>`;
    });
    s += `<text class="axis-t" x="${left + pw / 2}" y="${H}" text-anchor="middle">Cruise day</text>`;
    s += `<line x1="${left}" x2="${W - right}" y1="${y0}" y2="${y0}" stroke="var(--muted)" stroke-width="1"/>`;
    s += '</svg><div class="tip" hidden></div>';
    box.innerHTML = s;
    chartTips(box, data, v => [`${dayName(v.k)} · ${dateLabel(v.k, { month: 'short', day: 'numeric' })}`, ['drink', `${fmtQ(v.d)} ${many(v.d, 'drink', 'drinks')}`], ['water', `${fmtQ(v.w)} water`]], W);
  }
  function tripText() {
    const days = tripDays(), cur = curKey(), who = shownIn(tripEntries());
    const lines = [`Sip Log · ${S.days}-day cruise`];
    days.forEach((k, i) => {
      if (k > cur) return;
      const items = forDay(k);
      const parts = who.map(p => { const s = stats(byPerson(items, p)); return `${who.length > 1 ? nameOf(p) + ' ' : ''}${fmtQ(s.drinks)} ${many(s.drinks, 'drink', 'drinks')}, ${fmtQ(s.waters)} water`; });
      lines.push(`Day ${i + 1} (${dateLabel(k, { month: 'short', day: 'numeric' })}${portOf(k) ? ', ' + portOf(k) : ''}): ${parts.join(' · ')}`);
    });
    who.forEach(p => { const s = stats(byPerson(tripEntries(), p)); lines.push('', `${labelOf(p)} total: ${fmtQ(s.drinks)} ${many(s.drinks, 'drink', 'drinks')} (≈${fmt1(s.std)} std), ${fmtQ(s.waters)} water (${volume(s.ml)})`); });
    return lines.join('\n');
  }
  function backupNudge() {
    if (!E.length) return '';
    const days = S.lastBackup ? Math.floor((Date.now() - S.lastBackup) / 864e5) : null;
    if (days !== null && days < 2) return '';
    return `<p class="nudge">Your log lives only on this phone. ${days === null ? 'Copy a backup code now and then' : `Last backup was ${days} days ago`} (Settings, Backup) so nothing is lost if the browser is cleared.</p>`;
  }

  // ---------- STATS: awards and fun numbers ----------
  const minsIntoDay = ts => (ts - dayStart(dayKey(ts))) / 60000;
  const clockOf = m => fmtTime(dayStart(curKey()) + m * 60000);
  const LANDMARKS = [['a front door', 2], ['a basketball hoop', 3.05], ['a giraffe', 5.5], ['a 10-meter diving board', 10], ['a five-story building', 16], ['a ten-story building', 30], ['the Statue of Liberty', 46], ['Big Ben', 96]];
  function computeStats(scope) {
    const pool = scope === 'today' ? forDay(curKey()) : tripEntries();
    const who = shownIn(pool);
    const per = who.map(p => {
      const mine = byPerson(pool, p);
      const drinks = mine.filter(e => e.kind === 'drink'), done = drinks.filter(e => !e.open), waters = mine.filter(e => e.kind === 'water');
      const timed = done.filter(e => e.start && e.t - e.start >= 2 * 60000);
      const nameCount = {}, spotCount = {};
      drinks.forEach(e => { if (e.name) { const n = e.name.trim(); nameCount[n] = (nameCount[n] || 0) + 1; } if (e.where) spotCount[e.where] = (spotCount[e.where] || 0) + 1; });
      const topName = Object.entries(nameCount).sort((a, b) => b[1] - a[1])[0];
      const topSpot = Object.entries(spotCount).sort((a, b) => b[1] - a[1])[0];
      const latest = done.reduce((m, e) => !m || minsIntoDay(e.t) > minsIntoDay(m.t) ? e : m, null);
      const firstByDay = {};
      done.forEach(e => { const k = dayKey(e.t); if (!firstByDay[k] || e.t < firstByDay[k].t) firstByDay[k] = e; });
      const earliest = Object.values(firstByDay).reduce((m, e) => !m || minsIntoDay(e.t) < minsIntoDay(m.t) ? e : m, null);
      let goalDays = 0, streak = 0, best = 0;
      const goal = +S.waterGoal || 0;
      const dayList = scope === 'today' ? [curKey()] : tripDays().filter(k => k <= curKey());
      dayList.forEach(k => {
        const n = waters.filter(e => dayKey(e.t) === k).reduce((a, e) => a + partOf(e), 0);
        if (goal && n >= goal) { goalDays++; streak++; best = Math.max(best, streak); } else streak = 0;
      });
      const dq = drinks.reduce((a, e) => a + partOf(e), 0), wq = waters.reduce((a, e) => a + partOf(e), 0);
      return {
        p, drinks: dq, waters: wq, std: drinks.reduce((a, e) => a + (+e.std || 0) * partOf(e), 0), ml: waters.reduce((a, e) => a + (+e.ml || 0) * partOf(e), 0),
        ratio: dq ? wq / dq : null,
        sip: timed.length >= 2 ? timed.reduce((a, e) => a + (e.t - e.start), 0) / timed.length / 60000 : null,
        unique: Object.keys(nameCount).length, topName, topSpot, latest, earliest, goalDays, bestStreak: best, days: dayList.length
      };
    });
    const awards = [];
    const pick = (list, val, better) => {
      const ok = list.filter(x => val(x) != null);
      if (!ok.length) return null;
      const bestV = ok.reduce((b, x) => b == null || better(val(x), b) ? val(x) : b, null);
      return { winners: ok.filter(x => val(x) === bestV), v: bestV };
    };
    const names = ws => joinNames(ws.map(w => labelOf(w.p)));
    const minDrinks = scope === 'today' ? 1 : 2;
    let r = pick(per.filter(x => x.drinks >= minDrinks && x.waters), x => Math.round(x.ratio * 10) / 10, (a, b) => a > b);
    if (r) awards.push(['💧', 'Hydration Hero', names(r.winners), `${fmt1(r.v)} ${r.v === 1 ? 'water' : 'waters'} per drink`]);
    // Night Owl needs a drink finished after 9 PM, Early Bird one before noon
    const cut = (+S.cutoff || 0) * 60, nightMin = 21 * 60 - cut, noonMin = 12 * 60 - cut;
    r = pick(per, x => x.latest && minsIntoDay(x.latest.t) >= nightMin ? Math.round(minsIntoDay(x.latest.t)) : null, (a, b) => a > b);
    if (r) awards.push(['🦉', 'Night Owl', names(r.winners), `Last drink finished at ${fmtTime(r.winners[0].latest.t)}${scope === 'trip' ? ' on ' + dayName(dayKey(r.winners[0].latest.t)) : ''}`]);
    r = pick(per, x => x.earliest && minsIntoDay(x.earliest.t) < noonMin ? Math.round(minsIntoDay(x.earliest.t)) : null, (a, b) => a < b);
    if (r) awards.push(['🌅', 'Early Bird', names(r.winners), `First drink at ${fmtTime(r.winners[0].earliest.t)}${scope === 'trip' ? ' on ' + dayName(dayKey(r.winners[0].earliest.t)) : ''}`]);
    const sippers = per.filter(x => x.sip != null);
    if (sippers.length) {
      r = pick(sippers, x => Math.round(x.sip), (a, b) => a > b);
      awards.push(['🐢', 'Slow Sipper', names(r.winners), `${fmtDur(r.v)} per timed drink`]);
    }
    r = pick(per.filter(x => x.unique >= 2), x => x.unique, (a, b) => a > b);
    if (r) awards.push(['🧭', 'Explorer', names(r.winners), `${r.v} different drinks tried`]);
    r = pick(per.filter(x => x.topName && x.topName[1] >= 2), x => x.topName[1], (a, b) => a > b);
    if (r) awards.push(['⚓', 'Creature of Habit', names(r.winners), new Set(r.winners.map(w => norm(w.topName[0]))).size === 1 ? `${r.winners[0].topName[0]} ×${r.v}` : `the same drink ${r.v} times each`]);
    r = pick(per.filter(x => x.topSpot && x.topSpot[1] >= 2), x => x.topSpot[1], (a, b) => a > b);
    if (r) { const ws = r.winners.filter(w => w.topSpot[0] === r.winners[0].topSpot[0]); awards.push(['🏝️', `${ws[0].topSpot[0]} Regular`, names(ws), `${r.v} drinks there`]); }
    if (+S.waterGoal) {
      r = pick(per.filter(x => x.goalDays > 0), x => x.goalDays, (a, b) => a > b);
      if (r) awards.push(['🎯', 'Goal Getter', names(r.winners), scope === 'today' ? `Hit the ${S.waterGoal}-water goal` : `Hit the water goal ${r.v} of ${r.winners[0].days} days${r.winners[0].bestStreak > 1 ? `, ${r.winners[0].bestStreak} in a row` : ''}`]);
    }
    // group tally
    const drinks = pool.filter(e => e.kind === 'drink').sort((a, b) => a.t - b.t);
    let rounds = 0;
    for (let i = 0; i < drinks.length;) {
      let j = i + 1; const ps = new Set([drinks[i].p || 0]);
      while (j < drinks.length && drinks[j].t - drinks[i].t <= 10 * 60000) { ps.add(drinks[j].p || 0); j++; }
      if (ps.size >= 2) rounds++;
      i = j;
    }
    const hours = Array(24).fill(0);
    drinks.forEach(e => { hours[((Math.floor(minsIntoDay(e.t) / 60) % 24) + 24) % 24] += partOf(e); });
    const peakH = hours.indexOf(Math.max(...hours));
    const groupNames = {};
    drinks.forEach(e => { if (e.name) groupNames[e.name] = (groupNames[e.name] || 0) + 1; });
    const fav = Object.entries(groupNames).sort((a, b) => b[1] - a[1])[0];
    let busiest = null;
    const amount = list => list.reduce((a, e) => a + partOf(e), 0);
    if (scope === 'trip') tripDays().forEach(k => { const n = amount(drinks.filter(e => dayKey(e.t) === k)); if (n && (!busiest || n > busiest[1])) busiest = [k, n]; });
    const timed = drinks.filter(e => !e.open && e.start && e.t - e.start >= 2 * 60000);
    const totalMl = pool.filter(e => e.kind === 'water').reduce((a, e) => a + (+e.ml || 0) * partOf(e), 0);
    const height = totalMl / 500 * 0.22;
    const landmark = LANDMARKS.filter(l => height >= l[1]).pop();
    let seaPort = null;
    if (scope === 'trip') {
      const sea = [], port = [];
      tripDays().filter(k => k <= curKey()).forEach(k => { const name = portOf(k); if (!name) return; const n = amount(drinks.filter(e => dayKey(e.t) === k)); (/\bsea\b/i.test(name) ? sea : port).push(n); });
      if (sea.length && port.length) seaPort = [sea.reduce((a, b) => a + b, 0) / sea.length, port.reduce((a, b) => a + b, 0) / port.length];
    }
    return { per, awards, drinks: amount(drinks), std: drinks.reduce((a, e) => a + (+e.std || 0) * partOf(e), 0), waters: amount(pool.filter(e => e.kind === 'water')), totalMl, rounds, hours, peakH, fav, busiest, timedAvg: timed.length ? timed.reduce((a, e) => a + (e.t - e.start), 0) / timed.length / 60000 : null, height, landmark, seaPort };
  }
  function renderStats() {
    const c = computeStats(statsScope);
    const multi = c.per.length > 1;
    const facts = [];
    if (c.drinks) facts.push(['Drinks', fmtQ(c.drinks), `≈${fmt1(c.std)} standard drinks`]);
    if (c.waters) facts.push(['Water', fmtQ(c.waters), volume(c.totalMl)]);
    if (multi) facts.push(['Rounds together', `${c.rounds}`, 'drinks within 10 minutes of each other']);
    if (c.drinks) facts.push(['Busiest hour', `${hourLabel(c.peakH + (+S.cutoff || 0))}`, `${fmtQ(c.hours[c.peakH])} ${many(c.hours[c.peakH], 'drink', 'drinks')} between ${hourLabel(c.peakH + (+S.cutoff || 0))} and ${hourLabel(c.peakH + (+S.cutoff || 0) + 1)}`]);
    if (c.busiest) facts.push(['Busiest day', dayName(c.busiest[0]), `${fmtQ(c.busiest[1])} ${many(c.busiest[1], 'drink', 'drinks')}${portOf(c.busiest[0]) ? ' · ' + portOf(c.busiest[0]) : ''}`]);
    if (c.fav) facts.push([multi ? 'Group favorite' : 'Your favorite', c.fav[0], `ordered ${c.fav[1]} time${c.fav[1] > 1 ? 's' : ''}`]);
    if (c.timedAvg != null) facts.push(['Average sip time', fmtDur(c.timedAvg), 'from order to empty glass']);
    if (c.seaPort) facts.push(['Sea days vs. port days', `${fmt1(c.seaPort[0])} vs ${fmt1(c.seaPort[1])}`, 'average drinks per day']);
    $('#v-stats').innerHTML = `
      <div class="section-head"><h2 style="font-family:var(--font-display);font-weight:400;font-size:26px">Fun stats</h2></div>
      <div class="seg" role="group" aria-label="Period"><button type="button" data-act="scope" data-v="trip" aria-pressed="${statsScope === 'trip'}">Whole cruise</button><button type="button" data-act="scope" data-v="today" aria-pressed="${statsScope === 'today'}">Today</button></div>
      ${c.awards.length ? `<section aria-label="Awards"><div class="section-head" style="margin-bottom:10px"><h2>Awards</h2><span class="muted small">${multi ? 'Ties share the prize' : 'Personal bests'}</span></div><div class="awards">${c.awards.map(([em, title, winner, val]) => `<div class="award"><span class="medal" aria-hidden="true">${em}</span><div><p class="aw-t">${esc(title)}</p><p class="aw-w">${esc(winner)}</p><p class="aw-v">${esc(val)}</p></div></div>`).join('')}</div></section>` : `<div class="empty card"><p>Awards show up once a few drinks and waters are logged.</p><p class="small">Name drinks, time a few with "Just ordered", and tag where you are to unlock more of them.</p></div>`}
      ${facts.length ? `<section class="card" aria-label="Ship's tally"><h2 style="font-size:18px">Ship's tally</h2><div class="facts">${facts.map(([k, v, d]) => `<div class="fact"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span><span class="d">${esc(d)}</span></div>`).join('')}</div>
        ${c.landmark ? `<p class="funfact">Stacked up, ${multi ? 'everyone\'s' : 'your'} water would make a tower of ${Math.round(c.totalMl / 500)} bottles about ${fmt1(c.height)} m (${Math.round(c.height * 3.281)} ft) tall, taller than ${esc(c.landmark[0])}.</p>` : ''}</section>` : ''}
      ${c.drinks ? `<section class="card" aria-label="When the drinks happen"><div class="section-head"><h2>When the drinks happen</h2><span class="muted small">Drinks by hour</span></div><div class="chartbox" id="hourchart"></div>
        <details><summary class="small">See the numbers</summary><div class="tablewrap"><table class="sumtable"><thead><tr><th>Hour</th><th>Drinks</th></tr></thead><tbody>${c.hours.map((n, i) => n ? `<tr><td>${hourLabel(i + (+S.cutoff || 0))}–${hourLabel(i + (+S.cutoff || 0) + 1)}</td><td>${fmtQ(n)}</td></tr>` : '').join('')}</tbody></table></div></details></section>` : ''}
      ${c.per.length ? `<section class="card" aria-label="Leaderboard"><h2 style="font-size:18px">${multi ? 'Side by side' : 'Your numbers'}</h2>
        <div class="tablewrap"><table class="sumtable"><thead><tr><th>Who</th><th>Drinks</th><th>≈ Std</th><th>Water</th><th>W/D</th></tr></thead><tbody>${c.per.map(x => `<tr><td>${esc(labelOf(x.p))}${x.topName ? `<br><span class="muted small">Signature: ${esc(x.topName[0])}</span>` : ''}</td><td>${fmtQ(x.drinks)}</td><td>${fmt1(x.std)}</td><td>${fmtQ(x.waters)}</td><td>${x.ratio != null ? fmt1(x.ratio) : '–'}</td></tr>`).join('')}</tbody></table></div>
        <p class="muted small">W/D is waters per drink. One or more is the goal.</p></section>` : ''}
      <div class="btn-row"><button class="btn" type="button" data-act="copy-stats">${I.copy}Copy for the group chat</button></div>`;
    if (c.drinks) drawHours(c.hours);
  }
  function drawHours(hours) {
    const box = $('#hourchart'); if (!box) return;
    const W = Math.max(260, box.clientWidth || 340), H = 150, left = 26, right = 6, top = 14, bottom = 24;
    const maxV = Math.max(2, ...hours), step = Math.max(1, niceStep(maxV)), yMax = Math.ceil(maxV / step) * step;
    const pw = W - left - right, ph = H - top - bottom, band = pw / 24, bw = Math.max(2, Math.min(24, band - 2));
    const y = v => top + ph - v / yMax * ph, y0 = top + ph;
    const cut = +S.cutoff || 0;
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Drinks by hour of the day">`;
    for (let v = 0; v <= yMax; v += step) s += `<line class="grid-l" x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}"/><text class="axis-t" x="${left - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    const peak = Math.max(...hours);
    const data = hours.map((n, i) => ({ n, i }));
    hours.forEach((n, i) => {
      const x = left + band * i + (band - bw) / 2;
      s += `<g class="hitg"><rect class="hit" x="${left + band * i}" y="${top}" width="${band}" height="${ph}" tabindex="0" role="img" aria-label="${esc(`${hourLabel(i + cut)}: ${fmtQ(n)} drinks`)}" data-tip-x="${x + bw / 2}" data-tip-y="${Math.min(y(n), y0 - 10)}" data-i="${i}"/><path class="mk" d="${barPath(x, y(n), bw, y0 - y(n), y0)}" fill="var(--drink)"/></g>`;
      if (n && n === peak) s += `<text class="bar-label" x="${x + bw / 2}" y="${y(n) - 5}" text-anchor="middle">${fmtQ(n)}</text>`;
      const clock = (i + cut) % 24;
      if (clock % 4 === 0) s += `<text class="axis-t" x="${left + band * i}" y="${H - 6}" text-anchor="middle">${clock === 0 ? '12a' : clock === 12 ? '12p' : clock < 12 ? clock + 'a' : (clock - 12) + 'p'}</text>`;
    });
    s += `<line x1="${left}" x2="${W - right}" y1="${y0}" y2="${y0}" stroke="var(--muted)" stroke-width="1"/></svg><div class="tip" hidden></div>`;
    box.innerHTML = s;
    chartTips(box, data, v => [`${hourLabel(v.i + cut)}–${hourLabel(v.i + cut + 1)}`, ['drink', `${fmtQ(v.n)} ${many(v.n, 'drink', 'drinks')}`]], W);
  }
  function statsText() {
    const c = computeStats(statsScope);
    const lines = [`Sip Log ${statsScope === 'today' ? 'awards for ' + dayName(curKey()) : 'cruise awards'} 🏆`];
    c.awards.forEach(([em, title, winner, val]) => lines.push(`${em} ${title}: ${winner} (${val})`));
    if (c.per.length > 1 && c.rounds) lines.push(`🥂 Rounds together: ${c.rounds}`);
    if (c.fav) lines.push(`🍹 Favorite: ${c.fav[0]} ×${c.fav[1]}`);
    if (c.landmark) lines.push(`💧 Water tower: ${Math.round(c.totalMl / 500)} bottles, taller than ${c.landmark[0]}`);
    return lines.join('\n');
  }

  // ---------- SETTINGS ----------
  function portsHTML() {
    const out = [];
    for (let i = 0; i < (+S.days || 0); i++) out.push(`<label for="port-${i}">Day ${i + 1} · ${esc(dateLabel(keyAt(i), { month: 'short', day: 'numeric' }))}<input id="port-${i}" data-set="port" data-i="${i}" value="${esc(S.ports[i] || '')}" placeholder="${i === 0 ? 'e.g. Barcelona' : 'Port or Sea day'}" maxlength="28"></label>`);
    return out.join('');
  }
  function refreshPorts() { const box = $('#v-settings .ports'); if (!box) return; box.innerHTML = portsHTML(); bindSettings(box); }
  function renderSettings() {
    $('#v-settings').innerHTML = `
      <h2 style="font-family:var(--font-display);font-weight:400;font-size:26px">Settings</h2>
      <div class="settings">
        <section class="card"><h3>People</h3>
          <div class="plist">${S.people.map((x, p) => `<div class="prow ${x.hidden ? 'off' : ''}"><span class="pname">${esc(labelOf(p))}${x.hidden ? ' <span class="muted small">(hidden)</span>' : ''}</span><span class="btn-row">${x.hidden ? `<button class="btn small" type="button" data-act="person-show" data-p="${p}">Show again</button>` : `<button class="btn small" type="button" data-act="person-edit" data-p="${p}">${I.pencil}Edit</button>`}</span></div>`).join('')}</div>
          ${canAdd() ? `<div class="btn-row"><button class="btn small" type="button" data-act="person-new">${I.person}Add a person</button></div>` : ''}
          <p class="muted small">Track up to ${MAX_PEOPLE} people on one phone. Tap a name on the Log screen to rename someone or give them an emoji. Each of you can also install Sip Log on your own phone and merge logs with a backup code.</p>
        </section>
        <section class="card"><h3>Your cruise</h3>
          <div class="grid2">
            <label class="field" for="set-start"><span>Day 1 (boarding day)</span><input id="set-start" type="date" data-set="start" value="${esc(S.start)}"></label>
            <label class="field" for="set-days"><span>Length (days)</span><input id="set-days" type="number" min="1" max="60" inputmode="numeric" data-set="days" value="${esc(S.days)}"></label>
            <label class="field" for="set-cutoff"><span>A new day starts at</span><select id="set-cutoff" data-set="cutoff">${[0, 2, 3, 4, 5, 6].map(h => `<option value="${h}" ${+S.cutoff === h ? 'selected' : ''}>${fmtHour(h)}</option>`).join('')}</select></label>
          </div>
          <p class="field" style="font-weight:600;margin-top:4px">Ports and sea days (optional)</p>
          <div class="ports">${portsHTML()}</div>
          <p class="muted small">Type "Sea day" for days at sea and Fun stats will compare sea days with port days.</p>
        </section>
        <section class="card"><h3>Water</h3>
          <div class="grid2">
            <label class="field" for="set-unit"><span>The + Water button adds a</span><select id="set-unit" data-set="unit">${Object.entries(WATER).map(([k, [l, ml, oz]]) => `<option value="${k}" ${S.waterUnit === k ? 'selected' : ''}>${l} (${ml} ml · ${oz})</option>`).join('')}</select></label>
            <label class="field" for="set-goal"><span>Daily water goal (count)</span><input id="set-goal" type="number" min="0" max="30" inputmode="numeric" data-set="goal" value="${esc(S.waterGoal)}"></label>
          </div>
        </section>
        <section class="card"><h3>Drinks</h3>
          <div class="field"><span>When you tap + Drink</span><div class="seg" role="group" aria-label="When you tap + Drink"><button type="button" data-act="ask-drink" data-v="1" aria-pressed="${S.askDrink !== false}">Show my drink list</button><button type="button" data-act="ask-drink" data-v="0" aria-pressed="${S.askDrink === false}">Log it right away</button></div></div>
          <label class="field" for="set-limit"><span>Personal daily drink limit (optional)</span><input id="set-limit" type="number" min="0" max="40" inputmode="numeric" data-set="limit" value="${esc(S.limit)}" placeholder="No limit"></label>
          <p class="muted small">Shows a /N next to the drink count and a bar that turns red past your number. Leave blank to hide it.</p>
          <div class="grid2">
            <label class="field" for="set-pkg"><span>Drink package, per person per day ($)</span><input id="set-pkg" inputmode="decimal" data-set="pkg" value="${esc(S.pkg)}" placeholder="Optional"></label>
            <label class="field" for="set-price"><span>Typical drink price ($)</span><input id="set-price" inputmode="decimal" data-set="price" value="${esc(S.price)}"></label>
          </div>
        </section>
        <section class="card"><h3>Look</h3>
          <div class="seg" role="group" aria-label="Theme">${[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => `<button type="button" data-act="theme" data-v="${k}" aria-pressed="${S.theme === k}">${l}</button>`).join('')}</div>
        </section>
        <section class="card" id="backup"><h3>Backup and export</h3>
          <p class="muted small">Everything stays on this phone. A backup code moves the log to another phone, or merges a friend's log into yours. People are matched by name.${S.lastBackup ? ` Last backup: ${new Date(S.lastBackup).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.` : ''}</p>
          <div class="btn-row"><button class="btn small" type="button" data-act="backup">${I.copy}Copy backup code</button><button class="btn small" type="button" data-act="csv">${I.copy}Copy as spreadsheet (CSV)</button></div>
          <label class="field" for="restore"><span>Restore or merge a backup code</span><textarea id="restore" placeholder="Paste a backup code here"></textarea></label>
          <div class="btn-row"><button class="btn small" type="button" data-act="merge">Merge into my log</button><button class="btn small" type="button" data-act="replace">Replace my log</button></div>
          <div class="btn-row"><button class="btn small danger" type="button" data-act="wipe">Clear all entries</button></div>
        </section>
        <section class="card" id="offline"><h3>Keep it offline</h3>
          ${SITE ? `<p>Web link: <b style="word-break:break-all">${esc(SITE)}</b></p><div class="btn-row"><button class="btn small" type="button" data-act="copy-site">${I.copy}Copy link</button></div>` : ''}
          <p><b>iPhone:</b> open ${SITE ? 'the link' : 'the Sip Log link'} in Safari, tap Share, then Add to Home Screen. Open it once while online; after that it works in airplane mode. Always use the Home Screen icon, because it keeps its own saved log separate from Safari.</p>
          <p><b>Android:</b> open the link in Chrome, tap ⋮, then Install app. The downloaded .html file also works offline in Chrome.</p>
          <p class="muted small">Looking for drink recipes? <a href="${RECIPES_URL}" target="_blank" rel="noopener">Sip &amp; Sail</a> has 530 of them (opens online).</p>
        </section>
      </div>
      <p class="foot">Sip Log keeps a record, not medical advice. Standard drinks are estimates (0.6 oz of alcohol each).</p>`;
    bindSettings();
  }
  function bindSettings(root) {
    $$('[data-set]', root || $('#v-settings')).forEach(inp => {
      inp.addEventListener('change', () => {
        const t = inp.dataset.set, v = inp.value.trim();
        if (t === 'start') { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) S.start = v; }
        else if (t === 'days') { const n = Math.round(+v); if (n >= 1 && n <= 60) S.days = n; }
        else if (t === 'cutoff') S.cutoff = +v;
        else if (t === 'port') { S.ports[+inp.dataset.i] = v; }
        else if (t === 'unit') S.waterUnit = v;
        else if (t === 'goal') S.waterGoal = v === '' ? '' : Math.max(0, Math.round(+v) || 0);
        else if (t === 'limit') S.limit = v === '' ? '' : Math.max(0, Math.round(+v) || 0);
        else if (t === 'pkg') S.pkg = v.replace(/[^0-9.]/g, '');
        else if (t === 'price') { const n = parseFloat(v); if (!isNaN(n)) S.price = n; }
        saveS();
        if (['start', 'days', 'cutoff'].includes(t)) sel = curKey();
        if (t === 'start' || t === 'days') refreshPorts();
        toast('Saved');
      });
    });
  }
  function restore(mode) {
    const box = $('#restore');
    try {
      const d = JSON.parse(box.value);
      if (d.app !== 'siplog' || !Array.isArray(d.entries)) throw new Error('not a backup');
      if (mode === 'replace') {
        E = d.entries;
        if (d.settings) Object.assign(S, d.settings);
        normalizePeople();
        saveE(); saveS(); applyTheme(); box.value = '';
        toast('Log replaced from backup'); renderSettings(); return;
      }
      // merge: match people by name, add anyone new, skip entries already here
      const theirs = ((d.settings && d.settings.people) || []).map(x => typeof x === 'string' ? { name: x } : x);
      const map = {};
      let skipped = 0, added = 0;
      const slotFor = tp => {
        if (map[tp] != null) return map[tp];
        const nm = (theirs[tp] && theirs[tp].name) || `Person ${tp + 1}`;
        let i = S.people.findIndex(x => norm(x.name) === norm(nm));
        if (i < 0 && S.people.length < MAX_PEOPLE) { S.people.push({ name: nm, emoji: (theirs[tp] && theirs[tp].emoji) || '', hidden: false }); i = S.people.length - 1; }
        if (i >= 0 && S.people[i].hidden) S.people[i].hidden = false;
        map[tp] = i;
        return i;
      };
      const ids = new Set(E.map(e => e.id));
      d.entries.forEach(e => {
        if (ids.has(e.id)) return;
        const slot = slotFor(e.p || 0);
        if (slot < 0) { skipped++; return; }
        E.push(Object.assign({}, e, { p: slot })); added++;
      });
      saveE(); saveS(); box.value = '';
      toast(`Merged ${added} new entr${added === 1 ? 'y' : 'ies'}${skipped ? `, skipped ${skipped} (people limit reached)` : ''}`);
      renderSettings();
    } catch (e) { toast('That code didn\'t work. Copy the whole backup code and try again.'); }
  }
  function csv() {
    const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = [['Date', 'Cruise day', 'Port', 'Person', 'Type', 'Name', 'Finished amount', 'Started', 'Finished', 'Minutes', 'Std drinks', 'Water ml', 'Where', 'Favorite', 'Note']];
    E.slice().sort((a, b) => a.t - b.t).forEach(e => {
      const k = dayKey(e.t), part = partOf(e), isW = e.kind === 'water';
      rows.push([k, inTrip(k) ? dayIndex(k) + 1 : '', portOf(k), nameOf(e.p || 0), e.kind, isW ? '' : (e.name || ''), e.open ? 'still sipping' : part, e.start ? fmtTime(e.start) : '', e.open ? '' : fmtTime(e.t), e.start && !e.open ? Math.round((e.t - e.start) / 60000) : '', isW ? '' : Math.round((+e.std || 0) * part * 100) / 100, isW ? Math.round((+e.ml || 0) * part) : '', e.where || '', e.fav ? 'yes' : '', e.note || '']);
    });
    return rows.map(r => r.map(q).join(',')).join('\n');
  }

  // ---------- actions ----------
  let wipeArmed = 0;
  const ACT = {
    'add-drink': t => { const p = +t.dataset.p; if (S.askDrink === false) quickDrink(p); else openPicker(p, 'done'); },
    'add-water': t => quickWater(+t.dataset.p),
    'start-drink': t => { const p = +t.dataset.p; if (S.askDrink === false) startDrink(p); else openPicker(p, 'open'); },
    'start-water': t => startWater(+t.dataset.p),
    'ask-drink': t => { S.askDrink = t.dataset.v === '1'; saveS(); $$('[data-act="ask-drink"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === (S.askDrink ? '1' : '0')))); toast('Saved'); },
    again: t => again(+t.dataset.p, t.dataset.id),
    finish: t => finish(t.dataset.id, +t.dataset.part || 1),
    round: t => openRound(t.dataset.kind),
    edit: t => openEditor(t.dataset.id),
    'add-past': t => openEditor(null, { p: +t.dataset.p, day: sel }),
    'person-edit': t => openPerson(+t.dataset.p),
    'person-new': () => openPerson(null),
    'person-show': t => { const p = +t.dataset.p; S.people[p].hidden = false; saveS(); render(); toast(`${nameOf(p)} is back on the counters`); },
    close: () => closeTop(),
    prevday: () => { const { y, m, d } = parse(sel); sel = ymd(new Date(y, m - 1, d - 1, 12)); renderLog(); },
    nextday: () => { const { y, m, d } = parse(sel); const n = ymd(new Date(y, m - 1, d + 1, 12)); if (n <= curKey()) { sel = n; renderLog(); } },
    today: () => { sel = curKey(); renderLog(); },
    days: () => openDays(),
    pickday: t => { sel = t.dataset.k; if (stack.length) closeTop(); go('log'); },
    tlwho: t => { tlWho = +t.dataset.v; renderLog(); },
    'setup-save': () => {
      const st = $('#su-start').value, dd = Math.round(+$('#su-days').value);
      if (/^\d{4}-\d{2}-\d{2}$/.test(st)) S.start = st;
      if (dd >= 1 && dd <= 60) S.days = dd;
      const names = [0, 1, 2, 3].map(i => { const el = $('#su-p' + i); return el ? el.value.trim() : ''; });
      // blank fields drop that person; anyone who already logged something is hidden instead, so entries keep their owner
      const used = new Set(E.map(e => e.p || 0)), next = [], remap = {};
      for (let i = 0; i < Math.max(4, S.people.length); i++) {
        const old = S.people[i] || { name: '', emoji: '', hidden: false };
        let person = null;
        if (i >= 4) person = old;
        else if (names[i] || i === 0) person = { name: names[i] || old.name || 'Me', emoji: old.emoji || '', hidden: false };
        else if (used.has(i)) person = Object.assign({}, old, { name: old.name || `Person ${i + 1}`, hidden: true });
        if (person) { remap[i] = next.length; next.push(person); }
      }
      E.forEach(e => { const r = remap[e.p || 0]; if (r != null) e.p = r; });
      S.people = next;
      normalizePeople(); saveE();
      S.setupDone = true; saveS(); sel = curKey(); renderLog();
      toast(inTrip(curKey()) ? `Today is Day ${dayIndex(curKey()) + 1}. Happy sailing!` : 'Saved. Today is outside your cruise dates.');
    },
    'copy-day': () => copyText(dayText(sel), 'Day summary copied'),
    'copy-trip': () => copyText(tripText(), 'Trip summary copied'),
    'copy-stats': () => copyText(statsText(), 'Awards copied. Paste them into your group chat.'),
    scope: t => { statsScope = t.dataset.v; renderStats(); },
    tripwho: t => { tripWho = +t.dataset.v; renderTrip(); },
    theme: t => { S.theme = t.dataset.v; saveS(); applyTheme(); $$('[data-act="theme"]').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === S.theme)); },
    backup: () => { S.lastBackup = Date.now(); saveS(); copyText(JSON.stringify({ app: 'siplog', v: 2, settings: S, entries: E }), 'Backup code copied. Paste it somewhere safe, like Notes.'); },
    csv: () => copyText(csv(), 'Spreadsheet text copied. Paste it into Numbers, Excel or Sheets.'),
    merge: () => restore('merge'),
    replace: () => restore('replace'),
    wipe: t => {
      if (Date.now() - wipeArmed > 4000) { wipeArmed = Date.now(); t.textContent = 'Tap again to clear every entry'; return; }
      E = []; saveE(); t.textContent = 'Cleared'; toast('All entries cleared');
    },
    'copy-site': () => copyText(SITE, 'Link copied'),
    'offline-help': () => { go('settings'); setTimeout(() => { const o = $('#offline'); if (o) o.scrollIntoView({ block: 'start' }); }, 30); }
  };
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-go]');
    if (g) { while (stack.length) closeTop(); if (g.dataset.go === 'log' && view === 'log') sel = curKey(); go(g.dataset.go); return; }
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const fn = ACT[t.dataset.act];
    if (fn) fn(t, e);
  });
  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('svg [data-act], tr[data-act]')) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  });

  // live "x min ago" and sipping timers, and rolling over to a new day
  let lastCur = curKey();
  setInterval(() => {
    $$('[data-ago]').forEach(el => { el.textContent = ago(+el.dataset.ago); });
    $$('[data-dur]').forEach(el => { el.textContent = fmtDur((Date.now() - +el.dataset.dur) / 60000); });
    const c = curKey();
    if (c !== lastCur) { if (sel === lastCur) sel = c; lastCur = c; if (!stack.length && view === 'log') renderLog(); }
  }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || stack.length) return;
    const c = curKey(); if (c !== lastCur) { if (sel === lastCur) sel = c; lastCur = c; }
    if (view !== 'settings' && !(view === 'log' && !S.setupDone)) render();
  });
  // charts follow the screen width; only they are redrawn so nothing being typed is lost
  let rz, lastW = window.innerWidth;
  window.addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth;
      if (view === 'log') drawGlance(sel, forDay(sel));
      else if (view === 'trip') drawTripChart(tripDays(), tripFilt, curKey());
      else if (view === 'stats') { const c = computeStats(statsScope); if (c.drinks) drawHours(c.hours); }
    }, 200);
  });

  // ---------- offline status ----------
  function setStatus(state) {
    const el = $('#status'); if (!el) return;
    const map = { file: ['ok', 'Offline file'], ready: ['ok', 'Offline ready'], saving: ['', 'Saving offline…'], online: ['', 'Keep offline'] };
    const [cls, label] = map[state] || map.online;
    el.className = 'status-pill ' + cls;
    el.querySelector('span').textContent = label;
  }
  function initOffline() {
    let framed = false;
    try { framed = window.top !== window.self; } catch (e) { framed = true; }
    if (location.protocol === 'file:') { setStatus('file'); return; }
    if (!framed && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost') && document.querySelector('link[rel="manifest"]')) {
      setStatus(navigator.serviceWorker.controller ? 'ready' : 'saving');
      navigator.serviceWorker.register('sw.js').then(reg => {
        if (reg.active) setStatus('ready');
        navigator.serviceWorker.ready.then(() => setStatus('ready'));
      }).catch(() => setStatus('online'));
      return;
    }
    setStatus('online');
  }

  // ---------- boot ----------
  saveS();
  applyTheme();
  go('log');
  initOffline();
})();
