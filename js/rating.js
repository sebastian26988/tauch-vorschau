// Ampel-Bewertung: reine Funktionen ohne DOM-Zugriff (siehe tests/rating.test.mjs)
import { inSector, knToBft, fmt } from './units.js';

export const GREEN = 0;
export const YELLOW = 1;
export const RED = 2;

export const LEVEL_LABEL = ['Gut', 'Grenzwertig', 'Nicht tauchbar'];
export const LEVEL_CLASS = ['green', 'yellow', 'red'];

// [Grenze grün, Grenze gelb]; darüber rot
export const DEFAULT_THRESHOLDS = {
  meer: {
    wind: [10, 16],
    gust: [15, 22],
    wave: [0.5, 1.0],
    swellHeight: 1.0, // lange Dünung ab dieser Höhe …
    swellPeriod: 8, // … und dieser Periode → mindestens gelb
    // Oberflächenströmung aus dem Meeresmodell (~8 km Raster). Bewusst großzügig: Das Modell ist an der
    // Küste grob, und Gezeitenströmung um Inseln ist echt, aber oft nur zeitweise.
    current: [0.7, 1.5],
    onshoreFactor: 0.7, // Grenzwerte bei auflandigem Wind/Seegang × Faktor
  },
  see: {
    wind: [12, 18],
    gust: [18, 25],
    onshoreFactor: 0.7,
  },
};

const clone = (o) => JSON.parse(JSON.stringify(o));

// Defaults ← globale Einstellungen ← Spot-Override
export function resolveThresholds(type, globalThresholds, spotOverride) {
  const base = clone(DEFAULT_THRESHOLDS[type] ?? DEFAULT_THRESHOLDS.meer);
  return Object.assign(base, globalThresholds?.[type] ? clone(globalThresholds[type]) : {}, spotOverride ? clone(spotOverride) : {});
}

function classify(value, [green, yellow], factor = 1) {
  if (value == null) return GREEN;
  if (value <= green * factor) return GREEN;
  if (value <= yellow * factor) return YELLOW;
  return RED;
}

const isOnshore = (spot, dir) => !!spot.exposure && inSector(dir, spot.exposure.from, spot.exposure.to);

/**
 * Bewertet eine Stunde.
 * h: { wind, gust, windDir, code, wave, waveDir, swell, swellPeriod, swellDir }
 * Liefert { level, reasons: [{ key, level, value, onshore?, extra? }] } – reasons nur für gelb/rot.
 */
export function rateHour(h, spot, th) {
  const reasons = [];
  const add = (key, level, value, more = {}) => {
    if (level > GREEN) reasons.push({ key, level, value, ...more });
  };

  const windOnshore = isOnshore(spot, h.windDir);
  const windFactor = windOnshore ? th.onshoreFactor : 1;
  add('wind', classify(h.wind, th.wind, windFactor), h.wind, { onshore: windOnshore });
  add('gust', classify(h.gust, th.gust, windFactor), h.gust, { onshore: windOnshore });

  if (spot.type === 'meer') {
    const waveOnshore = isOnshore(spot, h.waveDir);
    add('wave', classify(h.wave, th.wave, waveOnshore ? th.onshoreFactor : 1), h.wave, { onshore: waveOnshore });

    add('current', classify(h.current, th.current ?? DEFAULT_THRESHOLDS.meer.current), h.current, { dir: h.currentDir });

    if (h.swell != null && h.swellPeriod != null && h.swell >= th.swellHeight && h.swellPeriod >= th.swellPeriod) {
      add('swell', YELLOW, h.swell, { extra: h.swellPeriod });
    }
  }

  if (h.code != null && h.code >= 95) add('storm', RED, h.code);

  const level = reasons.reduce((max, r) => Math.max(max, r.level), GREEN);
  return { level, reasons };
}

// Pro Kriterium den schlimmsten Grund behalten (erst Stufe, dann Wert)
export function mergeReasons(reasonLists) {
  const byKey = new Map();
  for (const r of reasonLists.flat()) {
    const cur = byKey.get(r.key);
    if (!cur || r.level > cur.level || (r.level === cur.level && (r.value ?? 0) > (cur.value ?? 0))) byKey.set(r.key, r);
  }
  const order = ['storm', 'gust', 'wind', 'wave', 'current', 'swell'];
  return [...byKey.values()].sort((a, b) => b.level - a.level || order.indexOf(a.key) - order.indexOf(b.key));
}

export const hourOf = (time) => Number(time.slice(11, 13));

export function inWindow(time, spot) {
  const hour = hourOf(time);
  const { start = 8, end = 18 } = spot.window ?? {};
  return hour >= start && hour <= end;
}

/**
 * Bewertet einen Tag: schlechteste Stunde im Tauchfenster.
 * `nowIso` (lokale Zeit "YYYY-MM-DDTHH:MM") blendet bereits vergangene Stunden aus.
 */
export function rateDay(hours, spot, th, nowIso = null) {
  const nowHour = nowIso ? nowIso.slice(0, 13) : null;
  let relevant = hours.filter((h) => inWindow(h.time, spot));
  if (nowHour) {
    const upcoming = relevant.filter((h) => h.time.slice(0, 13) >= nowHour);
    if (upcoming.length) relevant = upcoming;
  }
  const rated = relevant.map((h) => rateHour(h, spot, th));
  const level = rated.reduce((max, r) => Math.max(max, r.level), GREEN);
  return { level, reasons: mergeReasons(rated.map((r) => r.reasons)), hoursRated: rated.length };
}

// Kurzform für die Tageskachel – passt in eine schmale Kachel
export function reasonShort(r) {
  const on = r.onshore ? ' auflandig' : '';
  switch (r.key) {
    case 'wind': return `Wind ${fmt(r.value)} kn${on}`;
    case 'gust': return `Böen ${fmt(r.value)} kn${on}`;
    case 'wave': return `Welle ${fmt(r.value, 1)} m${on}`;
    case 'swell': return `Dünung ${fmt(r.value, 1)} m / ${fmt(r.extra)} s`;
    case 'current': return `Strömung ${fmt(r.value, 1)} kn`;
    case 'storm': return 'Gewitter';
    default: return r.key;
  }
}

export function reasonText(r) {
  const on = r.onshore ? ', auflandig' : '';
  switch (r.key) {
    case 'wind': return `Wind ${fmt(r.value)} kn (${knToBft(r.value)} Bft${on})`;
    case 'gust': return `Böen ${fmt(r.value)} kn${r.onshore ? ' (auflandig)' : ''}`;
    case 'wave': return `Welle ${fmt(r.value, 1)} m${r.onshore ? ' (auflandig)' : ''}`;
    case 'current': return `Strömung ${fmt(r.value, 1)} kn (Modell, Oberfläche)`;
    case 'swell': return `Lange Dünung ${fmt(r.value, 1)} m / ${fmt(r.extra)} s – Brandung am Einstieg`;
    case 'storm': return 'Gewitter';
    default: return r.key;
  }
}
