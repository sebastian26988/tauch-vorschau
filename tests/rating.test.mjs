// Tests der Ampel-Logik und Hilfsfunktionen. Laufen mit Node ohne Abhängigkeiten: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rateHour, rateDay, resolveThresholds, mergeReasons, inWindow, DEFAULT_THRESHOLDS, GREEN, YELLOW, RED,
} from '../js/rating.js';
import { inSector, knToBft, compass } from '../js/units.js';
import { pruneCache, CACHE_KEEP_MS } from '../js/api.js';

const meer = { type: 'meer', exposure: null, window: { start: 8, end: 18 } };
const see = { type: 'see', exposure: null, window: { start: 8, end: 18 } };
const thMeer = resolveThresholds('meer');
const thSee = resolveThresholds('see');
const ruhig = { wind: 5, gust: 8, windDir: 180, code: 1, wave: 0.2, waveDir: 180, swell: 0.1, swellPeriod: 4, current: 0.2 };

test('ruhige Stunde ist grün', () => {
  assert.deepEqual(rateHour(ruhig, meer, thMeer), { level: GREEN, reasons: [] });
});

test('Wind über den Grenzen: gelb, dann rot', () => {
  assert.equal(rateHour({ ...ruhig, wind: 12 }, meer, thMeer).level, YELLOW);
  assert.equal(rateHour({ ...ruhig, wind: 20 }, meer, thMeer).level, RED);
});

test('auflandiger Wind wird strenger bewertet', () => {
  const offen = { ...meer, exposure: { from: 315, to: 45 } };
  // 8 kn liegt unter 10 (grün), aber über 10 × 0,7 = 7 → auflandig gelb
  assert.equal(rateHour({ ...ruhig, wind: 8, windDir: 0 }, offen, thMeer).level, YELLOW);
  assert.equal(rateHour({ ...ruhig, wind: 8, windDir: 180 }, offen, thMeer).level, GREEN);
});

test('Strömung zählt am Meer, am See nicht', () => {
  const r = rateHour({ ...ruhig, current: 1.0 }, meer, thMeer);
  assert.equal(r.level, YELLOW);
  assert.equal(r.reasons[0].key, 'current');
  assert.equal(rateHour({ ...ruhig, current: 2.0 }, meer, thMeer).level, RED);
  assert.equal(rateHour({ ...ruhig, current: 2.0 }, see, thSee).level, GREEN);
});

test('alte gespeicherte Grenzwerte ohne Strömung bekommen den Standard', () => {
  const alt = { meer: { wind: [10, 16], gust: [15, 22], wave: [0.5, 1.0], swellHeight: 1, swellPeriod: 8, onshoreFactor: 0.7 } };
  assert.deepEqual(resolveThresholds('meer', alt).current, DEFAULT_THRESHOLDS.meer.current);
});

test('Böen allein ergeben höchstens gelb', () => {
  const r = rateHour({ ...ruhig, gust: 40 }, meer, thMeer);
  assert.equal(r.level, YELLOW);
  assert.equal(r.reasons[0].key, 'gust');
  assert.equal(rateHour({ ...ruhig, gust: 40, wind: 20 }, meer, thMeer).level, RED);
});

test('lange Dünung macht mindestens gelb', () => {
  assert.equal(rateHour({ ...ruhig, swell: 1.2, swellPeriod: 10 }, meer, thMeer).level, YELLOW);
});

test('Gewitter ist rot', () => {
  assert.equal(rateHour({ ...ruhig, code: 95 }, see, thSee).level, RED);
});

test('fehlende Werte gelten als unauffällig', () => {
  assert.equal(rateHour({ wind: null, gust: null, code: null }, meer, thMeer).level, GREEN);
});

test('Tag: schlechteste Stunde im Tauchfenster zählt, außerhalb nicht', () => {
  const hours = [
    { ...ruhig, time: '2026-10-03T06:00', wind: 30 },
    { ...ruhig, time: '2026-10-03T10:00', wind: 12 },
    { ...ruhig, time: '2026-10-03T14:00' },
  ];
  const r = rateDay(hours, meer, thMeer);
  assert.equal(r.level, YELLOW);
  assert.equal(r.hoursRated, 2);
});

test('Tag: vergangene Stunden fallen heute weg', () => {
  const hours = [
    { ...ruhig, time: '2026-10-03T09:00', wind: 30 },
    { ...ruhig, time: '2026-10-03T15:00' },
  ];
  assert.equal(rateDay(hours, meer, thMeer, '2026-10-03T12:30').level, GREEN);
});

test('mergeReasons behält je Kriterium den schlimmsten Wert', () => {
  const m = mergeReasons([[{ key: 'wind', level: YELLOW, value: 11 }], [{ key: 'wind', level: YELLOW, value: 14 }, { key: 'storm', level: RED, value: 95 }]]);
  assert.deepEqual(m.map((r) => [r.key, r.value]), [['storm', 95], ['wind', 14]]);
});

test('Tauchfenster schließt die Grenzen ein', () => {
  assert.ok(inWindow('2026-10-03T08:00', meer));
  assert.ok(inWindow('2026-10-03T18:00', meer));
  assert.ok(!inWindow('2026-10-03T19:00', meer));
});

test('Sektor über Norden hinweg', () => {
  assert.ok(inSector(350, 315, 45));
  assert.ok(inSector(10, 315, 45));
  assert.ok(!inSector(180, 315, 45));
});

test('Einheiten', () => {
  assert.equal(knToBft(0.5), 0);
  assert.equal(knToBft(12), 4);
  assert.equal(compass(359), 'N');
  assert.equal(compass(225), 'SW');
});

test('pruneCache entfernt alte und kaputte Einträge, lässt den Rest', () => {
  const now = Date.parse('2026-10-03T12:00:00Z');
  const data = new Map([
    ['tbv.cache.fc.neu', JSON.stringify({ ts: now - 1000, data: 1 })],
    ['tbv.cache.fc.alt', JSON.stringify({ ts: now - CACHE_KEEP_MS - 1, data: 1 })],
    ['tbv.cache.kaputt', '{'],
    ['tbv.spots', '[]'],
  ]);
  const storage = {
    get length() { return data.size; },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    removeItem: (k) => data.delete(k),
  };
  assert.equal(pruneCache(now, storage), 2);
  assert.deepEqual([...data.keys()].sort(), ['tbv.cache.fc.neu', 'tbv.spots']);
});
