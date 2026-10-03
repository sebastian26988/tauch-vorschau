// Tauchplätze und Einstellungen in localStorage

const SPOTS_KEY = 'tbv.spots';
const SETTINGS_KEY = 'tbv.settings';
const SELECTED_KEY = 'tbv.selected';

export const EXAMPLE_SPOTS = [
  {
    id: 'bsp-buelk',
    name: 'Kieler Förde – Bülk',
    type: 'meer',
    lat: 54.4547,
    lon: 10.1983,
    exposure: { from: 315, to: 90 },
    window: { start: 8, end: 18 },
    pegel: null,
    manualWater: null,
    thresholds: null,
  },
  {
    id: 'bsp-helgoland',
    name: 'Helgoland',
    type: 'meer',
    lat: 54.1789,
    lon: 7.8899,
    exposure: null,
    window: { start: 8, end: 18 },
    pegel: { uuid: 'c0ec139b-13b4-4f86-bee3-06665ad81a40', name: 'HELGOLAND BINNENHAFEN' },
    manualWater: null,
    thresholds: null,
  },
  {
    id: 'bsp-mueritz',
    name: 'Müritz – Waren',
    type: 'see',
    lat: 53.5144,
    lon: 12.6742,
    exposure: { from: 135, to: 225 },
    window: { start: 8, end: 18 },
    pegel: { uuid: 'bd317edd-214a-4e11-a9dc-3cc71a2907c3', name: 'WAREN' },
    manualWater: null,
    thresholds: null,
  },
];

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Speicher voll oder gesperrt (z. B. privater Modus) – App läuft ohne Persistenz weiter
  }
}

// Leerer Speicher → leere Liste. Beispiel-Spots nur auf Wunsch (Einstellungen), damit nach einem
// geleerten Browser-Speicher nicht plötzlich fremde Plätze statt der eigenen auftauchen.
export const loadSpots = () => read(SPOTS_KEY, null) ?? [];
export const saveSpots = (spots) => write(SPOTS_KEY, spots);

export const loadSettings = () => read(SETTINGS_KEY, { thresholds: {} });
export const saveSettings = (settings) => write(SETTINGS_KEY, settings);

export const loadSelectedId = () => read(SELECTED_KEY, null);
export const saveSelectedId = (id) => write(SELECTED_KEY, id);

export const newSpotId = () => `spot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export function blankSpot(lat = 54.3, lon = 10.5) {
  return {
    id: newSpotId(),
    name: '',
    type: 'meer',
    lat,
    lon,
    exposure: null,
    window: { start: 8, end: 18 },
    pegel: null,
    manualWater: null,
    thresholds: null,
    source: null, // 'logbuch' = verknüpft mit einem Logbuch-Platz
    logbookId: null,
    typeLocked: false, // Meer/See lokal abweichend vom Logbuch festgelegt
  };
}

export function exportJson(spots, settings) {
  return JSON.stringify({ app: 'tauch-bedingungs-vorschau', version: 1, exported: new Date().toISOString(), spots, settings }, null, 2);
}

// Prüft eine Importdatei und liefert normalisierte Spots (+ optional Einstellungen)
export function parseImport(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data.spots;
  if (!Array.isArray(list)) throw new Error('Keine Spot-Liste gefunden.');
  const spots = list.map((s) => {
    const lat = Number(s.lat), lon = Number(s.lon);
    if (!s.name || !Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error(`Ungültiger Spot: ${s.name ?? '(ohne Name)'}`);
    return { ...blankSpot(lat, lon), ...s, lat, lon, type: s.type === 'see' ? 'see' : 'meer', id: s.id || newSpotId() };
  });
  return { spots, settings: data.settings ?? null };
}
