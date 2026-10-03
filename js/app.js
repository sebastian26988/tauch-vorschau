import { loadConditions, nearestPegelStations, pruneCache } from './api.js';
import {
  loadSpots, saveSpots, loadSettings, saveSettings, loadSelectedId, saveSelectedId,
  blankSpot, exportJson, parseImport, EXAMPLE_SPOTS,
} from './spots.js';
import {
  rateDay, rateHour, resolveThresholds, inWindow, hourOf, reasonText, reasonShort,
  LEVEL_LABEL, LEVEL_CLASS, DEFAULT_THRESHOLDS, GREEN,
} from './rating.js';
import { renderDayCharts } from './charts.js';
import { createPicker } from './map.js';
import { searchPlaces, searchNearby, SOURCE_LABEL } from './sitesearch.js';
import {
  hasStoredSession, getUser, sendCode, verifyCode, signInWithPassword, signOut,
  fetchSites, cachedSites, applySite,
} from './logbook.js';
import { COMPASS, compass, compassToDeg, fmt, knToBft, weatherInfo } from './units.js';
import { icon, hydrateIcons } from './icons.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const state = {
  spots: loadSpots(),
  settings: loadSettings(),
  selectedId: loadSelectedId(),
  data: null,
  dayIndex: 0,
  loadToken: 0,
};

const selectedSpot = () => state.spots.find((s) => s.id === state.selectedId) ?? null;
const thresholdsFor = (spot) => resolveThresholds(spot.type, state.settings.thresholds, spot.thresholds);

// ---------- Zeit & Format ----------

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WEEKDAYS_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

const dateParts = (iso) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return { y, m, d, wd: new Date(y, m - 1, d).getDay() };
};
const shortDate = (iso) => {
  const { m, d } = dateParts(iso);
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.`;
};
const longDate = (iso) => {
  const { m, d, wd } = dateParts(iso);
  return `${WEEKDAYS_LONG[wd]}, ${d}. ${MONTHS[m - 1]}`;
};
const dayLabel = (iso, i) => (i === 0 ? 'Heute' : i === 1 ? 'Morgen' : `${WEEKDAYS[dateParts(iso).wd]} ${shortDate(iso)}`);
const clock = (ts) => new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const stamp = (ts) => `${new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}, ${clock(ts)} Uhr`;

// Lokale Zeit am Spot als "YYYY-MM-DDTHH:MM"
const spotNow = () => new Date(Date.now() + (state.data?.utcOffsetSeconds ?? 0) * 1000).toISOString().slice(0, 16);

const maxBy = (arr, fn) => arr.reduce((best, x) => (fn(x) != null && (best == null || fn(x) > fn(best)) ? x : best), null);
const mean = (vals) => {
  const v = vals.filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

// ---------- Spot-Auswahl ----------

const BOOK_ICON = icon('book', 14);

function renderChips() {
  const nav = $('#spot-chips');
  nav.innerHTML = state.spots.map((s) => `
    <button class="chip" data-id="${esc(s.id)}" aria-pressed="${s.id === state.selectedId}">
      ${s.source === 'logbuch' ? BOOK_ICON : ''}${esc(s.name)} <span class="tag">${s.type === 'see' ? 'See' : 'Meer'}</span>
    </button>`).join('') + '<button class="chip chip-add" id="btn-add-spot">+ Tauchplatz</button>';
  // Aktiven Chip sichtbar machen, ohne die Seite vertikal zu scrollen
  const active = nav.querySelector('[aria-pressed="true"]');
  if (active && (active.offsetLeft < nav.scrollLeft || active.offsetLeft + active.offsetWidth > nav.scrollLeft + nav.clientWidth)) {
    nav.scrollLeft = active.offsetLeft - 16;
  }
}

$('#spot-chips').addEventListener('click', (e) => {
  if (e.target.closest('#btn-add-spot')) return openSpotEditor(null);
  const chip = e.target.closest('.chip[data-id]');
  if (chip && chip.dataset.id !== state.selectedId) selectSpot(chip.dataset.id);
});

function selectSpot(id) {
  state.selectedId = id;
  state.dayIndex = 0;
  state.data = null;
  saveSelectedId(id);
  renderChips();
  load();
}

// ---------- Laden ----------

async function load(force = false) {
  const spot = selectedSpot();
  renderSpotHead();
  if (!spot) {
    $('#status').textContent = '';
    $('#warnings').innerHTML = '';
    $('#days').innerHTML = '';
    $('#detail').innerHTML = `
      <div class="karte empty">
        <h2>Noch keine Tauchplätze</h2>
        <p>Hol dir deine Plätze aus dem Logbuch oder lege einen neuen an.</p>
        <div class="empty-actions">
          <button class="btn btn-primary" id="btn-empty-logbook">${icon('book', 16)} Plätze aus dem Logbuch wählen</button>
          <button class="btn" id="btn-empty-add">${icon('plus', 16)} Tauchplatz anlegen</button>
        </div>
      </div>`;
    $('#btn-empty-logbook').onclick = openLogbook;
    $('#btn-empty-add').onclick = () => openSpotEditor(null);
    $('#notes').innerHTML = '';
    return;
  }
  const token = ++state.loadToken;
  $('#btn-refresh')?.classList.add('spinning');
  if (!state.data) $('#status').textContent = 'Lade Vorhersage …';
  try {
    const data = await loadConditions(spot, { force });
    if (token !== state.loadToken) return;
    state.data = data;
    render();
  } catch (err) {
    if (token !== state.loadToken) return;
    $('#status').textContent = '';
    $('#warnings').innerHTML = `<p class="warning error">Vorhersage konnte nicht geladen werden (${esc(err.message)}). Bist du offline? <button class="btn" id="btn-retry">Erneut versuchen</button></p>`;
    $('#btn-retry').onclick = () => load(true);
  } finally {
    if (token === state.loadToken) $('#btn-refresh')?.classList.remove('spinning');
  }
}

function render() {
  renderSpotHead();
  renderStatus();
  renderDays();
  renderDetail();
  renderNotes();
}

// ---------- Kopf, Status, Hinweise ----------

function waterInfo(spot, data) {
  const parts = [];
  if (spot.type === 'meer' && data) {
    const now = spotNow().slice(0, 13);
    const h = data.hours.find((x) => x.time.slice(0, 13) === now);
    if (h?.sst != null) parts.push(`Wasser (Modell): <strong>${fmt(h.sst, 1)} °C</strong>`);
  }
  if (data?.pegel) {
    const { last } = data.pegel;
    parts.push(`Messstation ${esc(spot.pegel.name)}: <strong>${fmt(last.value, 1)} °C</strong> <span class="muted">(${stamp(Date.parse(last.timestamp))})</span>`);
  }
  const mw = spot.manualWater;
  if (mw && (mw.surface != null || mw.depthTemp != null)) {
    const bits = [];
    if (mw.surface != null) bits.push(`${fmt(mw.surface, 1)} °C Oberfläche`);
    if (mw.depthTemp != null) bits.push(`${fmt(mw.depthTemp, 1)} °C${mw.depth != null ? ` in ${fmt(mw.depth)} m` : ' in der Tiefe'}`);
    parts.push(`Eigene Messung: <strong>${bits.join(' · ')}</strong>${mw.date ? ` <span class="muted">(${shortDate(mw.date)})</span>` : ''}`);
  }
  return parts;
}

function renderSpotHead() {
  const spot = selectedSpot();
  const head = $('#spot-head');
  if (!spot) {
    head.innerHTML = '';
    return;
  }
  const ns = spot.lat >= 0 ? 'N' : 'S';
  const ew = spot.lon >= 0 ? 'O' : 'W';
  const meta = [
    spot.type === 'see' ? 'Binnensee' : 'Meer / Küste',
    spot.source === 'logbuch' ? 'aus dem Logbuch' : null,
    `${fmt(Math.abs(spot.lat), 4)}° ${ns}, ${fmt(Math.abs(spot.lon), 4)}° ${ew}`,
    spot.exposure ? `Ufer offen nach ${compass(spot.exposure.from)}–${compass(spot.exposure.to)}` : null,
    `Tauchfenster ${spot.window.start}–${spot.window.end} Uhr`,
  ].filter(Boolean);
  const water = waterInfo(spot, state.data);
  head.innerHTML = `
    <div>
      <h1>${esc(spot.name)}</h1>
      <div class="meta">${meta.map(esc).join(' · ')}</div>
      ${water.length ? `<div class="water-line">${water.join('<br>')}</div>` : ''}
    </div>
    <div class="head-actions">
      <button class="btn-icon bordered" id="btn-refresh" title="Daten neu laden" aria-label="Daten neu laden">${icon('refresh', 18)}</button>
      <button class="btn" id="btn-edit-spot" aria-label="Bearbeiten">${icon('edit', 16)}<span class="btn-label">Bearbeiten</span></button>
    </div>`;
  $('#btn-edit-spot').onclick = () => openSpotEditor(spot);
  $('#btn-refresh').onclick = () => load(true);
}

function renderStatus() {
  const { data } = state;
  if (!data) return;
  $('#status').innerHTML = data.stale
    ? `<span class="offline">Offline</span> – letzter Stand vom ${stamp(data.ts)}`
    : `Aktualisiert ${stamp(data.ts)}`;
  $('#warnings').innerHTML = data.warnings.map((w) => `<p class="warning">${esc(w)}</p>`).join('');
}

function renderNotes() {
  const spot = selectedSpot();
  const items = [
    spot.type === 'meer'
      ? 'Die Ampel bewertet Wind, Böen, Seegang, Strömung laut Modell und Gewitter im Tauchfenster. Sicht, die Strömung direkt am Platz und deine Erfahrung fließen nicht ein.'
      : 'Die Ampel bewertet Wind, Böen und Gewitter im Tauchfenster. Sicht und deine Erfahrung fließen nicht ein.',
  ];
  if (spot.type === 'meer') {
    items.push('Wasserstand und Strömung stammen aus einem groben Modell (~8 km) und sind an der Küste ungenau – nur als Tendenz nutzen, nicht zur Navigation. Offizielle Gezeiten: <a href="https://www.bsh.de/DE/DATEN/Vorhersagen/Gezeiten/gezeiten_node.html" target="_blank" rel="noopener">BSH-Gezeitenvorhersage</a>.');
    items.push('Wassertemperatur „Modell“ ist die vorhergesagte Oberflächentemperatur; in Buchten und Häfen kann sie abweichen.');
  } else {
    items.push('Für Seen gibt es keine Wassertemperatur-Vorhersage: angezeigt wird der letzte Messwert der gewählten Station bzw. dein eigener Eintrag. Sprungschicht und Tiefentemperatur sind nicht abgedeckt.');
  }
  $('#notes').innerHTML = `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
}

// ---------- 7-Tage-Übersicht ----------

function groupDays(hours) {
  const map = new Map();
  for (const h of hours) {
    const d = h.time.slice(0, 10);
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(h);
  }
  return [...map].map(([date, hrs]) => ({ date, hours: hrs }));
}

function daySummary(day, i, spot, th) {
  const nowIso = i === 0 ? spotNow() : null;
  const rating = rateDay(day.hours, spot, th, nowIso);
  const win = day.hours.filter((h) => inWindow(h.time, spot));
  const windMax = maxBy(win, (h) => h.wind);
  const waveMax = maxBy(win, (h) => h.wave);
  const temps = day.hours.map((h) => h.temp).filter((t) => t != null);
  let water = null;
  let waterNote = '';
  if (spot.type === 'meer') water = mean(win.map((h) => h.sst));
  if (water == null && state.data.pegel) {
    water = state.data.pegel.last.value;
    waterNote = 'gem.';
  }
  if (water == null && spot.manualWater?.surface != null) {
    water = spot.manualWater.surface;
    waterNote = 'eigene';
  }
  return {
    rating,
    windMax,
    gustMax: maxBy(win, (h) => h.gust)?.gust ?? null,
    waveMax,
    code: Math.max(...win.map((h) => h.code ?? 0)),
    tMin: temps.length ? Math.min(...temps) : null,
    tMax: temps.length ? Math.max(...temps) : null,
    water,
    waterNote,
  };
}

function renderDays() {
  const spot = selectedSpot();
  const th = thresholdsFor(spot);
  const days = groupDays(state.data.hours);
  state.dayIndex = Math.min(state.dayIndex, days.length - 1);
  $('#days').innerHTML = days.map((day, i) => {
    const s = daySummary(day, i, spot, th);
    const cls = LEVEL_CLASS[s.rating.level];
    const wx = weatherInfo(s.code);
    const reasonsTitle = s.rating.reasons.map(reasonText).join(', ') || 'Keine Einschränkungen';
    return `
      <button class="day lvl-${cls}" data-index="${i}" aria-pressed="${i === state.dayIndex}" title="${esc(reasonsTitle)}">
        <div class="day-top"><span class="day-date">${dayLabel(day.date, i)}</span><span class="day-wx" title="${wx.text}">${wx.icon}</span></div>
        <span class="badge">${LEVEL_LABEL[s.rating.level]}</span>
        ${s.rating.reasons.length ? `<span class="day-reason">${esc(reasonShort(s.rating.reasons[0]))}</span>` : ''}
        <dl>
          <dt>Wind</dt><dd title="${knToBft(s.windMax?.wind) ?? '–'} Bft">${fmt(s.windMax?.wind)} kn <span class="muted">${compass(s.windMax?.windDir)}</span></dd>
          <dt>Böen</dt><dd>${fmt(s.gustMax)} kn</dd>
          ${spot.type === 'meer' ? `<dt>Welle</dt><dd>${fmt(s.waveMax?.wave, 1)} m${s.waveMax?.wavePeriod != null ? ` · ${fmt(s.waveMax.wavePeriod)} s` : ''}</dd>` : ''}
          <dt>Wasser</dt><dd>${s.water != null ? `${fmt(s.water, 1)} °C` : '–'}${s.waterNote ? ` <span class="muted small">${s.waterNote}</span>` : ''}</dd>
          <dt>Luft</dt><dd>${fmt(s.tMin)}–${fmt(s.tMax)} °C</dd>
        </dl>
      </button>`;
  }).join('');
}

$('#days').addEventListener('click', (e) => {
  const card = e.target.closest('.day');
  if (!card) return;
  state.dayIndex = Number(card.dataset.index);
  document.querySelectorAll('.day').forEach((d) => d.setAttribute('aria-pressed', String(d === card)));
  renderDetail();
});

// ---------- Tagesdetail ----------

// Längster zusammenhängender Block der besten Stufe im Tauchfenster
function bestWindow(rated) {
  if (!rated.length) return null;
  const best = Math.min(...rated.map((r) => r.level));
  let cur = null, top = null;
  for (const r of rated) {
    if (r.level === best && (!cur || hourOf(r.time) === cur.end + 1)) {
      cur = cur ? { ...cur, end: hourOf(r.time) } : { start: hourOf(r.time), end: hourOf(r.time) };
    } else {
      cur = r.level === best ? { start: hourOf(r.time), end: hourOf(r.time) } : null;
    }
    if (cur && (!top || cur.end - cur.start > top.end - top.start)) top = cur;
  }
  return { ...top, level: best };
}

// Kennzahl auf der Petrol-Fläche: große Zahl, kleine Einheit – wie im Logbuch
function kennzahl(zahl, einheit, label, hinweis = '') {
  return `<div class="flaeche kennzahl">
    <div class="kz-wert"><span class="kz-zahl">${zahl}</span>${einheit ? `<span class="kz-einheit">${einheit}</span>` : ''}</div>
    <div class="kz-label">${label}</div>${hinweis ? `<div class="kz-hinweis">${hinweis}</div>` : ''}
  </div>`;
}

function renderDetail() {
  const spot = selectedSpot();
  const th = thresholdsFor(spot);
  const days = groupDays(state.data.hours);
  const day = days[state.dayIndex];
  const isToday = state.dayIndex === 0;
  const nowHour = spotNow().slice(0, 13);
  const rating = rateDay(day.hours, spot, th, isToday ? spotNow() : null);

  const rated = day.hours.map((h) => ({ time: h.time, ...rateHour(h, spot, th) }));
  const future = rated.filter((r) => inWindow(r.time, spot) && (!isToday || r.time.slice(0, 13) >= nowHour));
  const bw = bestWindow(future);
  const sun = state.data.days.find((d) => d.date === day.date);

  const s = daySummary(day, state.dayIndex, spot, th);
  const kz = [
    kennzahl(fmt(s.windMax?.wind), 'kn', 'Wind max. im Fenster', s.windMax ? `${knToBft(s.windMax.wind)} Bft aus ${compass(s.windMax.windDir)}` : ''),
    kennzahl(fmt(s.gustMax), 'kn', 'Böen max.'),
    spot.type === 'meer'
      ? kennzahl(fmt(s.waveMax?.wave, 1), 'm', 'Welle max.', s.waveMax?.wavePeriod != null ? `Periode ${fmt(s.waveMax.wavePeriod)} s` : '')
      : kennzahl(`${fmt(s.tMin)}–${fmt(s.tMax)}`, '°C', 'Luft'),
    kennzahl(s.water != null ? fmt(s.water, 1) : '–', s.water != null ? '°C' : '', 'Wasser', s.waterNote === 'gem.' ? 'Messwert Station' : s.waterNote === 'eigene' ? 'eigene Messung' : spot.type === 'meer' ? 'Modell, Oberfläche' : ''),
  ];

  const facts = [];
  if (bw) facts.push(`Bestes Fenster: <strong>${String(bw.start).padStart(2, '0')}–${String(bw.end).padStart(2, '0')} Uhr</strong> (${LEVEL_LABEL[bw.level].toLowerCase()})`);
  if (sun) facts.push(`Sonne: <strong>${sun.sunrise.slice(11)}–${sun.sunset.slice(11)}</strong>`);

  const cells = rated.map((r) => {
    const past = isToday && r.time.slice(0, 13) < nowHour;
    const label = `${r.time.slice(11, 16)}: ${LEVEL_LABEL[r.level]}${r.reasons.length ? ` – ${r.reasons.map(reasonText).join(', ')}` : ''}`;
    return `<div class="strip-cell lvl-${LEVEL_CLASS[r.level]}${inWindow(r.time, spot) ? '' : ' off'}${past ? ' past' : ''}" title="${esc(label)}"></div>`;
  }).join('');

  $('#detail').innerHTML = `
    <div class="detail-head lvl-${LEVEL_CLASS[rating.level]}">
      <h2>${longDate(day.date)} <span class="badge">${LEVEL_LABEL[rating.level]}</span></h2>
      ${rating.reasons.length
        ? `<ul>${rating.reasons.map((r) => `<li>${esc(reasonText(r))}</li>`).join('')}</ul>`
        : `<p class="muted detail-ok">Keine Einschränkungen im Tauchfenster (${spot.window.start}–${spot.window.end} Uhr).</p>`}
      <div class="kennzahlen">${kz.join('')}</div>
      ${facts.length ? `<div class="detail-facts">${facts.map((f) => `<span>${f}</span>`).join('')}</div>` : ''}
      <div class="strip" aria-label="Stündliche Bewertung">
        <div class="strip-cells">${cells}</div>
        <div class="strip-labels">${[0, 3, 6, 9, 12, 15, 18, 21].map((h) => `<span>${String(h).padStart(2, '0')}</span>`).join('')}</div>
      </div>
    </div>
    <div class="charts" id="charts"></div>`;

  renderDayCharts($('#charts'), { hours: day.hours, spot, th, pegelSeries: state.data.pegel?.series });
}

// ---------- Grenzwert-Formulare ----------

const TH_ROWS = {
  wind: { label: 'Wind (kn)', keys: ['wind.0', 'wind.1'], step: 1 },
  gust: { label: 'Böen (kn)', keys: ['gust.0', 'gust.1'], step: 1 },
  wave: { label: 'Welle (m)', keys: ['wave.0', 'wave.1'], step: 0.1 },
  current: { label: 'Strömung (kn)', keys: ['current.0', 'current.1'], step: 0.1 },
  swell: { label: 'Lange Dünung ab (m / s)', keys: ['swellHeight', 'swellPeriod'], step: 0.1 },
  factor: { label: 'Faktor auflandig', keys: ['onshoreFactor'], step: 0.05 },
};
const ROWS_FOR = { meer: ['wind', 'gust', 'wave', 'current', 'swell', 'factor'], see: ['wind', 'gust', 'factor'] };

const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  keys.slice(0, -1).forEach((k, i) => {
    if (o[k] == null) o[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    o = o[k];
  });
  o[keys.at(-1)] = value;
}

// values: aktuelle Werte (oder null = leer), placeholders: geerbte Werte
function renderThresholdGrid(grid, rows, values, placeholders) {
  grid.innerHTML = '<span></span><span class="hdr">grün bis</span><span class="hdr">gelb bis</span>' + rows.map((name) => {
    const row = TH_ROWS[name];
    const inputs = row.keys.map((key) => {
      const v = values ? getPath(values, key) : null;
      const ph = getPath(placeholders, key);
      return `<input type="number" min="0" step="${row.step}" data-key="${key}" value="${v ?? ''}" placeholder="${ph ?? ''}" aria-label="${row.label} ${key}">`;
    });
    return `<span>${row.label}</span>${inputs.join('')}${inputs.length === 1 ? '<span></span>' : ''}`;
  }).join('');
}

// Teilweise ausgefüllte Paare (grün/gelb) mit den geerbten Werten ergänzen
function fillPairs(values, inherited) {
  for (const key of ['wind', 'gust', 'wave', 'current']) {
    if (values[key]) values[key] = [values[key][0] ?? inherited[key][0], values[key][1] ?? inherited[key][1]];
  }
  return values;
}

function readThresholdGrid(grid) {
  const out = {};
  grid.querySelectorAll('input[data-key]').forEach((inp) => {
    if (inp.value !== '') setPath(out, inp.dataset.key, Number(inp.value));
  });
  return out;
}

// ---------- Spot-Editor ----------

const dlgSpot = $('#dlg-spot');
const spotForm = $('#spot-form');
let editing = null;
let picker = null;
let pegelTimer = null;

function fillCompassSelect(select, value) {
  select.innerHTML = '<option value="">–</option>' + COMPASS.map((c) => `<option value="${compassToDeg(c)}">${c}</option>`).join('');
  select.value = value == null ? '' : String(value);
}

function renderSpotThresholds() {
  const type = spotForm.type.value;
  const grid = $('.threshold-grid[data-scope="spot"]', spotForm);
  const current = grid.children.length ? readThresholdGrid(grid) : editing.thresholds;
  renderThresholdGrid(grid, ROWS_FOR[type].filter((r) => r !== 'factor' && r !== 'swell'), current, resolveThresholds(type, state.settings.thresholds));
}

function openSpotEditor(spot) {
  const isNew = !spot;
  const center = selectedSpot();
  editing = structuredClone(spot ?? blankSpot(center?.lat, center?.lon));
  $('#spot-form-title').textContent = isNew ? 'Neuer Tauchplatz' : 'Tauchplatz bearbeiten';
  $('#btn-delete-spot').hidden = isNew;

  const f = spotForm;
  $('#site-search').value = '';
  $('#search-results').innerHTML = '';
  f.name.dataset.auto = '0';
  f.name.value = editing.name;
  f.type.value = editing.type;
  f.lat.value = editing.lat.toFixed(4);
  f.lon.value = editing.lon.toFixed(4);
  fillCompassSelect(f.expFrom, editing.exposure?.from);
  fillCompassSelect(f.expTo, editing.exposure?.to);
  f.winStart.value = editing.window.start;
  f.winEnd.value = editing.window.end;
  const mw = editing.manualWater ?? {};
  f.mwSurface.value = mw.surface ?? '';
  f.mwDepthTemp.value = mw.depthTemp ?? '';
  f.mwDepth.value = mw.depth ?? '';
  f.mwDate.value = mw.date ?? '';
  $('#manual-water').open = mw.surface != null || mw.depthTemp != null;
  $('#own-thresholds').open = !!editing.thresholds;
  $('.threshold-grid[data-scope="spot"]', f).innerHTML = '';
  renderSpotThresholds();

  dlgSpot.showModal();
  applyLinkedUi();
  if (isNew) $('#site-search').focus();
  // Logbuch-Plätze für die Suche auffrischen (nur wenn schon angemeldet)
  if (hasStoredSession()) fetchSites().catch(() => {});
}

// Verknüpfte Logbuch-Spots: Name und Position kommen aus dem Logbuch und sind hier gesperrt
function applyLinkedUi() {
  const linked = editing.source === 'logbuch';
  const f = spotForm;
  $('#lb-linked').hidden = !linked;
  $('#search-field').hidden = linked;
  for (const name of ['name', 'lat', 'lon']) f[name].readOnly = linked;
  $('#btn-delete-spot').textContent = linked ? 'Aus Vorschau entfernen' : 'Löschen';
  $('#picker-hint').textContent = linked
    ? '– Position aus dem Logbuch'
    : '– in die Karte tippen oder Marker ziehen · graue Punkte: bekannte Tauchplätze in der Nähe';
  picker?.destroy();
  picker = createPicker($('#picker'), { lat: Number(f.lat.value), lon: Number(f.lon.value) }, (lat, lon) => {
    f.lat.value = lat.toFixed(4);
    f.lon.value = lon.toFixed(4);
    scheduleLocationUpdate();
  }, { readOnly: linked });
  // Größe steht erst nach dem Layout des Dialogs fest
  setTimeout(() => picker?.refresh(), 60);
  locationUpdate();
}

function scheduleLocationUpdate() {
  clearTimeout(pegelTimer);
  pegelTimer = setTimeout(locationUpdate, 500);
}

function locationUpdate() {
  searchPegel();
  showNearbySites();
}

async function showNearbySites() {
  const lat = Number(spotForm.lat.value), lon = Number(spotForm.lon.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  try {
    const list = await searchNearby(lat, lon);
    picker?.showNearby(list, (hit) => pickHit(hit));
  } catch {
    // Verzeichnis nicht ladbar – Karte funktioniert trotzdem
  }
}

// ---------- Tauchplatz-Suche im Editor ----------

let searchTimer = null;
let searchAbort = null;
let searchHits = [];

$('#site-search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(e.target.value), 350);
});
$('#site-search').addEventListener('keydown', (e) => {
  // Enter soll nicht das Formular abschicken
  if (e.key === 'Enter') {
    e.preventDefault();
    $('#search-results .hit')?.click();
  }
});

async function runSearch(query) {
  searchAbort?.abort();
  const box = $('#search-results');
  if (query.trim().length < 2) {
    box.innerHTML = '';
    return;
  }
  searchAbort = new AbortController();
  const { signal } = searchAbort;
  box.innerHTML = '<p class="muted small">Suche …</p>';
  try {
    const { hits, failed } = await searchPlaces(query, { signal, logbookSites: cachedSites() ?? [] });
    if (signal.aborted) return;
    searchHits = hits.slice(0, 12);
    box.innerHTML = (searchHits.length
      ? searchHits.map((h, i) => `
        <button type="button" class="hit" data-i="${i}">
          <span class="hit-main"><strong>${esc(h.label)}</strong>${h.detail ? ` <span class="muted">${esc(h.detail)}</span>` : ''}</span>
          <span class="src src-${h.source}">${SOURCE_LABEL[h.source]}</span>
        </button>`).join('')
      : '<p class="muted small">Nichts gefunden – Position alternativ in der Karte setzen.</p>')
      + (failed.length ? `<p class="muted small">Nicht erreichbar: ${failed.join(', ')}</p>` : '');
  } catch (err) {
    if (!signal.aborted) box.innerHTML = `<p class="muted small">Suche fehlgeschlagen (${esc(err.message)}).</p>`;
  }
}

$('#search-results').addEventListener('click', (e) => {
  const btn = e.target.closest('.hit');
  if (btn) pickHit(searchHits[Number(btn.dataset.i)]);
});

spotForm.name.addEventListener('input', () => {
  spotForm.name.dataset.auto = '0';
});

function pickHit(hit) {
  const f = spotForm;
  if (hit.source === 'logbuch') {
    const existing = state.spots.find((s) => s.logbookId === hit.site.id && s.id !== editing.id);
    if (existing) {
      alert(`„${hit.site.name}“ ist bereits in der Vorschau.`);
      return;
    }
    editing = applySite(editing, hit.site);
    f.name.value = editing.name;
    f.type.value = editing.type;
    renderSpotThresholds();
  } else if (hit.source !== 'coordinates' && (!f.name.value.trim() || f.name.dataset.auto === '1')) {
    f.name.value = hit.label;
    f.name.dataset.auto = '1';
  }
  f.lat.value = hit.lat.toFixed(4);
  f.lon.value = hit.lon.toFixed(4);
  $('#search-results').innerHTML = '';
  $('#site-search').value = '';
  if (hit.source === 'logbuch') {
    applyLinkedUi();
  } else {
    picker?.setPosition(hit.lat, hit.lon, 13);
    scheduleLocationUpdate();
  }
}

$('#btn-unlink').addEventListener('click', () => {
  editing = { ...editing, source: null, logbookId: null, typeLocked: false };
  applyLinkedUi();
});

async function searchPegel() {
  const list = $('#pegel-list');
  const lat = Number(spotForm.lat.value), lon = Number(spotForm.lon.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const selected = list.querySelector('input:checked')?.value ?? editing.pegel?.uuid ?? '';
  list.innerHTML = '<p class="muted small">Suche Messstationen …</p>';
  try {
    const stations = await nearestPegelStations(lat, lon, 6);
    if (editing.pegel && !stations.some((s) => s.uuid === editing.pegel.uuid)) {
      stations.unshift({ ...editing.pegel, water: '', dist: null, value: null, stale: false, current: true });
    }
    list.innerHTML = `<label><input type="radio" name="pegel" value=""> keine</label>` + stations.map((s) => `
      <label class="${s.stale ? 'stale' : ''}">
        <input type="radio" name="pegel" value="${esc(s.uuid)}" data-name="${esc(s.name)}">
        <span><strong>${esc(s.name)}</strong> <span class="muted">${esc(s.water)}${s.dist != null ? ` · ${fmt(s.dist, s.dist < 10 ? 1 : 0)} km` : ''}</span>
        · ${s.current ? 'aktuell gewählt' : s.stale ? 'keine aktuellen Daten' : `${fmt(s.value, 1)} °C`}</span>
      </label>`).join('') +
      '<p class="muted small">Nur sinnvoll, wenn die Station im selben Gewässer liegt. Viele Seen haben keine Station – dann den Wert unten manuell eintragen.</p>';
    const radio = list.querySelector(`input[value="${CSS.escape(selected)}"]`) ?? list.querySelector('input[value=""]');
    radio.checked = true;
    picker?.showStations(stations.filter((s) => s.lat != null), (s) => {
      const r = list.querySelector(`input[value="${CSS.escape(s.uuid)}"]`);
      if (r) r.checked = true;
    });
  } catch (err) {
    list.innerHTML = `<p class="muted small">Stationsliste nicht abrufbar (${esc(err.message)}).${editing.pegel ? ` Aktuell: ${esc(editing.pegel.name)}` : ''}</p>`;
  }
}

for (const name of ['lat', 'lon']) {
  spotForm[name].addEventListener('change', () => {
    picker?.setPosition(Number(spotForm.lat.value), Number(spotForm.lon.value));
    scheduleLocationUpdate();
  });
}
spotForm.addEventListener('change', (e) => {
  if (e.target.name === 'type') renderSpotThresholds();
});

const numOrNull = (v) => (v === '' || v == null ? null : Number(v));

spotForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = spotForm;
  const lat = Number(f.lat.value), lon = Number(f.lon.value);
  const winStart = Number(f.winStart.value), winEnd = Number(f.winEnd.value);
  if (!f.name.value.trim()) return f.name.focus();
  if (!f.lat.checkValidity() || !f.lon.checkValidity() || !Number.isFinite(lat) || !Number.isFinite(lon)) return f.lat.focus();
  if (!(winStart >= 0 && winEnd <= 23 && winStart <= winEnd)) {
    f.winEnd.setCustomValidity('„bis“ muss nach „ab“ liegen (0–23 Uhr).');
    f.winEnd.reportValidity();
    f.winEnd.setCustomValidity('');
    return;
  }

  const type = f.type.value;
  const pegelInput = $('#pegel-list input:checked');
  const own = readThresholdGrid($('.threshold-grid[data-scope="spot"]', f));
  const inherited = resolveThresholds(type, state.settings.thresholds);
  fillPairs(own, inherited);
  if (type === 'see') {
    delete own.wave;
    delete own.current;
  }

  const manual = { surface: numOrNull(f.mwSurface.value), depthTemp: numOrNull(f.mwDepthTemp.value), depth: numOrNull(f.mwDepth.value), date: f.mwDate.value || null };
  const spot = {
    ...editing,
    name: f.name.value.trim(),
    type,
    lat,
    lon,
    exposure: f.expFrom.value !== '' && f.expTo.value !== '' ? { from: Number(f.expFrom.value), to: Number(f.expTo.value) } : null,
    window: { start: winStart, end: winEnd },
    pegel: pegelInput?.value ? { uuid: pegelInput.value, name: pegelInput.dataset.name } : pegelInput ? null : editing.pegel,
    manualWater: manual.surface != null || manual.depthTemp != null ? manual : null,
    thresholds: Object.keys(own).length ? own : null,
    // Meer/See bewusst anders als im Logbuch gewählt → beim Abgleich nicht überschreiben
    typeLocked: editing.source === 'logbuch' && (editing.typeLocked || type !== editing.type),
  };

  const idx = state.spots.findIndex((s) => s.id === spot.id);
  if (idx >= 0) state.spots[idx] = spot;
  else state.spots.push(spot);
  saveSpots(state.spots);
  dlgSpot.close();
  state.selectedId = null; // erzwingt Neuladen auch beim selben Spot
  selectSpot(spot.id);
});

$('#btn-delete-spot').addEventListener('click', () => {
  const question = editing.source === 'logbuch'
    ? `„${editing.name}“ aus der Vorschau entfernen? Im Logbuch bleibt der Platz erhalten.`
    : `„${editing.name}“ wirklich löschen?`;
  if (!confirm(question)) return;
  state.spots = state.spots.filter((s) => s.id !== editing.id);
  saveSpots(state.spots);
  dlgSpot.close();
  selectSpot(state.spots[0]?.id ?? null);
});

dlgSpot.addEventListener('close', () => {
  clearTimeout(pegelTimer);
  clearTimeout(searchTimer);
  searchAbort?.abort();
  picker?.destroy();
  picker = null;
});

// Leaflet braucht die endgültige Größe, die erst nach dem Öffnen feststeht
new ResizeObserver(() => picker?.refresh()).observe($('#picker'));

// ---------- Einstellungen ----------

const dlgSettings = $('#dlg-settings');
const settingsForm = $('#settings-form');

function renderSettingsGrids(source) {
  for (const scope of ['meer', 'see']) {
    renderThresholdGrid($(`.threshold-grid[data-scope="${scope}"]`, settingsForm), ROWS_FOR[scope], resolveThresholds(scope, source), DEFAULT_THRESHOLDS[scope]);
  }
}

function openSettings() {
  renderSettingsGrids(state.settings.thresholds);
  dlgSettings.showModal();
}

$('#btn-reset-thresholds').addEventListener('click', () => renderSettingsGrids({}));

settingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const thresholds = {};
  for (const scope of ['meer', 'see']) {
    thresholds[scope] = { ...DEFAULT_THRESHOLDS[scope], ...fillPairs(readThresholdGrid($(`.threshold-grid[data-scope="${scope}"]`, settingsForm)), DEFAULT_THRESHOLDS[scope]) };
  }
  state.settings = { ...state.settings, thresholds };
  saveSettings(state.settings);
  dlgSettings.close();
  if (state.data) render();
});

$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([exportJson(state.spots, state.settings)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'tauchplaetze.json' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#file-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const { spots, settings } = parseImport(await file.text());
    if (!confirm(`${spots.length} Tauchplätze importieren? Plätze mit gleicher ID werden ersetzt.`)) return;
    for (const s of spots) {
      const idx = state.spots.findIndex((x) => x.id === s.id);
      if (idx >= 0) state.spots[idx] = s;
      else state.spots.push(s);
    }
    saveSpots(state.spots);
    if (settings?.thresholds && confirm('Die Datei enthält auch Grenzwerte. Übernehmen?')) {
      state.settings = { ...state.settings, thresholds: settings.thresholds };
      saveSettings(state.settings);
      renderSettingsGrids(state.settings.thresholds);
    }
    renderChips();
    if (!selectedSpot()) selectSpot(spots[0].id);
  } catch (err) {
    alert(`Import fehlgeschlagen: ${err.message}`);
  }
});

$('#btn-examples').addEventListener('click', () => {
  const missing = EXAMPLE_SPOTS.filter((ex) => !state.spots.some((s) => s.id === ex.id));
  if (!missing.length) return alert('Die Beispiel-Spots sind bereits vorhanden.');
  state.spots.push(...structuredClone(missing));
  saveSpots(state.spots);
  renderChips();
  if (!selectedSpot()) selectSpot(missing[0].id);
});

document.querySelectorAll('dialog [data-close]').forEach((btn) => btn.addEventListener('click', () => btn.closest('dialog').close()));

// ---------- Logbuch ----------

const dlgLb = $('#dlg-logbook');
const lbForm = $('#lb-login');
const LB_EMAIL_KEY = 'tbv.logbook.email';
let lbSites = [];
let lbChecked = new Set();
let lbVisible = [];

function showLbView(view) {
  $('#lb-loading').hidden = view !== 'loading';
  lbForm.hidden = view !== 'login';
  $('#lb-sites').hidden = view !== 'sites';
  $('#btn-lb-apply').hidden = view !== 'sites';
  $('#lb-count').textContent = '';
}

function lbMessage(text, isError = false) {
  const msg = $('#lb-msg');
  msg.textContent = text;
  msg.classList.toggle('err', isError);
}

// Supabase-Fehler in verständliches Deutsch
function lbErrorText(err) {
  const m = String(err?.message ?? err);
  if (/signups not allowed/i.test(m)) return 'Für diese E-Mail-Adresse gibt es kein Logbuch-Konto.';
  if (/expired|invalid.*(token|otp)|token.*invalid/i.test(m)) return 'Code ungültig oder abgelaufen – bitte neu anfordern.';
  if (/invalid login credentials/i.test(m)) return 'E-Mail oder Passwort falsch.';
  if (/rate limit|only request this after/i.test(m)) return 'Zu viele Versuche – bitte kurz warten und erneut probieren.';
  if (/failed to fetch|network/i.test(m)) return 'Keine Verbindung – bist du offline?';
  return m;
}

function showLbLogin() {
  showLbView('login');
  try {
    lbForm.email.value = localStorage.getItem(LB_EMAIL_KEY) ?? '';
  } catch {
    // ohne gemerkte Adresse
  }
  lbForm.code.value = '';
  lbForm.password.value = '';
  $('#lb-code-step').hidden = false;
  $('#lb-code-entry').hidden = true;
  $('#lb-pw-step').hidden = true;
  lbMessage('');
  (lbForm.email.value ? $('#btn-lb-send') : lbForm.email).focus();
}

async function openLogbook() {
  showLbView('loading');
  $('#lb-loading').textContent = 'Verbinde mit dem Logbuch …';
  dlgLb.showModal();
  try {
    const user = await getUser();
    if (user) await showLbSites(user);
    else showLbLogin();
  } catch (err) {
    $('#lb-loading').textContent = `Logbuch nicht erreichbar: ${lbErrorText(err)}`;
  }
}

function rememberEmail() {
  try {
    localStorage.setItem(LB_EMAIL_KEY, lbForm.email.value.trim());
  } catch {
    // egal
  }
}


$('#btn-lb-send').addEventListener('click', async () => {
  if (!lbForm.email.checkValidity() || !lbForm.email.value.trim()) {
    lbForm.email.reportValidity();
    return;
  }
  lbMessage('Sende Code …');
  try {
    await sendCode(lbForm.email.value);
    rememberEmail();
    $('#lb-code-entry').hidden = false;
    lbMessage(`Code an ${lbForm.email.value.trim()} gesendet. Bitte aus der E-Mail abtippen.`);
    lbForm.code.focus();
  } catch (err) {
    lbMessage(lbErrorText(err), true);
  }
});

$('#btn-lb-pw-toggle').addEventListener('click', () => {
  $('#lb-code-step').hidden = true;
  $('#lb-pw-step').hidden = false;
  lbMessage('');
  lbForm.password.focus();
});

$('#btn-lb-code-toggle').addEventListener('click', () => {
  $('#lb-pw-step').hidden = true;
  $('#lb-code-step').hidden = false;
  lbMessage('');
});

lbForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const withPassword = !$('#lb-pw-step').hidden;
  if (!lbForm.email.value.trim()) return lbForm.email.focus();
  if (withPassword ? !lbForm.password.value : !lbForm.code.value.trim()) return (withPassword ? lbForm.password : lbForm.code).focus();
  lbMessage('Melde an …');
  try {
    if (withPassword) await signInWithPassword(lbForm.email.value, lbForm.password.value);
    else await verifyCode(lbForm.email.value, lbForm.code.value);
    rememberEmail();
    await showLbSites(await getUser());
  } catch (err) {
    lbMessage(lbErrorText(err), true);
  }
});

$('#btn-lb-logout').addEventListener('click', async () => {
  await signOut().catch(() => {});
  showLbLogin();
});

async function showLbSites(user) {
  showLbView('sites');
  $('#btn-lb-apply').disabled = true;
  $('#lb-user').textContent = `Angemeldet als ${user?.email ?? ''}`;
  $('#lb-filter').value = '';
  $('#lb-list').innerHTML = '<p class="muted small" style="padding:10px 12px">Lade Tauchplätze …</p>';
  try {
    lbSites = await fetchSites();
  } catch (err) {
    $('#lb-list').innerHTML = `<p class="muted small" style="padding:10px 12px">Tauchplätze nicht abrufbar: ${esc(lbErrorText(err))}</p>`;
    return;
  }
  lbChecked = new Set(state.spots.filter((s) => s.logbookId).map((s) => s.logbookId));
  // Bereits gewählte zuerst, dann deutsche, dann alphabetisch – einmalig, damit nichts beim Anklicken springt
  const rank = (s) => (lbChecked.has(s.id) ? 0 : s.country === 'DE' ? 1 : 2);
  lbSites.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'de'));
  $('#btn-lb-apply').disabled = false;
  renderLbList();
}

function renderLbList() {
  const terms = $('#lb-filter').value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean);
  const visible = (lbVisible = lbSites.filter((s) => {
    const hay = `${s.name} ${s.region} ${s.water} ${s.country}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return terms.every((t) => hay.includes(t));
  }));
  $('#lb-list').innerHTML = visible.length
    ? visible.map((s) => `
      <label>
        <input type="checkbox" data-id="${esc(s.id)}" ${lbChecked.has(s.id) ? 'checked' : ''}>
        <span class="site-main"><strong>${esc(s.name)}</strong><br>
          <span class="muted">${[s.type === 'see' ? 'See' : 'Meer', s.water, s.region, s.country].filter(Boolean).map(esc).join(' · ')}</span>
        </span>
      </label>`).join('')
    : '<p class="muted small lb-empty">Keine Treffer.</p>';
  updateLbSelection(terms.length > 0);
}

// Zähler und „Alle auswählen“ – bezieht sich auf die gerade sichtbaren (gefilterten) Plätze
function updateLbSelection(filtered = $('#lb-filter').value.trim() !== '') {
  const all = $('#lb-all');
  const chosen = lbVisible.filter((s) => lbChecked.has(s.id)).length;
  all.disabled = lbVisible.length === 0;
  all.checked = lbVisible.length > 0 && chosen === lbVisible.length;
  all.indeterminate = chosen > 0 && chosen < lbVisible.length;
  $('#lb-all-label').textContent = filtered ? `Alle ${lbVisible.length} Treffer auswählen` : `Alle ${lbVisible.length} auswählen`;
  $('#lb-count').textContent = `${lbChecked.size} ausgewählt`;
}

$('#lb-all').addEventListener('change', (e) => {
  for (const s of lbVisible) {
    if (e.target.checked) lbChecked.add(s.id);
    else lbChecked.delete(s.id);
  }
  $('#lb-list').querySelectorAll('input[data-id]').forEach((cb) => {
    cb.checked = lbChecked.has(cb.dataset.id);
  });
  updateLbSelection();
});

$('#lb-filter').addEventListener('input', renderLbList);
$('#lb-list').addEventListener('change', (e) => {
  const id = e.target.dataset.id;
  if (!id) return;
  if (e.target.checked) lbChecked.add(id);
  else lbChecked.delete(id);
  updateLbSelection();
});

$('#btn-lb-apply').addEventListener('click', () => {
  const linkedIds = new Set(state.spots.filter((s) => s.logbookId).map((s) => s.logbookId));
  const added = lbSites
    .filter((site) => lbChecked.has(site.id) && !linkedIds.has(site.id))
    .map((site) => applySite(blankSpot(site.lat, site.lon), site));
  const removed = [...linkedIds].filter((id) => !lbChecked.has(id));
  if (removed.length && !confirm(`${removed.length === 1 ? '1 Platz' : `${removed.length} Plätze`} aus der Vorschau entfernen? Eigene Einstellungen dazu (Uferrichtung, Station …) gehen verloren.`)) return;
  state.spots = state.spots.filter((s) => !s.logbookId || !removed.includes(s.logbookId)).concat(added);
  saveSpots(state.spots);
  dlgLb.close();
  if (added.length) selectSpot(added[0].id);
  else if (!selectedSpot()) selectSpot(state.spots[0]?.id ?? null);
  else renderChips();
});

// Verknüpfte Spots beim Start mit dem Logbuch abgleichen (Name, Position, Gewässer)
async function syncLogbook() {
  if (!hasStoredSession() || !state.spots.some((s) => s.logbookId)) return;
  try {
    const byId = new Map((await fetchSites()).map((s) => [s.id, s]));
    let changed = false, selectedChanged = false;
    state.spots = state.spots.map((spot) => {
      const site = spot.logbookId && byId.get(spot.logbookId);
      if (!site) return spot;
      const next = applySite(spot, site);
      if (next.name !== spot.name || next.lat !== spot.lat || next.lon !== spot.lon || next.type !== spot.type) {
        changed = true;
        if (spot.id === state.selectedId) selectedChanged = true;
      }
      return next;
    });
    if (!changed) return;
    saveSpots(state.spots);
    renderChips();
    if (selectedChanged) {
      state.data = null;
      load();
    }
  } catch {
    // Offline oder abgemeldet – dann mit dem letzten Stand weiter
  }
}

// ---------- Start ----------

// Navigation (Seitenleiste und Reiterleiste): Vorschau ist die Seite, der Rest öffnet Dialoge
document.addEventListener('click', (e) => {
  const item = e.target.closest('[data-nav]');
  if (!item) return;
  const target = item.dataset.nav;
  if (target === 'vorschau') window.scrollTo({ top: 0, behavior: 'smooth' });
  else if (target === 'logbuch') openLogbook();
  else if (target === 'neu') openSpotEditor(null);
  else if (target === 'einstellungen') openSettings();
});

// Erscheinungsbild: Automatisch / Hell / Dunkel – wie im Logbuch
const THEME_KEY = 'tbv:theme';
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

function themeChoice() {
  try {
    return localStorage.getItem(THEME_KEY) ?? 'system';
  } catch {
    return 'system';
  }
}

function applyTheme() {
  const choice = themeChoice();
  const dark = choice === 'dark' || (choice === 'system' && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#0b1220' : '#f5f7fa';
  document.querySelectorAll('[data-theme-choice]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeChoice === choice)));
  if (state.data) renderDetail(); // Diagrammfarben neu lesen
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-theme-choice]');
  if (!btn) return;
  try {
    localStorage.setItem(THEME_KEY, btn.dataset.themeChoice);
  } catch {
    // nur für diese Sitzung
  }
  applyTheme();
});

hydrateIcons();
applyTheme();
pruneCache();

window.addEventListener('online', () => state.data?.stale && load(true));

// Systemwechsel nur übernehmen, wenn „Automatisch“ gewählt ist
darkQuery.addEventListener('change', () => themeChoice() === 'system' && applyTheme());

if (!selectedSpot()) state.selectedId = state.spots[0]?.id ?? null;
renderChips();
load();
syncLogbook();

// Dauerhaften Speicher anfordern: Der Browser räumt die Plätze dann nicht von sich aus weg
// (z. B. bei Platzmangel). Bewusstes Löschen der Websitedaten verhindert das nicht.
navigator.storage?.persist?.().catch(() => {});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
