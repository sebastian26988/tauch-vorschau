// Datenabruf: Open-Meteo (Wetter + Marine) und PEGELONLINE (Wassertemperatur)
// Antworten werden mit Zeitstempel in localStorage gehalten, damit die App offline den letzten Stand zeigt.
import { kmhToKn, distanceKm } from './units.js';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
const PEGEL_URL = 'https://www.pegelonline.wsv.de/webservices/rest-api/v2';

const MIN = 60 * 1000;
const FORECAST_MAX_AGE = 30 * MIN;
const PEGEL_MAX_AGE = 30 * MIN;
const STATIONS_MAX_AGE = 12 * 60 * MIN;
export const PEGEL_STALE_MS = 48 * 60 * MIN;

const FORECAST_VARS = ['temperature_2m', 'precipitation', 'weather_code', 'cloud_cover', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m'];
const MARINE_VARS = [
  'wave_height', 'wave_direction', 'wave_period', 'wind_wave_height',
  'swell_wave_height', 'swell_wave_period', 'swell_wave_direction',
  'sea_surface_temperature', 'ocean_current_velocity', 'ocean_current_direction', 'sea_level_height_msl',
];

function cacheRead(key) {
  try {
    return JSON.parse(localStorage.getItem(`tbv.cache.${key}`));
  } catch {
    return null;
  }
}

function cacheWrite(key, data) {
  try {
    localStorage.setItem(`tbv.cache.${key}`, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // Kein Platz – dann eben ohne Offline-Kopie
  }
}

// Holt JSON mit Cache: frischer Cache wird direkt genutzt, bei Netzfehler der letzte Stand (stale)
async function getJson(url, key, maxAge, force) {
  const cached = cacheRead(key);
  if (!force && cached && Date.now() - cached.ts < maxAge) return { data: cached.data, ts: cached.ts, stale: false };
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    cacheWrite(key, data);
    return { data, ts: Date.now(), stale: false };
  } catch (err) {
    if (cached) return { data: cached.data, ts: cached.ts, stale: true, error: err.message };
    throw err;
  }
}

// Zwischengespeicherte Antworten, die niemand mehr braucht, entfernen. Jede Koordinate und jede
// Station legt einen eigenen Eintrag an; ohne Aufräumen wüchse der Speicher mit jedem Platz, der je
// angesehen wurde. Älter als eine Woche ist auch als Offline-Stand wertlos – die Vorhersage reicht
// nur sieben Tage weit.
export const CACHE_KEEP_MS = 7 * 24 * 60 * MIN;

export function pruneCache(now = Date.now(), storage = globalThis.localStorage) {
  let removed = 0;
  try {
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (!key?.startsWith('tbv.cache.')) continue;
      let ts = null;
      try {
        ts = JSON.parse(storage.getItem(key))?.ts ?? null;
      } catch {
        // kaputter Eintrag – weg damit
      }
      if (ts == null || now - ts > CACHE_KEEP_MS) {
        storage.removeItem(key);
        removed++;
      }
    }
  } catch {
    // Speicher gesperrt – nichts zu tun
  }
  return removed;
}

const coordKey = (lat, lon) => `${lat.toFixed(3)},${lon.toFixed(3)}`;

function fetchForecast(lat, lon, force) {
  const params = new URLSearchParams({
    latitude: lat, longitude: lon,
    hourly: FORECAST_VARS.join(','),
    daily: 'sunrise,sunset',
    wind_speed_unit: 'kn',
    timezone: 'auto',
    forecast_days: 7,
  });
  return getJson(`${FORECAST_URL}?${params}`, `fc.${coordKey(lat, lon)}`, FORECAST_MAX_AGE, force);
}

function fetchMarine(lat, lon, force) {
  const params = new URLSearchParams({
    latitude: lat, longitude: lon,
    hourly: MARINE_VARS.join(','),
    timezone: 'auto',
    forecast_days: 7,
  });
  return getJson(`${MARINE_URL}?${params}`, `mar.${coordKey(lat, lon)}`, FORECAST_MAX_AGE, force);
}

function fetchPegelWT(uuid, force) {
  return getJson(`${PEGEL_URL}/stations/${uuid}/WT/measurements.json?start=P7D`, `wt.${uuid}`, PEGEL_MAX_AGE, force);
}

export async function fetchPegelStations() {
  const url = `${PEGEL_URL}/stations.json?timeseries=WT&includeTimeseries=true&includeCurrentMeasurement=true`;
  const { data } = await getJson(url, 'wt-stations', STATIONS_MAX_AGE, false);
  return data.map((s) => {
    const wt = s.timeseries?.find((t) => t.shortname === 'WT');
    const cm = wt?.currentMeasurement;
    const ts = cm ? Date.parse(cm.timestamp) : null;
    return {
      uuid: s.uuid,
      name: s.longname,
      water: s.water?.longname ?? '',
      lat: s.latitude,
      lon: s.longitude,
      value: cm?.value ?? null,
      ts,
      stale: !ts || Date.now() - ts > PEGEL_STALE_MS,
    };
  }).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
}

export async function nearestPegelStations(lat, lon, n = 6) {
  const stations = await fetchPegelStations();
  return stations
    .map((s) => ({ ...s, dist: distanceKm(lat, lon, s.lat, s.lon) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, n);
}

// Pegel-Messreihe auf volle Stunden in lokaler Zeit ("YYYY-MM-DDTHH:00") verdichten
function pegelHourly(measurements) {
  const byHour = new Map();
  for (const m of measurements) {
    if (m.value == null) continue;
    // Zeitstempel enthält bereits den lokalen Offset → die ersten 13 Zeichen sind lokale Stunde
    byHour.set(`${m.timestamp.slice(0, 13)}:00`, m.value);
  }
  return [...byHour].map(([time, value]) => ({ time, value }));
}

/**
 * Lädt alle Daten für einen Spot und führt sie stündlich zusammen.
 * Fehler einzelner Zusatzquellen (Marine, Pegel) brechen nicht alles ab, sondern landen in `warnings`.
 */
export async function loadConditions(spot, { force = false } = {}) {
  const warnings = [];
  // Alle Quellen gleichzeitig anfragen – nacheinander addierten sich die Wartezeiten
  const [forecast, marine, pegel] = await Promise.all([
    fetchForecast(spot.lat, spot.lon, force),
    spot.type === 'meer'
      ? fetchMarine(spot.lat, spot.lon, force).catch((err) => {
        warnings.push(`Seegangsdaten nicht verfügbar (${err.message}).`);
        return null;
      })
      : null,
    spot.pegel?.uuid
      ? fetchPegelWT(spot.pegel.uuid, force).catch((err) => {
        warnings.push(`Pegel ${spot.pegel.name}: Wassertemperatur nicht abrufbar (${err.message}).`);
        return null;
      })
      : null,
  ]);

  const f = forecast.data.hourly;
  const m = marine?.data?.hourly;
  const marineIndex = new Map((m?.time ?? []).map((t, i) => [t, i]));
  const mv = (name, t) => {
    const i = marineIndex.get(t);
    return i == null ? null : m[name]?.[i] ?? null;
  };

  const hours = f.time.map((time, i) => ({
    time,
    temp: f.temperature_2m[i],
    precip: f.precipitation[i],
    code: f.weather_code[i],
    cloud: f.cloud_cover[i],
    wind: f.wind_speed_10m[i],
    gust: f.wind_gusts_10m[i],
    windDir: f.wind_direction_10m[i],
    wave: mv('wave_height', time),
    waveDir: mv('wave_direction', time),
    wavePeriod: mv('wave_period', time),
    windWave: mv('wind_wave_height', time),
    swell: mv('swell_wave_height', time),
    swellPeriod: mv('swell_wave_period', time),
    swellDir: mv('swell_wave_direction', time),
    sst: mv('sea_surface_temperature', time),
    current: kmhToKn(mv('ocean_current_velocity', time)),
    currentDir: mv('ocean_current_direction', time),
    seaLevel: mv('sea_level_height_msl', time),
  }));

  if (marine && !hours.some((h) => h.wave != null)) {
    warnings.push('Für diese Koordinaten liefert das Seegangsmodell keine Werte (zu weit im Binnenland oder in einer engen Bucht). Spot etwas seewärts setzen.');
  }

  const pegelSeries = pegel ? pegelHourly(pegel.data) : [];
  const lastPegel = pegel?.data?.length ? pegel.data[pegel.data.length - 1] : null;
  if (lastPegel && Date.now() - Date.parse(lastPegel.timestamp) > PEGEL_STALE_MS) {
    warnings.push(`Pegel ${spot.pegel.name}: letzter Messwert ist älter als 48 h.`);
  }

  const daily = forecast.data.daily;
  const days = daily.time.map((date, i) => ({ date, sunrise: daily.sunrise[i], sunset: daily.sunset[i] }));

  const parts = [forecast, marine, pegel].filter(Boolean);
  return {
    hours,
    days,
    pegel: lastPegel ? { series: pegelSeries, last: lastPegel } : null,
    utcOffsetSeconds: forecast.data.utc_offset_seconds,
    ts: Math.min(...parts.map((p) => p.ts)),
    stale: parts.some((p) => p.stale),
    warnings,
  };
}
