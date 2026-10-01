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
    people: ['Me', 'Partner'], start: '', days: 10, ports: [], cutoff: 4,
    waterUnit: 'bottle', waterGoal: 5, limit: '', pkg: '', price: 16,
    theme: 'auto', setupDone: false, lastBackup: 0
  }, store.get('settings', {}));
  let E = store.get('entries', []);
  if (!Array.isArray(E)) E = [];
  const saveS = () => store.set('settings', S);
  const saveE = () => store.set('entries', E);
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* ignore */ }

  const STRENGTHS = [['Light', 1, 'beer, wine, spritz'], ['Regular', 1.5, 'most cocktails'], ['Strong', 2, 'doubles, Long Islands']];
  const WATER = { glass: ['Glass', 240, '8 oz'], cup: ['Large cup', 355, '12 oz'], bottle: ['Bottle', 500, '16.9 oz'], liter: ['Liter', 1000, '33.8 oz'] };
  const SPOTS = ['Pool deck', 'Martini Bar', 'Sunset Bar', 'Lounge', 'Dinner', 'Show', 'Casino', 'Cabin', 'Ashore', 'Other'];

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
  const people = () => (S.people && S.people.length ? S.people : ['Me']).map((p, i) => p || `Person ${i + 1}`);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

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
    heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/></svg>'
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
  const byPerson = (list, p) => list.filter(e => (e.p || 0) === p);
  function stats(list) {
    const drinks = list.filter(e => e.kind === 'drink');
    const waters = list.filter(e => e.kind === 'water');
    const done = drinks.filter(e => !e.open).sort((a, b) => a.t - b.t);
    const first = done[0], last = done[done.length - 1];
    return {
      drinks: drinks.length, waters: waters.length,
      std: drinks.reduce((a, e) => a + (+e.std || 0), 0),
      ml: waters.reduce((a, e) => a + (+e.ml || 0), 0),
      first, last, open: drinks.filter(e => e.open).sort((a, b) => a.t - b.t),
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

  // ---------- overlays, toasts, clipboard ----------
  const layer = $('#layer');
  const stack = [];
  let ignorePop = 0;
  function openOverlay(html, opts) {
    opts = opts || {};
    const el = document.createElement('div');
    el.className = 'overlay';
    el.innerHTML = html;
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
  const VIEWS = ['log', 'trip', 'settings'];
  let view = 'log';
  let sel = curKey();
  let tripWho = -1;
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
    else renderSettings();
  }

  // ---------- LOG ----------
  function renderLog() {
    const k = sel, cur = curKey(), isToday = k === cur;
    const list = forDay(k);
    const ppl = people();
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
    <div class="people">${ppl.map((name, p) => tileHTML(name, p, byPerson(list, p), isToday, k)).join('')}</div>
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
  const fmtHour = h => { h = +h || 0; return h === 0 ? 'midnight' : h < 12 ? h + ' AM' : h === 12 ? 'noon' : (h - 12) + ' PM'; };

  function setupHTML() {
    return `<div class="setup">
      <p class="eyebrow">Set up your cruise</p>
      <h2>Which day is Day 1?</h2>
      <p>Pick the date you boarded so every day gets its cruise-day number. You can change this and add ports later in Settings.</p>
      <div class="grid2">
        <label class="field" for="su-start"><span>Day 1 (boarding day)</span><input id="su-start" type="date" value="${esc(S.start)}"></label>
        <label class="field" for="su-days"><span>Cruise length (days)</span><input id="su-days" type="number" min="1" max="60" inputmode="numeric" value="${esc(S.days)}"></label>
        <label class="field" for="su-p0"><span>Person 1</span><input id="su-p0" value="${esc(S.people[0] || '')}" placeholder="Me" maxlength="16"></label>
        <label class="field" for="su-p1"><span>Person 2 (optional)</span><input id="su-p1" value="${esc(S.people[1] || '')}" placeholder="Leave blank if just you" maxlength="16"></label>
      </div>
      <div class="btn-row"><button class="btn go" type="button" data-act="setup-save">Start logging</button></div>
    </div>`;
  }

  function tileHTML(name, p, list, isToday, k) {
    const st = stats(list);
    const goal = +S.waterGoal || 0, lim = +S.limit || 0;
    const open = st.open[st.open.length - 1];
    const ln = isToday ? lastNamed(p) : null;
    return `<div class="tile">
      <div class="who"><b>${esc(name)}</b>${st.std ? `<span class="muted small">≈${fmt1(st.std)} std</span>` : ''}</div>
      <div class="figs">
        <div class="fig drink"><span class="v">${st.drinks}${lim ? `<span class="of">/${lim}</span>` : ''}</span><span class="k"><i></i>${st.drinks === 1 ? 'drink' : 'drinks'}</span></div>
        <div class="fig water"><span class="v">${st.waters}${goal ? `<span class="of">/${goal}</span>` : ''}</span><span class="k"><i></i>water</span></div>
      </div>
      ${lim ? `<div class="meter drinkm ${st.drinks > lim ? 'over' : ''}" role="img" aria-label="${st.drinks} of ${lim} drinks"><i style="width:${Math.min(100, st.drinks / lim * 100)}%"></i></div>` : ''}
      ${goal ? `<div class="meter" role="img" aria-label="${st.waters} of ${goal} waters"><i style="width:${Math.min(100, st.waters / goal * 100)}%"></i></div>` : ''}
      ${open ? `<div class="sipping"><p>Sipping <b>${esc(open.name || 'a drink')}</b> · <span data-dur="${open.start || open.t}">${fmtDur((Date.now() - (open.start || open.t)) / 60000)}</span></p><button class="btn small" type="button" data-act="finish" data-id="${open.id}">${I.check}Finished</button></div>` : ''}
      ${isToday ? `
        <button class="big drink" type="button" data-act="add-drink" data-p="${p}">${I.plus}Drink</button>
        <button class="big water" type="button" data-act="add-water" data-p="${p}">${I.plus}Water</button>
        <div class="mini-row">
          <button class="mini" type="button" data-act="start-drink" data-p="${p}">${I.timer}<span>Just ordered</span></button>
          ${ln ? `<button class="mini" type="button" data-act="again" data-p="${p}" data-id="${ln.id}" title="Log another ${esc(ln.name)}">${I.again}<span>${esc(ln.name)}</span></button>` : ''}
        </div>` : `<button class="btn small" type="button" data-act="add-past" data-p="${p}">Add to ${esc(dayName(k))}</button>`}
      <p class="lastline">${st.last ? `Last drink ${fmtTime(st.last.t)}${isToday ? ` · <span data-ago="${st.last.t}">${ago(st.last.t)}</span>` : ''}` : 'No drinks yet'}${st.pace ? ` · one every ${fmtDur(st.pace)}` : ''}</p>
      ${isToday && st.drinks - st.waters >= 2 ? `<p class="nudge">${st.drinks - st.waters} drinks ahead of water. Time for a bottle?</p>` : ''}
    </div>`;
  }

  // Day at a glance: one row per person, drinks (circles) and water (diamonds) on a clock axis
  function drawGlance(k, list) {
    const box = $('#glance'); if (!box) return;
    const ppl = people();
    const W = Math.max(260, box.clientWidth || 340);
    const left = Math.min(84, Math.max(48, Math.max(...ppl.map(n => n.length)) * 7 + 10)), right = 12, top = 20, row = 34;
    const H = top + ppl.length * row + 8;
    const t0 = dayStart(k), t1 = t0 + 24 * 3600e3;
    const x = t => left + (t - t0) / (t1 - t0) * (W - left - right);
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Timeline of drinks and water for ${esc(dayName(k))}">`;
    for (let hr = 0; hr <= 24; hr++) {
      const clock = ((+S.cutoff || 0) + hr) % 24;
      if (clock % 4 !== 0) continue;
      const xx = x(t0 + hr * 3600e3);
      s += `<line class="grid-l" x1="${xx}" x2="${xx}" y1="${top - 4}" y2="${H - 6}"/><text class="axis-t" x="${xx}" y="${top - 8}" text-anchor="middle">${clock === 0 ? '12a' : clock === 12 ? '12p' : clock < 12 ? clock + 'a' : (clock - 12) + 'p'}</text>`;
    }
    ppl.forEach((name, p) => {
      const cy = top + p * row + row / 2;
      s += `<line class="grid-l" x1="${left}" x2="${W - right}" y1="${cy}" y2="${cy}"/><text class="axis-l" x="${left - 8}" y="${cy + 4}" text-anchor="end">${esc(name.length > 10 ? name.slice(0, 9) + '…' : name)}</text>`;
    });
    const now = Date.now();
    if (now > t0 && now < t1) s += `<line x1="${x(now)}" x2="${x(now)}" y1="${top - 4}" y2="${H - 6}" stroke="var(--ink)" stroke-width="1" opacity=".5"/>`;
    list.slice().sort((a, b) => a.t - b.t).forEach(e => {
      const cy = top + (e.p || 0) * row + row / 2, cx = x(Math.min(Math.max(e.t, t0), t1));
      const label = `${fmtTime(e.t)} · ${e.kind === 'water' ? 'Water' : (e.name || 'Drink')}${e.open ? ' (sipping)' : ''} · ${people()[e.p || 0]}`;
      const mark = e.kind === 'water'
        ? `<rect class="mk m-water" x="${cx - 4.5}" y="${cy - 4.5}" width="9" height="9" transform="rotate(45 ${cx} ${cy})"/>`
        : `<circle class="mk ${e.open ? 'm-open' : 'm-drink'}" cx="${cx}" cy="${cy}" r="5.5"/>`;
      s += `<g class="hitg"><circle class="hit" cx="${cx}" cy="${cy}" r="12" tabindex="0" role="button" aria-label="${esc(label)}" data-act="edit" data-id="${e.id}" data-tip-x="${cx}" data-tip-y="${cy - 8}"/>${mark}</g>`;
    });
    s += '</svg><div class="tip" hidden></div>';
    box.innerHTML = s;
    bindTips(box, el => {
      const e = E.find(x => x.id === el.dataset.id); if (!e) return null;
      return [fmtTime(e.t), `${e.kind === 'water' ? 'Water' : (e.name || 'Drink')}${e.open ? ', still sipping' : ''}`, people()[e.p || 0], e.kind === 'water' ? 'water' : 'drink'];
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
    const sorted = list.slice().sort((a, b) => b.t - a.t);
    const ppl = people();
    let rows = '';
    sorted.forEach((e, idx) => {
      if (idx > 0) {
        const gap = (sorted[idx - 1].t - e.t) / 60000;
        if (gap >= 1) rows += `<li class="tl-gap" aria-hidden="true">${fmtDur(gap)} later</li>`;
      }
      const isW = e.kind === 'water';
      const bits = [];
      if (!isW && e.start && !e.open) bits.push(`ordered ${fmtTime(e.start)} · ${fmtDur((e.t - e.start) / 60000)}`);
      if (e.open) bits.push(`started ${fmtTime(e.start || e.t)}`);
      if (isW) bits.push((WATER[e.unit] || ['Water'])[0].toLowerCase() + ' · ' + volume(e.ml || 0));
      if (e.where) bits.push(e.where);
      if (e.note) bits.push('“' + e.note + '”');
      rows += `<li><button class="tl-item" type="button" data-act="edit" data-id="${e.id}">
        <time datetime="${new Date(e.t).toISOString()}">${fmtTime(e.t)}</time>
        <span class="tl-ico ${isW ? 'water' : 'drink'}" aria-hidden="true">${isW ? I.water : I.drink}</span>
        <span class="tl-main"><b>${esc(isW ? 'Water' : (e.name || 'Drink'))}${e.fav ? ' <span style="color:var(--drink)" aria-label="favorite">♥</span>' : ''}${e.open ? '<span class="badge-sip">Sipping</span>' : ''}</b>
          <span>${ppl.length > 1 ? `<span class="who-chip">${esc(ppl[e.p || 0] || '')}</span>` : ''}${esc(bits.join(' · '))}</span></span>
        <span class="tl-side">${isW ? '' : '≈' + fmt1(+e.std || 0)}</span>
      </button></li>`;
    });
    return `<section aria-label="Timeline">
      <div class="section-head"><h2>Timeline</h2><button class="linkish" type="button" data-act="add-past" data-p="-1">${isToday ? 'Add an earlier one' : 'Add to this day'}</button></div>
      ${sorted.length ? `<ul class="tl">${rows}</ul>` : `<div class="empty"><p>${isToday ? 'Nothing logged yet today.' : 'Nothing logged on this day.'}</p><p class="small">Each tap on + Drink or + Water records the time. Tap any entry later to add a name, change the time, or note where you were.</p></div>`}
    </section>`;
  }

  function summaryHTML(k, list) {
    if (!list.length) return '';
    const ppl = people();
    const rows = ppl.map((n, p) => {
      const st = stats(byPerson(list, p));
      return `<tr><td>${esc(n)}</td><td>${st.drinks}</td><td>${fmt1(st.std)}</td><td>${st.waters}</td><td>${st.ml ? fmt1(st.ml / 1000) + ' L' : '–'}</td></tr>`;
    }).join('');
    const firstLast = ppl.map((n, p) => {
      const st = stats(byPerson(list, p));
      if (!st.drinks) return '';
      return `<p class="small"><b>${esc(n)}:</b> first drink ${st.first ? fmtTime(st.first.t) : '–'}, last ${st.last ? fmtTime(st.last.t) : '–'}${st.pace ? `, about one every ${fmtDur(st.pace)}` : ''}${st.waters ? `, ${fmt1(st.waters / Math.max(1, st.drinks))} waters per drink` : ''}.</p>`;
    }).join('');
    return `<section class="card" aria-label="Day summary">
      <div class="section-head"><h2>${esc(dayName(k))} summary</h2><button class="btn small" type="button" data-act="copy-day">${I.copy}Copy</button></div>
      <div class="tablewrap"><table class="sumtable"><thead><tr><th>Who</th><th>Drinks</th><th>≈ Std</th><th>Water</th><th>Volume</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${firstLast}
    </section>`;
  }

  function dayText(k) {
    const ppl = people(), list = forDay(k).sort((a, b) => a.t - b.t);
    const lines = [`Sip Log · ${dayName(k)} · ${dateLabel(k, { weekday: 'long', month: 'short', day: 'numeric' })}${portOf(k) ? ' · ' + portOf(k) : ''}`];
    ppl.forEach((n, p) => {
      const mine = byPerson(list, p), st = stats(mine);
      if (!mine.length) return;
      lines.push('', `${n}: ${st.drinks} drinks (≈${fmt1(st.std)} std), ${st.waters} waters (${volume(st.ml)})`);
      mine.forEach(e => lines.push(`  ${fmtTime(e.t)}  ${e.kind === 'water' ? 'Water' : (e.name || 'Drink')}${e.open ? ' (sipping)' : ''}${e.start && !e.open ? ` (ordered ${fmtTime(e.start)})` : ''}${e.where ? ' @ ' + e.where : ''}`));
    });
    return lines.join('\n');
  }

  // ---------- quick actions ----------
  function addEntry(entry, msg) {
    E.push(entry); saveE();
    render();
    const acts = [['Undo', () => { E = E.filter(x => x.id !== entry.id); saveE(); render(); }]];
    if (entry.kind === 'drink') acts.unshift(['Add details', () => openEditor(entry.id, { focusName: true })]);
    toast(msg, acts);
  }
  function quickDrink(p) {
    const st = stats(byPerson(forDay(curKey()), p));
    addEntry({ id: uid(), kind: 'drink', p, t: Date.now(), start: null, open: false, name: '', std: 1.5, where: '', fav: false, note: '' }, `Drink ${st.drinks + 1} for ${people()[p]} at ${fmtTime(Date.now())}`);
  }
  function quickWater(p) {
    const st = stats(byPerson(forDay(curKey()), p));
    const u = WATER[S.waterUnit] ? S.waterUnit : 'bottle';
    addEntry({ id: uid(), kind: 'water', p, t: Date.now(), unit: u, ml: WATER[u][1], note: '' }, `Water ${st.waters + 1} for ${people()[p]}`);
  }
  function startDrink(p) {
    const now = Date.now();
    addEntry({ id: uid(), kind: 'drink', p, t: now, start: now, open: true, name: '', std: 1.5, where: '', fav: false, note: '' }, `Timer started for ${people()[p]}. Tap Finished when it's done.`);
  }
  function again(p, id) {
    const src = E.find(e => e.id === id); if (!src) return;
    const st = stats(byPerson(forDay(curKey()), p));
    addEntry({ id: uid(), kind: 'drink', p, t: Date.now(), start: null, open: false, name: src.name, std: src.std || 1.5, where: src.where || '', fav: false, note: '' }, `${src.name} (drink ${st.drinks + 1}) for ${people()[p]}`);
  }
  function finish(id) {
    const e = E.find(x => x.id === id); if (!e) return;
    const prev = { t: e.t, open: e.open };
    e.open = false; e.t = Date.now(); if (!e.start) e.start = prev.t;
    saveE(); render();
    toast(`Finished after ${fmtDur((e.t - e.start) / 60000)}`, [['Undo', () => { e.t = prev.t; e.open = prev.open; saveE(); render(); }]]);
  }

  // ---------- editor ----------
  function openEditor(id, opts) {
    opts = opts || {};
    const existing = id ? E.find(e => e.id === id) : null;
    const ppl = people();
    let d;
    if (existing) d = JSON.parse(JSON.stringify(existing));
    else {
      const base = opts.day && opts.day !== curKey() ? dayStart(opts.day) + (20 - (+S.cutoff || 0)) * 3600e3 : Date.now();
      d = { id: uid(), kind: opts.kind || 'drink', p: opts.p >= 0 ? opts.p : 0, t: base, start: null, open: false, name: '', std: 1.5, where: '', fav: false, note: '', unit: S.waterUnit, ml: (WATER[S.waterUnit] || WATER.bottle)[1] };
    }
    if (!d.unit) d.unit = S.waterUnit;
    if (!d.ml) d.ml = (WATER[d.unit] || WATER.bottle)[1];
    if (d.std == null) d.std = 1.5;
    const el = openOverlay(`<div class="panel" role="dialog" aria-modal="true" aria-labelledby="ed-title"><div class="panel-bar"><h2 id="ed-title">${existing ? 'Edit entry' : 'Add an entry'}</h2><button class="icon-btn" type="button" data-act="close" aria-label="Close">${I.x}</button></div><div id="ed-body" style="display:grid;gap:16px"></div></div>`, { onClose: () => render() });
    const body = $('#ed-body', el);
    let delArmed = 0;
    const strengthHTML = () => {
      const recipeStd = stdFor(d.name);
      const chips = STRENGTHS.map(([l, v, hint]) => `<button class="chip" type="button" data-ed="std" data-v="${v}" aria-pressed="${Math.abs(d.std - v) < 0.01 && recipeStd !== d.std}" title="${esc(hint)}">${l} ≈${v}</button>`).join('') +
        (recipeStd != null ? `<button class="chip" type="button" data-ed="std" data-v="${recipeStd}" aria-pressed="${Math.abs(d.std - recipeStd) < 0.01}">This recipe ≈${fmt1(recipeStd)}</button>` : '');
      return `<span>Strength</span><div class="chips">${chips}</div><span class="muted small">Counts as about ${fmt1(d.std)} standard drinks (0.6 oz of alcohol each).</span>`;
    };
    const draw = () => {
      const isW = d.kind === 'water';
      body.innerHTML = `
        <div class="seg" role="group" aria-label="Type"><button type="button" data-ed="kind" data-v="drink" aria-pressed="${!isW}">Drink</button><button type="button" data-ed="kind" data-v="water" aria-pressed="${isW}">Water</button></div>
        ${ppl.length > 1 ? `<div class="field"><span>Who</span><div class="chips">${ppl.map((n, p) => `<button class="chip" type="button" data-ed="p" data-v="${p}" aria-pressed="${(d.p || 0) === p}">${esc(n)}</button>`).join('')}</div></div>` : ''}
        ${isW ? `
          <div class="field"><span>How much</span><div class="chips">${Object.entries(WATER).map(([k, [l, ml, oz]]) => `<button class="chip" type="button" data-ed="unit" data-v="${k}" aria-pressed="${d.unit === k}">${l} · ${oz}</button>`).join('')}</div></div>
          <label class="field" for="ed-t"><span>Time</span><span class="inline"><input id="ed-t" type="datetime-local" value="${toInput(d.t)}"><button class="btn small" type="button" data-ed="now">Now</button></span></label>
        ` : `
          <label class="field" for="ed-name"><span>Drink name (optional)</span><input id="ed-name" value="${esc(d.name || '')}" placeholder="e.g. Coconut Patrón Margarita" autocomplete="off" ${opts.focusName ? 'data-autofocus' : ''}></label>
          <div class="sugg" id="ed-sugg" hidden></div>
          <div class="field"><span>Status</span><div class="seg" role="group" aria-label="Status"><button type="button" data-ed="open" data-v="0" aria-pressed="${!d.open}">Finished</button><button type="button" data-ed="open" data-v="1" aria-pressed="${!!d.open}">Still sipping</button></div></div>
          ${d.open ? '' : `<label class="field" for="ed-t"><span>Finished at</span><span class="inline"><input id="ed-t" type="datetime-local" value="${toInput(d.t)}"><button class="btn small" type="button" data-ed="now">Now</button></span></label>`}
          <label class="field" for="ed-start"><span>Ordered at ${d.open ? '' : '(optional, shows how long it lasted)'}</span><span class="inline"><input id="ed-start" type="datetime-local" value="${d.start ? toInput(d.start) : ''}"><button class="btn small" type="button" data-ed="start-now">Now</button>${d.start && !d.open ? '<button class="btn small" type="button" data-ed="start-clear">Clear</button>' : ''}</span></label>
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
        if (d.kind === 'drink' && d.start && !d.open && d.start > d.t) { err.textContent = 'The ordered time is after the finished time. Fix one of them.'; err.hidden = false; return; }
        if (d.kind === 'drink' && d.open && !d.start) d.start = d.t;
        if (d.kind === 'drink' && d.open) d.t = d.start;
        if (d.kind === 'water') { delete d.start; delete d.open; delete d.std; delete d.where; delete d.fav; delete d.name; }
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
    const ppl = people();
    const el = openOverlay(`<div class="panel" role="dialog" aria-modal="true" aria-labelledby="dp-title">
      <div class="panel-bar"><h2 id="dp-title">Pick a day</h2><button class="icon-btn" type="button" data-act="close" aria-label="Close">${I.x}</button></div>
      <div class="daylist">${list.map(k => {
        const items = forDay(k), st = stats(items);
        const who = ppl.length > 1 ? ppl.map((n, p) => { const s = stats(byPerson(items, p)); return `${n} ${s.drinks}`; }).join(' · ') : '';
        return `<button type="button" data-act="pickday" data-k="${k}" aria-current="${k === sel}"><b>${esc(dayName(k))}${k === cur ? ' · Today' : ''}</b><span class="tot"><b>${st.drinks}</b> drinks<br>${st.waters} water</span><span>${esc(dateLabel(k))}${portOf(k) ? ' · ' + esc(portOf(k)) : ''}${who ? ' · ' + esc(who) : ''}</span></button>`;
      }).join('')}</div>
    </div>`);
    return el;
  }

  // ---------- TRIP ----------
  function tripDays() {
    const out = [];
    for (let i = 0; i < (+S.days || 0); i++) out.push(keyAt(i));
    return out;
  }
  function renderTrip() {
    const ppl = people();
    const days = tripDays();
    const cur = curKey();
    const filt = list => tripWho < 0 ? list : byPerson(list, tripWho);
    const all = filt(E.filter(e => inTrip(dayKey(e.t))));
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
      return `<tr class="click ${k === cur ? 'today' : ''} ${future ? 'future' : ''}" data-act="pickday" data-k="${k}" tabindex="0"><td>Day ${i + 1} · ${esc(dateLabel(k, { month: 'short', day: 'numeric' }))}${portOf(k) ? `<br><span class="muted small">${esc(portOf(k))}</span>` : ''}</td><td>${future ? '–' : s.drinks}</td><td>${future ? '–' : fmt1(s.std)}</td><td>${future ? '–' : s.waters}</td></tr>`;
    }).join('');
    const pkg = +S.pkg || 0, price = +S.price || 0;
    const outside = E.filter(e => !inTrip(dayKey(e.t))).length;
    $('#v-trip').innerHTML = `
      <div class="section-head"><h2 style="font-family:var(--font-display);font-weight:400;font-size:26px">${esc(S.days)}-day cruise</h2><span class="muted small">${esc(dateLabel(days[0] || cur, { month: 'short', day: 'numeric' }))} – ${esc(dateLabel(days[days.length - 1] || cur, { month: 'short', day: 'numeric' }))}</span></div>
      ${ppl.length > 1 ? `<div class="chips" role="group" aria-label="Show">${[['-1', 'Everyone']].concat(ppl.map((n, p) => [String(p), n])).map(([v, l]) => `<button class="chip" type="button" data-act="tripwho" data-v="${v}" aria-pressed="${String(tripWho) === v}">${esc(l)}</button>`).join('')}</div>` : ''}
      <div class="stats">
        <div class="stat"><span class="k">Drinks</span><span class="v">${st.drinks}</span><span class="d">${fmt1(st.drinks / elapsed)} a day so far</span></div>
        <div class="stat"><span class="k">Standard drinks</span><span class="v">≈${fmt1(st.std)}</span><span class="d">${fmt1(st.std / elapsed)} a day</span></div>
        <div class="stat"><span class="k">Water</span><span class="v">${st.waters}</span><span class="d">${st.ml ? volume(st.ml) : 'none yet'}</span></div>
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
      ${pkg ? `<section class="card"><h2 style="font-size:18px">Drink package value</h2><div class="list">${ppl.map((n, p) => { const s = stats(byPerson(E.filter(e => inTrip(dayKey(e.t))), p)); const value = s.drinks * price, paid = pkg * elapsed; return `<div><span>${esc(n)}: ≈${money(value)} of drinks</span><span>${money(paid)} paid so far</span></div>`; }).join('')}</div><p class="muted small">Uses ${money(price)} per drink and ${money(pkg)} per day, both editable in Settings.</p></section>` : ''}
      <div class="btn-row"><button class="btn" type="button" data-act="copy-trip">${I.copy}Copy trip summary</button></div>
      ${backupNudge()}`;
    drawTripChart(days, filt, cur);
  }
  function niceStep(max) { const raw = max / 4; const p = Math.pow(10, Math.floor(Math.log10(raw || 1))); const f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
  function barPath(x, y, w, h, y0) {
    if (h <= 0) return '';
    const r = Math.min(4, h, w / 2);
    return `M${x} ${y0}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y0}Z`;
  }
  function drawTripChart(days, filt, cur) {
    const box = $('#tripchart'); if (!box || !days.length) return;
    const data = days.map(k => { const s = stats(filt(forDay(k))); return { k, d: s.drinks, w: s.waters, future: k > cur }; });
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
      s += `<g class="hitg">`;
      s += `<rect class="hit" x="${left + band * i}" y="${top}" width="${band}" height="${ph + bottom}" tabindex="0" role="button" aria-label="${esc(`Day ${i + 1}: ${v.d} drinks, ${v.w} water`)}" data-act="pickday" data-k="${v.k}" data-tip-x="${cx}" data-tip-y="${Math.min(y(Math.max(v.d, v.w)), y0 - 10)}" data-i="${i}"/>`;
      s += `<path class="mk" d="${barPath(xd, y(v.d), bw, y0 - y(v.d), y0)}" fill="var(--drink)"/><path class="mk" d="${barPath(xw, y(v.w), bw, y0 - y(v.w), y0)}" fill="var(--water)"/>`;
      s += `</g>`;
      if (v.d && v.d === maxD) s += `<text class="bar-label" x="${xd + bw / 2}" y="${y(v.d) - 5}" text-anchor="middle">${v.d}</text>`;
      s += `<text class="axis-t" x="${cx}" y="${H - 12}" text-anchor="middle" style="${v.k === cur ? 'font-weight:700;fill:var(--ink)' : ''}">${i + 1}</text>`;
    });
    s += `<text class="axis-t" x="${left + pw / 2}" y="${H - 0}" text-anchor="middle">Cruise day</text>`;
    s += `<line x1="${left}" x2="${W - right}" y1="${y0}" y2="${y0}" stroke="var(--muted)" stroke-width="1"/>`;
    s += '</svg><div class="tip" hidden></div>';
    box.innerHTML = s;
    const tip = box.querySelector('.tip');
    const show = el => {
      const v = data[+el.dataset.i];
      tip.textContent = '';
      const st = document.createElement('strong'); st.textContent = `Day ${+el.dataset.i + 1} · ${dateLabel(v.k, { month: 'short', day: 'numeric' })}`; tip.appendChild(st);
      [['drink', `${v.d} drinks`], ['water', `${v.w} water`]].forEach(([c, txt]) => { const ln = document.createElement('div'); const key = document.createElement('span'); key.className = 'key'; key.style.background = `var(--${c})`; ln.appendChild(key); ln.appendChild(document.createTextNode(txt)); tip.appendChild(ln); });
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
  function tripText() {
    const ppl = people(), days = tripDays(), cur = curKey();
    const lines = [`Sip Log · ${S.days}-day cruise`];
    days.forEach((k, i) => {
      if (k > cur) return;
      const items = forDay(k);
      const parts = ppl.map((n, p) => { const s = stats(byPerson(items, p)); return `${ppl.length > 1 ? n + ' ' : ''}${s.drinks} drinks, ${s.waters} water`; });
      lines.push(`Day ${i + 1} (${dateLabel(k, { month: 'short', day: 'numeric' })}${portOf(k) ? ', ' + portOf(k) : ''}): ${parts.join(' · ')}`);
    });
    ppl.forEach((n, p) => { const s = stats(byPerson(E.filter(e => inTrip(dayKey(e.t))), p)); lines.push('', `${n} total: ${s.drinks} drinks (≈${fmt1(s.std)} std), ${s.waters} water (${volume(s.ml)})`); });
    return lines.join('\n');
  }
  function backupNudge() {
    if (!E.length) return '';
    const days = S.lastBackup ? Math.floor((Date.now() - S.lastBackup) / 864e5) : null;
    if (days !== null && days < 2) return '';
    return `<p class="nudge">Your log lives only on this phone. ${days === null ? 'Copy a backup code now and then' : `Last backup was ${days} days ago`} (Settings, Backup) so nothing is lost if the browser is cleared.</p>`;
  }

  // ---------- SETTINGS ----------
  function renderSettings() {
    const ppl = S.people.concat(['', '', '', '']).slice(0, 4);
    $('#v-settings').innerHTML = `
      <h2 style="font-family:var(--font-display);font-weight:400;font-size:26px">Settings</h2>
      <div class="settings">
        <section class="card"><h3>Who's logging</h3>
          <div class="grid2">${ppl.map((p, i) => `<label class="field" for="person-${i}"><span>Person ${i + 1}</span><input id="person-${i}" data-set="person" data-i="${i}" value="${esc(p)}" placeholder="${i === 0 ? 'Me' : i === 1 ? 'Partner' : 'Optional'}" maxlength="16"></label>`).join('')}</div>
          <p class="muted small">Leave a name blank to hide that person. Each person gets their own counters on one phone, or each of you can install Sip Log on your own phone.</p>
        </section>
        <section class="card"><h3>Your cruise</h3>
          <div class="grid2">
            <label class="field" for="set-start"><span>Day 1 (boarding day)</span><input id="set-start" type="date" data-set="start" value="${esc(S.start)}"></label>
            <label class="field" for="set-days"><span>Length (days)</span><input id="set-days" type="number" min="1" max="60" inputmode="numeric" data-set="days" value="${esc(S.days)}"></label>
            <label class="field" for="set-cutoff"><span>A new day starts at</span><select id="set-cutoff" data-set="cutoff">${[0, 2, 3, 4, 5, 6].map(h => `<option value="${h}" ${+S.cutoff === h ? 'selected' : ''}>${fmtHour(h)}</option>`).join('')}</select></label>
          </div>
          <p class="field" style="font-weight:600;margin-top:4px">Ports and sea days (optional)</p>
          <div class="ports">${portsHTML()}</div>
        </section>
        <section class="card"><h3>Water</h3>
          <div class="grid2">
            <label class="field" for="set-unit"><span>The + Water button adds a</span><select id="set-unit" data-set="unit">${Object.entries(WATER).map(([k, [l, ml, oz]]) => `<option value="${k}" ${S.waterUnit === k ? 'selected' : ''}>${l} (${ml} ml · ${oz})</option>`).join('')}</select></label>
            <label class="field" for="set-goal"><span>Daily water goal (count)</span><input id="set-goal" type="number" min="0" max="30" inputmode="numeric" data-set="goal" value="${esc(S.waterGoal)}"></label>
          </div>
        </section>
        <section class="card"><h3>Drinks</h3>
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
          <p class="muted small">Everything stays on this phone. A backup code lets you move the log to another phone or merge your partner's log into yours.${S.lastBackup ? ` Last backup: ${new Date(S.lastBackup).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.` : ''}</p>
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
  function portsHTML() {
    const out = [];
    for (let i = 0; i < (+S.days || 0); i++) out.push(`<label for="port-${i}">Day ${i + 1} · ${esc(dateLabel(keyAt(i), { month: 'short', day: 'numeric' }))}<input id="port-${i}" data-set="port" data-i="${i}" value="${esc(S.ports[i] || '')}" placeholder="${i === 0 ? 'e.g. Barcelona' : 'Port or Sea day'}" maxlength="28"></label>`);
    return out.join('');
  }
  function refreshPorts() { const box = $('#v-settings .ports'); if (!box) return; box.innerHTML = portsHTML(); bindSettings(box); }
  function bindSettings(root) {
    $$('[data-set]', root || $('#v-settings')).forEach(inp => {
      inp.addEventListener('change', () => {
        const t = inp.dataset.set, v = inp.value.trim();
        if (t === 'person') { const arr = S.people.concat(['', '', '', '']).slice(0, 4); arr[+inp.dataset.i] = v; while (arr.length > 1 && !arr[arr.length - 1]) arr.pop(); S.people = arr; }
        else if (t === 'start') { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) S.start = v; }
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
  function restore(mode, btn) {
    const box = $('#restore');
    try {
      const d = JSON.parse(box.value);
      if (d.app !== 'siplog' || !Array.isArray(d.entries)) throw new Error('not a backup');
      if (mode === 'replace') { E = d.entries; if (d.settings) Object.assign(S, d.settings); }
      else { const ids = new Set(E.map(e => e.id)); d.entries.forEach(e => { if (!ids.has(e.id)) E.push(e); }); }
      saveE(); saveS(); applyTheme(); box.value = '';
      toast(mode === 'replace' ? 'Log replaced from backup' : `Merged ${d.entries.length} entries`);
      renderSettings();
    } catch (e) { toast('That code didn\'t work. Copy the whole backup code and try again.'); }
  }
  function csv() {
    const ppl = people();
    const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = [['Date', 'Cruise day', 'Port', 'Person', 'Type', 'Name', 'Ordered', 'Finished', 'Minutes', 'Std drinks', 'Water ml', 'Where', 'Favorite', 'Note']];
    E.slice().sort((a, b) => a.t - b.t).forEach(e => {
      const k = dayKey(e.t);
      rows.push([k, inTrip(k) ? dayIndex(k) + 1 : '', portOf(k), ppl[e.p || 0] || '', e.kind, e.kind === 'water' ? '' : (e.name || ''), e.start ? fmtTime(e.start) : '', e.open ? '' : fmtTime(e.t), e.start && !e.open ? Math.round((e.t - e.start) / 60000) : '', e.kind === 'water' ? '' : e.std, e.kind === 'water' ? e.ml : '', e.where || '', e.fav ? 'yes' : '', e.note || '']);
    });
    return rows.map(r => r.map(q).join(',')).join('\n');
  }

  // ---------- actions ----------
  let wipeArmed = 0;
  const ACT = {
    'add-drink': t => quickDrink(+t.dataset.p),
    'add-water': t => quickWater(+t.dataset.p),
    'start-drink': t => startDrink(+t.dataset.p),
    again: t => again(+t.dataset.p, t.dataset.id),
    finish: t => finish(t.dataset.id),
    edit: t => openEditor(t.dataset.id),
    'add-past': t => openEditor(null, { p: +t.dataset.p, day: sel }),
    close: () => closeTop(),
    prevday: () => { const { y, m, d } = parse(sel); sel = ymd(new Date(y, m - 1, d - 1, 12)); renderLog(); },
    nextday: () => { const { y, m, d } = parse(sel); const n = ymd(new Date(y, m - 1, d + 1, 12)); if (n <= curKey()) { sel = n; renderLog(); } },
    today: () => { sel = curKey(); renderLog(); },
    days: () => openDays(),
    pickday: t => { sel = t.dataset.k; if (stack.length) closeTop(); go('log'); },
    'setup-save': () => {
      const st = $('#su-start').value, dd = Math.round(+$('#su-days').value), p0 = $('#su-p0').value.trim(), p1 = $('#su-p1').value.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(st)) S.start = st;
      if (dd >= 1 && dd <= 60) S.days = dd;
      S.people = p1 ? [p0 || 'Me', p1] : [p0 || 'Me'];
      S.setupDone = true; saveS(); sel = curKey(); renderLog();
      toast(inTrip(curKey()) ? `Today is Day ${dayIndex(curKey()) + 1}. Happy sailing!` : 'Saved. Today is outside your cruise dates.');
    },
    'copy-day': () => copyText(dayText(sel), 'Day summary copied'),
    'copy-trip': () => copyText(tripText(), 'Trip summary copied'),
    tripwho: t => { tripWho = +t.dataset.v; renderTrip(); },
    theme: t => { S.theme = t.dataset.v; saveS(); applyTheme(); $$('[data-act="theme"]').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === S.theme)); },
    backup: () => { S.lastBackup = Date.now(); saveS(); copyText(JSON.stringify({ app: 'siplog', v: 1, settings: S, entries: E }), 'Backup code copied. Paste it somewhere safe, like Notes.'); },
    csv: () => copyText(csv(), 'Spreadsheet text copied. Paste it into Numbers, Excel or Sheets.'),
    merge: t => restore('merge', t),
    replace: t => restore('replace', t),
    wipe: t => {
      if (Date.now() - wipeArmed > 4000) { wipeArmed = Date.now(); t.textContent = 'Tap again to clear every entry'; return; }
      E = []; saveE(); t.textContent = 'Cleared'; toast('All entries cleared');
    },
    'copy-site': () => copyText(SITE, 'Link copied'),
    'offline-help': () => { go('settings'); setTimeout(() => { const o = $('#offline'); if (o) o.scrollIntoView({ block: 'start' }); }, 30); }
  };
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-go]');
    if (g) { while (stack.length) closeTop(); if (g.dataset.go === 'log') sel = view === 'log' ? curKey() : sel; go(g.dataset.go); return; }
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
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !stack.length) { const c = curKey(); if (c !== lastCur) { if (sel === lastCur) sel = c; lastCur = c; } render(); } });
  let rz;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (!stack.length && view !== 'settings') render(); }, 200); });

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
  applyTheme();
  const setHead = () => { const h = $('.top'); if (h) document.documentElement.style.setProperty('--head-h', h.offsetHeight + 'px'); };
  go('log');
  setHead();
  initOffline();
})();
