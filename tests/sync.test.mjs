import { test } from 'node:test';
import assert from 'node:assert/strict';

// sync.js zieht logbook.js nach (Browser-Import des SDK erst bei Bedarf) – für die reinen
// Funktionen reicht ein leerer localStorage-Ersatz
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
const { decide, mergeSpots } = await import('../js/sync.js');

const a = { id: 'a', name: 'A' };
const b = { id: 'b', name: 'B' };
const local = (spots, thresholds = {}) => ({ spots, settings: { thresholds } });
const remote = (spots, at) => ({ spots, settings: { thresholds: {} }, updated_at: new Date(at).toISOString() });

test('nichts da, nichts zu tun', () => {
  assert.equal(decide(local([]), null, null, null).action, 'none');
});

test('erstes Gerät: lokale Plätze hochladen', () => {
  assert.equal(decide(local([a]), null, null, null).action, 'push');
});

test('neues, leeres Gerät übernimmt den Stand aus der Cloud', () => {
  const r = decide(local([]), remote([a, b], 1000), null, null);
  assert.equal(r.action, 'pull');
  assert.deepEqual(r.spots, [a, b]);
});

test('nur hier geändert: hochladen', () => {
  assert.equal(decide(local([a, b]), remote([a], 1000), 2000, 1000).action, 'push');
});

test('nur anderswo geändert: übernehmen', () => {
  assert.equal(decide(local([a]), remote([a, b], 3000), 900, 1000).action, 'pull');
});

test('beide geändert: zusammenführen, lokal gewinnt bei gleicher ID', () => {
  const r = decide(local([{ id: 'a', name: 'A neu' }]), remote([a, b], 3000), 2000, 1000);
  assert.equal(r.action, 'merge');
  assert.deepEqual(r.spots.map((s) => s.name), ['A neu', 'B']);
});

test('vorhandene Plätze auf einem Gerät, das noch nie abgeglichen hat, gehen nicht verloren', () => {
  const r = decide(local([a]), remote([b], 1000), null, null);
  assert.equal(r.action, 'merge');
  assert.deepEqual(r.spots.map((s) => s.id), ['a', 'b']);
});

test('derselbe Logbuch-Platz unter anderer ID wird nicht doppelt', () => {
  const m = mergeSpots([{ id: 'x', logbookId: 'L1' }], [{ id: 'y', logbookId: 'L1' }, { id: 'z' }]);
  assert.deepEqual(m.map((s) => s.id), ['x', 'z']);
});

test('alles abgeglichen: nichts zu tun', () => {
  assert.equal(decide(local([a]), remote([a], 1000), 900, 1000).action, 'none');
});
