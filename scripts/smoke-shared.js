#!/usr/bin/env node

import assert from 'assert';
import fs from 'fs';
import { fallbackTerminal, distanceMeters } from '../shared/port-resolution.js';
import { selectCurationCandidates } from '../shared/poi-selection.js';
import { buildCityData } from '../shared/poi-curation.js';
import { renderPortPage } from '../server/src/lib/port-page.js';
import os from 'os';
import path from 'path';
import { isParkedDomain, liveWebsiteIds, websiteText } from '../shared/website-descriptions.js';
import { googleSearchCount, isWrongMatch, resolveCatalogGooglePlaces } from '../shared/google-places.js';
import { isStale } from '../server/src/lib/generation.js';

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

test('stops keep OpenStreetMap positions and categories, and only the Google place ID', () => {
  const pois = [
    { sourceId: 'osm/cat1', name: 'Corner Bakery', category: 'shopping', subcategory: 'bakery', lat: 44.64, lng: -63.57 },
    { sourceId: 'osm/cat2', name: 'Del Sol', category: 'shopping', subcategory: 'clothes', lat: 44.65, lng: -63.58 },
  ];
  const curation = { places: [{ sourceId: 'osm/cat1' }, { sourceId: 'osm/cat2' }] };
  const matches = { pois: { 'osm/cat2': {
    googlePlaceId: 'g-2', googlePrimaryType: 'cafe', googleLocation: { lat: 44.66, lng: -63.59 },
    googleBusinessStatus: 'OPERATIONAL', googleFormattedAddress: '1 Road',
  } } };
  const data = buildCityData(portInfo, { ...guideCatalog, pois }, curation, matches);
  assert.deepStrictEqual(data.places.map(p => p.category), ['food_drink', 'shopping']);
  const delSol = data.places[1];
  assert.deepStrictEqual([delSol.lat, delSol.lng, delSol.googlePlaceId], [44.65, -63.58, 'g-2']);
  assert.ok(!('googleBusinessStatus' in delSol) && !('sourceLat' in delSol));
});

test('website text keeps the page summary and drops scripts, and parked domains are spotted', () => {
  const html = '<html><head><title>Cabin Coffee</title><meta name="description" content="Coffee, fresh pastries &amp; a big fireplace"><script>track()</script></head><body><nav>Menu</nav><p>Open daily on Hollis Street.</p></body></html>';
  const text = websiteText(html);
  assert.ok(text.includes('fresh pastries & a big fireplace') && text.includes('Hollis Street'));
  assert.ok(!text.includes('track()') && !text.includes('Menu'));
  assert.ok(isParkedDomain('This domain may be for sale. Terms of Service'));
  assert.ok(!isParkedDomain(text));
});

test('a stop is not matched to a landmark, a different kind of business, or a place far away', () => {
  const cafe = { category: 'food_drink', lat: 25.0775, lng: -77.3420 };
  const arch = { googleLocation: { lat: 25.0756, lng: -77.3436 }, googlePrimaryType: 'historical_landmark', googleTypes: ['tourist_attraction'] };
  const sameCafe = { googleLocation: { lat: 25.0776, lng: -77.3421 }, googlePrimaryType: 'cafe', googleTypes: ['cafe', 'food'] };
  const otherRestaurant = { googleLocation: { lat: 25.0880, lng: -77.3420 }, googlePrimaryType: 'restaurant', googleTypes: ['restaurant'] };
  const boutique = { category: 'shopping', subcategory: 'clothes', lat: 25.0775, lng: -77.3420 };
  const bakery = { category: 'shopping', subcategory: 'bakery', lat: 25.0775, lng: -77.3420 };
  const sandbar = { category: 'attraction', lat: 19.3565, lng: -81.3778 };
  const landSpot = { googleLocation: { lat: 19.3294, lng: -81.3810 }, googlePrimaryType: 'tourist_attraction' };
  assert.strictEqual(isWrongMatch(cafe, arch), true);
  assert.strictEqual(isWrongMatch(cafe, otherRestaurant), true);
  assert.strictEqual(isWrongMatch(cafe, sameCafe), false);
  assert.strictEqual(isWrongMatch(boutique, sameCafe), true);
  assert.strictEqual(isWrongMatch(bakery, { ...sameCafe, googlePrimaryType: 'bakery' }), false);
  assert.strictEqual(isWrongMatch({ category: 'attraction', lat: 25.0775, lng: -77.3420 }, sameCafe), true);
  assert.strictEqual(isWrongMatch(sandbar, landSpot), true);
  assert.strictEqual(isWrongMatch({ category: 'attraction', lat: 25.0757, lng: -77.3437 }, arch), false);
});

test('bare website domains get https', () => {
  const pois = [{ sourceId: 'osm/web1', name: 'Seven Arches Museum', category: 'attraction', lat: 44.64, lng: -63.57, website: 'www.sevenarchesmuseum.com' }];
  const data = buildCityData(portInfo, { ...guideCatalog, pois }, { places: [{ sourceId: 'osm/web1' }] }, {});
  assert.strictEqual(data.places[0].website, 'https://www.sevenarchesmuseum.com');
});

test('guides go stale after the maximum age', () => {
  const daysAgo = days => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  assert.strictEqual(isStale({ generatedAt: daysAgo(10) }), false);
  assert.strictEqual(isStale({ generatedAt: daysAgo(200) }), true);
  assert.strictEqual(isStale({}), true);
});

test('port page structured data cannot close its script tag', () => {
  const port = { id: 'x', city: 'Odd</script> Port', country: 'Canada', terminal: 'T', lat: 44.6, lng: -63.5 };
  const guide = { terminals: [{ name: 'T', lat: 44.6, lng: -63.5 }], places: [{ id: 'a', name: 'A', lat: 44.6, lng: -63.5 }], hiddenGems: [] };
  const html = renderPortPage({ port, guide });
  const data = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  assert.ok(!data.includes('</script'));
  assert.strictEqual(JSON.parse(data).name, 'Odd</script> Port');
});

test('port pages are indexed only when the port has a guide', () => {
  const port = { id: 'halifax-canada', city: 'Halifax', country: 'Canada', terminal: 'Seaport Cruise Pavilion', lat: 44.638, lng: -63.565 };
  const guide = { terminals: [{ name: 'Seaport Cruise Pavilion', lat: 44.638, lng: -63.565 }], places: [{ id: 'a', name: 'Pier 21 <Museum>', lat: 44.637, lng: -63.566 }], hiddenGems: [] };
  const withGuide = renderPortPage({ port, guide });
  const withoutGuide = renderPortPage({ port, guide: null });
  assert.ok(withGuide.includes('rel="canonical"') && !withGuide.includes('noindex'));
  assert.ok(withGuide.includes('Pier 21 &lt;Museum&gt;'));
  assert.ok(withoutGuide.includes('noindex') && !withoutGuide.includes('rel="canonical"'));
});

test('a place Google had no match for is not searched again within a year', async () => {
  const cachePath = path.join(os.tmpdir(), `portlore-cache-${process.pid}.json`);
  fs.writeFileSync(cachePath, JSON.stringify({ 'poi:osm/1': { googlePlaceId: '', resolvedAt: new Date().toISOString() } }));
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Google was searched'); };
  try {
    const before = googleSearchCount();
    const result = await resolveCatalogGooglePlaces({ city: 'Halifax', country: 'Canada', lat: 1, lng: 2 },
      { pois: [{ sourceId: 'osm/1', name: 'Cafe', lat: 1, lng: 2 }] },
      { apiKey: 'key', cachePath, onlyIds: ['osm/1'], requireFields: true });
    assert.deepStrictEqual(result.pois, {});
    assert.strictEqual(googleSearchCount(), before);
  } finally {
    globalThis.fetch = realFetch;
    fs.rmSync(cachePath, { force: true });
  }
});

test('a website the model found only counts as live when it names the business', async () => {
  const page = 'Welcome to Harbour Bistro on the waterfront. Fresh seafood, local beer and views of the ships every day.';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(`<html><body>${page}</body></html>`, { headers: { 'content-type': 'text/html' } });
  try {
    const live = await liveWebsiteIds([
      { id: 'a', name: 'Harbour Bistro', website: 'https://a.example', found: true },
      { id: 'b', name: 'Lighthouse Diner', website: 'https://b.example', found: true },
      { id: 'c', name: 'Lighthouse Diner', website: 'https://c.example' },
    ], new Map());
    assert.deepStrictEqual([...live].sort(), ['a', 'c']);
  } finally {
    globalThis.fetch = realFetch;
  }
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
