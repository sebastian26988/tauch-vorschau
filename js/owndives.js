// Eigene Tauchgänge an einem Platz auswerten: Was hatte das Wasser um diese Jahreszeit?
// Reine Funktionen ohne DOM und ohne Netz (siehe tests/owndives.test.mjs).
//
// Der Tauchcomputer misst die Temperatur am Gerät. Der höchste Wert eines Tauchgangs liegt meist
// nahe der Oberfläche, der niedrigste in der größten Tiefe – zusammen zeigen sie die Sprungschicht,
// die für Seen sonst keine Quelle liefert.

const DAY_MS = 24 * 60 * 60 * 1000;

// Tag im Jahr (0–365), unabhängig vom Jahr
function dayOfYear(date) {
  const d = new Date(date);
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY_MS);
}

// Abstand zweier Jahrestage über den Jahreswechsel hinweg (Dezember liegt neben Januar)
function seasonGap(a, b) {
  const d = Math.abs(a - b);
  return Math.min(d, 365 - d);
}

const mean = (vals) => (vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null);
const finite = (v) => v != null && Number.isFinite(Number(v));

/**
 * dives: [{ started_at, max_depth_m, water_temp_min_c, water_temp_max_c }]
 * Liefert null ohne verwertbare Tauchgänge, sonst:
 * { count, last: { date, top, bottom, depth }, season: { count, top, bottom, depth, years } | null }
 * `season` fasst Tauchgänge aus allen Jahren zusammen, die höchstens `windowDays` vom Stichtag entfernt liegen.
 */
export function summarizeDives(dives, refDate = new Date(), windowDays = 30) {
  const usable = (dives ?? [])
    .filter((d) => d?.started_at && (finite(d.water_temp_min_c) || finite(d.water_temp_max_c)))
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
  if (!usable.length) return null;

  const pick = (d) => ({
    date: d.started_at.slice(0, 10),
    top: finite(d.water_temp_max_c) ? Number(d.water_temp_max_c) : null,
    bottom: finite(d.water_temp_min_c) ? Number(d.water_temp_min_c) : null,
    depth: finite(d.max_depth_m) ? Number(d.max_depth_m) : null,
  });

  const ref = dayOfYear(refDate);
  const near = usable.filter((d) => seasonGap(dayOfYear(d.started_at), ref) <= windowDays).map(pick);
  const season = near.length
    ? {
      count: near.length,
      top: mean(near.map((d) => d.top).filter(finite)),
      bottom: mean(near.map((d) => d.bottom).filter(finite)),
      depth: mean(near.map((d) => d.depth).filter(finite)),
      years: [...new Set(near.map((d) => d.date.slice(0, 4)))].sort(),
    }
    : null;

  return { count: usable.length, last: pick(usable[0]), season };
}
