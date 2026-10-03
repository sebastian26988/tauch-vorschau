// Einheiten, Richtungen und Zahlenformat

// Untergrenzen der Beaufort-Stufen 1..12 in Knoten
const BFT_LIMITS_KN = [1, 4, 7, 11, 17, 22, 28, 34, 41, 48, 56, 64];

export function knToBft(kn) {
  if (kn == null || Number.isNaN(kn)) return null;
  let bft = 0;
  while (bft < 12 && kn >= BFT_LIMITS_KN[bft]) bft++;
  return bft;
}

export const kmhToKn = (kmh) => (kmh == null ? null : kmh / 1.852);

export const COMPASS = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function compass(deg) {
  if (deg == null) return '–';
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

export const compassToDeg = (name) => COMPASS.indexOf(name) * 22.5;

// Liegt eine Richtung im Sektor von `from` im Uhrzeigersinn bis `to`?
export function inSector(deg, from, to) {
  if (deg == null || from == null || to == null) return false;
  const norm = (d) => ((d % 360) + 360) % 360;
  const d = norm(deg), f = norm(from), t = norm(to);
  return f <= t ? d >= f && d <= t : d >= f || d <= t;
}

const nf = new Map();
export function fmt(value, digits = 0) {
  if (value == null || Number.isNaN(value)) return '–';
  if (!nf.has(digits)) {
    nf.set(digits, new Intl.NumberFormat('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  }
  return nf.get(digits).format(value);
}

// Haversine-Distanz in km
export function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

// WMO-Wettercodes → Kurztext + Symbol
export function weatherInfo(code) {
  if (code == null) return { text: '–', icon: '' };
  if (code === 0) return { text: 'klar', icon: '☀️' };
  if (code === 1) return { text: 'überwiegend klar', icon: '🌤️' };
  if (code === 2) return { text: 'teils bewölkt', icon: '⛅' };
  if (code === 3) return { text: 'bedeckt', icon: '☁️' };
  if (code === 45 || code === 48) return { text: 'Nebel', icon: '🌫️' };
  if (code >= 51 && code <= 57) return { text: 'Niesel', icon: '🌦️' };
  if (code >= 61 && code <= 67) return { text: 'Regen', icon: '🌧️' };
  if (code >= 71 && code <= 77) return { text: 'Schnee', icon: '🌨️' };
  if (code >= 80 && code <= 82) return { text: 'Schauer', icon: '🌦️' };
  if (code === 85 || code === 86) return { text: 'Schneeschauer', icon: '🌨️' };
  if (code >= 95) return { text: 'Gewitter', icon: '⛈️' };
  return { text: '–', icon: '' };
}
