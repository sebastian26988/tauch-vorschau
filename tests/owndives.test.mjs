import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDives } from '../js/owndives.js';

const dive = (started_at, max, min, depth = 20) => ({ started_at, water_temp_max_c: max, water_temp_min_c: min, max_depth_m: depth });

test('ohne Tauchgänge oder ohne Temperaturen: null', () => {
  assert.equal(summarizeDives([]), null);
  assert.equal(summarizeDives(null), null);
  assert.equal(summarizeDives([{ started_at: '2025-07-01T10:00:00Z', water_temp_min_c: null, water_temp_max_c: null }]), null);
});

test('letzter Tauchgang ist der jüngste, egal in welcher Reihenfolge', () => {
  const s = summarizeDives([dive('2024-08-01T10:00:00Z', 22, 9), dive('2026-09-06T10:00:00Z', 18, 8, 25)], new Date('2026-10-03'));
  assert.deepEqual(s.last, { date: '2026-09-06', top: 18, bottom: 8, depth: 25 });
  assert.equal(s.count, 2);
});

test('Jahreszeit fasst alle Jahre im Fenster zusammen, der Rest bleibt draußen', () => {
  const s = summarizeDives([
    dive('2023-10-10T10:00:00Z', 16, 7),
    dive('2025-09-20T10:00:00Z', 18, 9),
    dive('2025-07-01T10:00:00Z', 23, 10), // Juli – zu weit weg vom 3. Oktober
  ], new Date('2026-10-03'));
  assert.equal(s.season.count, 2);
  assert.equal(s.season.top, 17);
  assert.equal(s.season.bottom, 8);
  assert.deepEqual(s.season.years, ['2023', '2025']);
});

test('Jahreswechsel: Ende Dezember zählt für Anfang Januar', () => {
  const s = summarizeDives([dive('2025-12-27T10:00:00Z', 6, 5)], new Date('2026-01-10'));
  assert.equal(s.season.count, 1);
});

test('keine Tauchgänge zur Jahreszeit: season ist null, last bleibt', () => {
  const s = summarizeDives([dive('2025-07-01T10:00:00Z', 23, 10)], new Date('2026-01-10'));
  assert.equal(s.season, null);
  assert.equal(s.last.top, 23);
});
