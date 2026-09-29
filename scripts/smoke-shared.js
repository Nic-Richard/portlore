#!/usr/bin/env node

import assert from 'assert';
import fs from 'fs';
import { fallbackTerminal, distanceMeters } from '../shared/port-resolution.js';
import { selectCurationCandidates } from '../shared/poi-selection.js';
import { buildCityData } from '../shared/poi-curation.js';

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test('distanceMeters returns 0 for identical coordinates', () => {
  assert.strictEqual(distanceMeters(43.6532, -79.3832, 43.6532, -79.3832), 0);
});

test('distanceMeters matches earthRadius * (1 degree in radians) along the equator', () => {
  const meters = distanceMeters(0, 0, 0, 1);
  const expected = 6371000 * (Math.PI / 180);
  assert.ok(Math.abs(meters - expected) < 1, `expected ${expected.toFixed(1)}m, got ${meters.toFixed(1)}m`);
});

test('distanceMeters matches earthRadius * (pi/2) from the equator to the pole', () => {
  const meters = distanceMeters(0, 0, 90, 0);
  const expected = 6371000 * (Math.PI / 2);
  assert.ok(Math.abs(meters - expected) < 1, `expected ${expected.toFixed(1)}m, got ${meters.toFixed(1)}m`);
});

test('fallbackTerminal builds an anchor point from valid port coordinates', () => {
  const terminal = fallbackTerminal({ lat: 43.6532, lng: -79.3832, city: 'Toronto', terminal: 'Toronto Cruise Terminal' });

  assert.strictEqual(terminal.lat, 43.6532);
  assert.strictEqual(terminal.lng, -79.3832);
  assert.strictEqual(terminal.name, 'Toronto Cruise Terminal');
  assert.strictEqual(terminal.slug, 'toronto-cruise-terminal');
  assert.strictEqual(terminal.source, 'ports.json');
});

test('fallbackTerminal falls back to "<city> port" when no terminal name is given', () => {
  const terminal = fallbackTerminal({ lat: 41.3, lng: 2.2, city: 'Barcelona' });
  assert.strictEqual(terminal.name, 'Barcelona port');
});

test('fallbackTerminal returns null when coordinates are missing or invalid', () => {
  assert.strictEqual(fallbackTerminal({ city: 'Nowhere' }), null);
  assert.strictEqual(fallbackTerminal({ lat: 'not-a-number', lng: -79.38 }), null);
});

const FAME = JSON.parse(fs.readFileSync(new URL('../data/wikidata-fame.json', import.meta.url), 'utf8')).counts;
const PICKS = JSON.parse(fs.readFileSync(new URL('../data/curated-picks.json', import.meta.url), 'utf8')).ports;
const [famousId] = Object.entries(FAME).sort((a, b) => b[1] - a[1])[0];
const [pickPortId, portPicks] = Object.entries(PICKS).find(([, picks]) => picks.some(pick => pick.gem && Number.isFinite(pick.lat)));
const locatedPick = portPicks.find(pick => pick.gem && Number.isFinite(pick.lat));

function poi(id, fields = {}) {
  return { sourceId: `test/${id}`, name: `Place ${id}`, category: 'attraction', subcategory: 'museum', lat: 44.64, lng: -63.57, minDistanceFromAnyTerminalMeters: 300, address: '1 Main St', ...fields };
}

test('shortlists keep a world-famous landmark ahead of many nearby places', () => {
  const pois = Array.from({ length: 150 }, (_, i) => poi(i, { category: i % 2 ? 'food_drink' : 'attraction', subcategory: i % 2 ? 'restaurant' : 'gallery' }));
  pois.push(poi('landmark', { wikidata: famousId, minDistanceFromAnyTerminalMeters: 5000, address: '' }));
  const selected = selectCurationCandidates({ port: { id: 'test-port' }, pois }, 80);
  assert.ok(selected.some(item => item.sourceId === 'test/landmark'));
  assert.ok(selected.length <= 80);
});

test('chain branches never count as famous', () => {
  const selected = selectCurationCandidates({ port: { id: 'test-port' }, pois: [poi('chain', { wikidata: famousId, brand: 'Chain' })] }, 80);
  assert.strictEqual(selected[0].fame, undefined);
});

test('no single type crowds out a category', () => {
  const pois = [
    ...Array.from({ length: 60 }, (_, i) => poi(`museum${i}`)),
    ...Array.from({ length: 30 }, (_, i) => poi(`gallery${i}`, { subcategory: 'gallery', minDistanceFromAnyTerminalMeters: 2000 })),
  ];
  const selected = selectCurationCandidates({ port: { id: 'test-port' }, pois }, 80);
  assert.ok(selected.filter(item => item.subcategory === 'museum').length <= 10);
});

test('curated gems are matched by name and location and listed first', () => {
  const pois = [
    poi('near-pick', { name: locatedPick.name, lat: locatedPick.lat, lng: locatedPick.lng, category: locatedPick.category, subcategory: locatedPick.subcategory }),
    poi('same-name-far-away', { name: locatedPick.name, lat: locatedPick.lat + 0.05, lng: locatedPick.lng }),
  ];
  const selected = selectCurationCandidates({ port: { id: pickPortId }, pois }, 80);
  const match = selected.find(item => item.sourceId === 'test/near-pick');
  assert.ok(match && match.curated && match.gem);
  assert.strictEqual(selected[0].curated, true);
  assert.ok(!selected.find(item => item.sourceId === 'test/same-name-far-away')?.gem);
});

const guideCatalog = {
  port: { id: 'test-port' },
  terminals: [{ id: 't1', sourceId: 't1', name: 'Test Terminal', lat: 44.638, lng: -63.565, verified: true }],
  defaultTerminalId: 't1',
  pois: [
    ...Array.from({ length: 4 }, (_, i) => poi(`editor${i}`, { gem: true, curated: true })),
    ...Array.from({ length: 8 }, (_, i) => poi(`model${i}`, { name: `Model pick ${i}` })),
  ],
};
const portInfo = { id: 'test-port', city: 'Testville', country: 'Nowhere', lat: 44.638, lng: -63.565 };

test('guides keep at most 7 hidden gems, editor gems first', () => {
  const places = guideCatalog.pois.map(item => ({ sourceId: item.sourceId, ...(item.gem ? {} : { hiddenGem: true }), description: 'x' }));
  const data = buildCityData(portInfo, guideCatalog, { places }, {});
  assert.strictEqual(data.hiddenGems.length, 7);
  assert.strictEqual(data.hiddenGems.filter(item => item.sourceId.startsWith('test/editor')).length, 4);
  assert.strictEqual(data.places.length, 5);
});

test('an editor gem the model turns down becomes a regular stop', () => {
  const data = buildCityData(portInfo, guideCatalog, { places: [{ sourceId: 'test/editor0', hiddenGem: false, description: 'x' }] }, {});
  assert.strictEqual(data.hiddenGems.length, 0);
  assert.strictEqual(data.places[0].sourceId, 'test/editor0');
});

test('an added stop that repeats a supplied one is dropped', () => {
  const curation = {
    places: [{ sourceId: 'test/model0', description: 'x' }],
    supplementedPois: [{ sourceId: 'supplement/model-pick-0', name: 'Model pick 0 Museum', lat: 44.64, lng: -63.57, category: 'attraction', description: 'x' }],
  };
  const data = buildCityData(portInfo, guideCatalog, curation, {});
  assert.strictEqual(data.places.length, 1);
});

(async () => {
  let passed = 0;

  for (const { name, fn } of tests) {
    try {
      await fn();
      passed += 1;
      console.log(`✓ ${name}`);
    } catch (err) {
      console.error(`✗ ${name}`);
      console.error(err.stack || err);
      process.exit(1);
    }
  }

  console.log(`\n${passed}/${tests.length} shared-logic smoke tests passed.`);
})().catch(err => {
  console.error(err.stack || err);
  process.exit(1);
});
