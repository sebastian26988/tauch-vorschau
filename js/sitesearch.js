// Tauchplatz-Suche – übernommen aus der Logbuch-App (src/lib/siteSearch.ts, osmVerzeichnis.ts).
// Quellen: eigene Logbuch-Plätze, OSM-Tauchplatzverzeichnis (live aus der Logbuch-App), Diveboard über GBIF, Nominatim.
import { distanceKm, fmt } from './units.js';
import { DIRECTORY_URL } from './config.js';
const GBIF_DIVEBOARD_DATASET = '66f6192f-6cc0-45fd-a2d1-e76f5ae3eab2';

export const normalize = (value) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const begriffeAus = (suche) => normalize(suche).split(/\s+/).filter(Boolean);
const passt = (heuhaufen, begriffe) => begriffe.every((b) => heuhaufen.includes(b));

let verzeichnis = null;

// Einmal je Sitzung laden; ein Fehlschlag darf beim nächsten Versuch neu probieren
function ladeVerzeichnis() {
  verzeichnis ??= fetch(DIRECTORY_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`Verzeichnis nicht erreichbar (${res.status})`);
      return res.json();
    })
    .then((roh) => roh.eintraege.map(([name, lat, lon, maxTiefeM, einstieg, basis, osm]) => ({
      name, lat, lon, maxTiefeM, einstieg, basis: basis === 1, osm, suchname: normalize(name),
    })))
    .catch((err) => {
      verzeichnis = null;
      throw err;
    });
  return verzeichnis;
}

const EINSTIEG = { boat: 'vom Boot', shore: 'vom Ufer', pier: 'vom Steg', ladder: 'über Leiter' };
const einstiegLabel = (e) => (e ? e.split(';').map((t) => EINSTIEG[t.trim()] ?? t.trim()).join(', ') : null);

function ausVerzeichnis(e) {
  return {
    label: e.name,
    detail: [e.maxTiefeM != null ? `bis ${fmt(e.maxTiefeM)} m` : null, einstiegLabel(e.einstieg)].filter(Boolean).join(' · ') || null,
    lat: e.lat,
    lon: e.lon,
    source: 'osm',
  };
}

// Doppelt kodierte Umlaute aus dem Diveboard-Datensatz reparieren ("IbbenbÃ¼ren")
export function repairMojibake(text) {
  if (!/[ÃÂ][\u0080-¿]/.test(text)) return text;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from([...text].map((c) => c.charCodeAt(0) & 0xff)));
  } catch {
    return text;
  }
}

// Eingefügte Koordinate: "54.45, 10.19", "54,45 10,19", auch mit Vorzeichen
export function parseCoordinates(input) {
  const cleaned = input.trim().replace(/[()]/g, '');
  const match = cleaned.match(/^(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/)
    ?? cleaned.match(/^(-?\d{1,3}\.\d+)\s*[,;]?\s+(-?\d{1,3}\.\d+)$/)
    ?? cleaned.match(/^(-?\d{1,3},\d+)\s+(-?\d{1,3},\d+)$/);
  if (!match) return null;
  const lat = Number(match[1].replace(',', '.'));
  const lon = Number(match[2].replace(',', '.'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

// Gleicher Ort aus mehreren Quellen (ähnlicher Name, < 300 m): der zuerst einsortierte gewinnt
function mergeHits(hits) {
  const result = [];
  for (const hit of hits) {
    const a = hit.label.toLowerCase();
    const twin = result.find((x) => distanceKm(x.lat, x.lon, hit.lat, hit.lon) < 0.3 && (x.label.toLowerCase().includes(a) || a.includes(x.label.toLowerCase())));
    if (!twin) result.push(hit);
  }
  return result;
}

async function searchDiveboard(query, signal) {
  const url = `https://api.gbif.org/v1/occurrence/search?datasetKey=${GBIF_DIVEBOARD_DATASET}&q=${encodeURIComponent(query)}&limit=60`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Diveboard antwortete mit ${res.status}`);
  const body = await res.json();
  // Beobachtungen, nicht Plätze – ein Platz kommt vielfach vor
  const seen = new Map();
  for (const e of body.results ?? []) {
    if (!e.locality || e.decimalLatitude == null || e.decimalLongitude == null) continue;
    const label = repairMojibake(e.locality).trim();
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.set(label.toLowerCase(), { label, detail: e.country ? repairMojibake(e.country) : null, lat: e.decimalLatitude, lon: e.decimalLongitude, source: 'diveboard' });
  }
  return [...seen.values()];
}

async function searchNominatim(query, signal) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&accept-language=de&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Nominatim antwortete mit ${res.status}`);
  const body = await res.json();
  return body.map((e) => ({
    label: e.name || (e.display_name ?? '').split(',')[0],
    detail: (e.display_name ?? '').split(',').slice(1, 4).join(',').trim() || null,
    lat: Number(e.lat),
    lon: Number(e.lon),
    source: 'nominatim',
  }));
}

export const SOURCE_LABEL = { logbuch: 'Logbuch', osm: 'Verzeichnis', diveboard: 'Diveboard', nominatim: 'Karte', coordinates: 'Koordinate' };

/**
 * Sucht einen Tauchplatz. logbookSites: [{ id, name, lat, lon, type, region, country }] (optional).
 * Liefert { hits, failed } – ausgefallene Quellen blockieren die anderen nicht.
 */
export async function searchPlaces(query, { signal, logbookSites = [] } = {}) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return { hits: [], failed: [] };

  const coords = parseCoordinates(trimmed);
  if (coords) {
    return { hits: [{ label: 'Eingefügte Koordinate', detail: `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`, ...coords, source: 'coordinates' }], failed: [] };
  }

  const begriffe = begriffeAus(trimmed);
  const eigene = logbookSites
    .filter((s) => passt(normalize(`${s.name} ${s.region ?? ''}`), begriffe))
    .slice(0, 6)
    .map((s) => ({ label: s.name, detail: [s.region, s.country].filter(Boolean).join(', ') || null, lat: s.lat, lon: s.lon, source: 'logbuch', site: s }));

  const [diveboard, osm, nominatim] = await Promise.allSettled([
    searchDiveboard(trimmed, signal),
    ladeVerzeichnis().then((v) => v.filter((e) => !e.basis && passt(e.suchname, begriffe)).slice(0, 8).map(ausVerzeichnis)),
    searchNominatim(trimmed, signal),
  ]);

  const failed = [];
  // Reihenfolge = Vorrang beim Zusammenführen: eigene Plätze, Tauchernamen, Verzeichnis, Karte
  const hits = [...eigene];
  if (diveboard.status === 'fulfilled') hits.push(...diveboard.value);
  else if (diveboard.reason?.name !== 'AbortError') failed.push('Diveboard');
  if (osm.status === 'fulfilled') hits.push(...osm.value);
  else failed.push('Tauchplatzverzeichnis');
  if (nominatim.status === 'fulfilled') hits.push(...nominatim.value);
  else if (nominatim.reason?.name !== 'AbortError') failed.push('OpenStreetMap');

  return { hits: mergeHits(hits), failed };
}

/** Tauchplätze aus dem Verzeichnis im Umkreis (Standard 25 km), das Nächste zuerst. */
export async function searchNearby(lat, lon, radiusKm = 25, max = 15) {
  const v = await ladeVerzeichnis();
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  return v
    .filter((e) => !e.basis && Math.abs(e.lat - lat) <= dLat && Math.abs(e.lon - lon) <= dLon)
    .map((e) => ({ ...ausVerzeichnis(e), dist: distanceKm(lat, lon, e.lat, e.lon) }))
    .filter((e) => e.dist <= radiusKm)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, max);
}
