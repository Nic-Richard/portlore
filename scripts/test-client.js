import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { MAP_TIERS, findMapTile } from '../client/src/basemap.js';
import { mapRegion } from './build-map-tiles.js';
import { findPorts } from '../client/src/search.js';
import { createGuideStore } from '../client/src/storage.js';
import { createGuideApi } from '../client/src/guide-api.js';
import { createState } from '../client/src/state.js';
import { enrich, inferStopCategory, defaultVisitMinutes } from '../client/src/places.js';
import { todaysHours, closingMinutes, escapeText } from '../client/src/hours.js';
import { placeLineIcon } from '../client/src/icons.js';

globalThis.window = {};
const { createPlanner } = await import('../client/src/planner.js');
const { createMaps } = await import('../client/src/maps.js');
const mapRenderer = runInNewContext(readFileSync(new URL('../client/src/protomaps-leaflet-5.1.0.js', import.meta.url), 'utf8') + '\n; protomapsL');

test('native maps bypass the HTTP proxy without changing other requests', () => {
  const source = readFileSync(new URL('../client/src/platform.js', import.meta.url), 'utf8').replace(/^export /gm, '');
  const calls = [];
  const raw = (resource, options) => { calls.push(['raw', resource, options]); };
  const proxy = (resource, options) => { calls.push(['proxy', resource, options]); };
  const window = { Capacitor: { isNativePlatform: () => true }, CapacitorWebFetch: raw, fetch: proxy };
  runInNewContext(source, { window });
  const options = { headers: { Range: 'bytes=58153-66728' }, signal: new AbortController().signal };
  for (const resource of ['https://portlore.com/maps/detail.pmtiles', new URL('https://portlore.com/maps/world.pmtiles'), new Request('https://portlore.com/maps/town.pmtiles')]) {
    window.fetch(resource, options);
    assert.deepEqual(calls.at(-1), ['raw', resource, options]);
  }
  for (const resource of ['https://portlore.com/api/photo?q=Halifax', 'https://portlore.com/api/city/halifax-canada', 'https://portlore.com/ports.json', 'https://example.com/maps/world.pmtiles']) {
    window.fetch(resource, options);
    assert.deepEqual(calls.at(-1), ['proxy', resource, options]);
  }
  const browser = { CapacitorWebFetch: raw, fetch: proxy };
  runInNewContext(source, { window: browser });
  assert.equal(browser.fetch, proxy);
});

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function element() {
  return {
    value: '', textContent: '', innerHTML: '', style: {}, dataset: {}, children: [],
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener() {}, insertAdjacentHTML() {},
    appendChild(child) { this.children.push(child); },
    querySelector: () => element(),
  };
}
function fakeDocument() {
  const elements = new Map();
  globalThis.document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    querySelectorAll: () => [],
    createElement: () => element(),
    addEventListener() {},
  };
  return document;
}
const quiet = () => {};
const plannerActions = { openDetail: quiet, highlightPins: quiet, drawPlanLine: quiet, showToast: quiet };
const mapActions = {
  syncSystemBars: quiet, selectPort: quiet, switchPortFromMap: quiet,
  terminalKey: terminal => `${terminal.lat},${terminal.lng}`,
  setActiveTerminal: quiet, enrich: places => places,
  googleMapsSearchUrl: quiet, googleMapsDirectionsUrl: quiet,
  openDetail: quiet, getItinPlaces: () => [], isInItin: () => false,
  addToItin: quiet, removeFromItin: quiet,
};

test('map fallback uses the nearest available parent and preserves its transform', async () => {
  assert.deepEqual(MAP_TIERS.flatMap(tier => Array.from({ length: tier.maxZoom - tier.minZoom + 1 }, (_, i) => tier.minZoom + i)), Array.from({ length: 16 }, (_, i) => i));
  const calls = [];
  const cache = { tileSize: 512, get: async tile => {
    calls.push(tile);
    return tile.z <= 13 ? new Map([['roads', []]]) : new Map();
  } };
  const views = Array.from({ length: 16 }, (_, z) => new mapRenderer.View(cache, z, 1));
  const coordinates = { z: 19, x: 169563, y: 189357 };
  const tile = await findMapTile(views, coordinates);
  assert.deepEqual(calls.map(tile => tile.z), [15, 14, 13]);
  assert.equal(tile.dataTile.x, Math.floor(coordinates.x / 64));
  assert.equal(tile.dataTile.y, Math.floor(coordinates.y / 64));
  assert.equal(tile.scale, 32);
  assert.equal(tile.dim, 16384);
  assert.equal(tile.origin.x, Math.floor(coordinates.x / 64) * 16384);
  assert.equal(tile.origin.y, Math.floor(coordinates.y / 64) * 16384);
  calls.length = 0;
  assert.equal((await findMapTile(views, { z: 2, x: 2, y: 1 })).dataTile.z, 1);
  assert.deepEqual(calls.map(tile => tile.z), [1]);
  assert.equal((await findMapTile(views, { z: 0, x: 0, y: 0 })).dataTile.z, 0);
});

test('map fallback does not hide network failures or missing world coverage', async () => {
  const empty = { getDisplayTile: async () => ({ data: new Map() }) };
  await assert.rejects(findMapTile(Array(16).fill(empty), { z: 19 }), /No background map tile/);
  let parentCalls = 0;
  const views = Array(16).fill({ getDisplayTile: async () => { parentCalls++; } });
  views[15] = { getDisplayTile: async () => { throw Error('Network failure'); } };
  await assert.rejects(findMapTile(views, { z: 19 }), /Network failure/);
  assert.equal(parentCalls, 0);
});

test('map coverage includes gateway anchors and splits dateline rectangles', () => {
  const region = mapRegion([{ lat: 0, lng: 179.9 }, { lat: 78, lng: -179.9 }, { lat: 41.9, lng: 12.5 }], 30);
  assert.equal(region.coordinates.length, 5);
  for (const [ring] of region.coordinates) {
    assert.deepEqual(ring[0], ring.at(-1));
    assert.ok(ring.every(([lng, lat]) => Math.abs(lng) <= 180 && Math.abs(lat) < 85.052));
  }
  assert.ok(region.coordinates[0][0][0][1] < -30 / 111);
  assert.ok(region.coordinates.at(-1)[0].some(([lng]) => lng > 12.5));
  assert.throws(() => mapRegion([{ lat: 0, lng: NaN }], 30), /Invalid map anchor/);
});

test('port search ignores accents, combining marks and punctuation across all fields', () => {
  const ports = [
    { city: 'Mazatlán', country: 'Mexico', terminal: 'Cruise pier' },
    { city: 'Pointe-à-Pitre', country: 'Guadeloupe', terminal: 'Be\u0301lem terminal' },
  ];
  assert.equal(findPorts(ports, 'mazatlan')[0], ports[0]);
  assert.equal(findPorts(ports, 'pointe a pitre')[0], ports[1]);
  assert.equal(findPorts(ports, 'belem')[0], ports[1]);
  assert.equal(findPorts(ports, 'MEXICO')[0], ports[0]);
  assert.deepEqual(findPorts(ports, 'missing'), []);
  assert.equal(findPorts(Array(12).fill(ports[0]), 'mazatlan').length, 8);
});
test('saved guides retain the ten most recently opened ports', () => {
  const storage = memoryStorage();
  const store = createGuideStore(storage);
  for (let i = 0; i < 12; i++) store.saveGuide(String(i), { id: i });
  assert.equal(store.readSaved('portlore-saved-guides').length, 10);
  assert.equal(store.readSaved('portlore-guide:0'), null);
  store.saveGuide('5', { id: 5, updated: true });
  assert.equal(store.readSaved('portlore-saved-guides')[0], '5');
  assert.equal(store.readSaved('portlore-saved-guides').length, 10);
  assert.equal(store.readSaved('portlore-guide:5').updated, true);
});
test('corrupt or unavailable storage does not break guide reading or saving', () => {
  const storage = memoryStorage();
  storage.setItem('bad', '{');
  assert.equal(createGuideStore(storage).readSaved('bad'), null);
  const store = createGuideStore({ getItem() { throw Error('blocked'); }, setItem() { throw Error('full'); } });
  assert.equal(store.readSaved('key'), null);
  assert.doesNotThrow(() => store.saveGuide('port', {}));
});
test('guide requests use the native origin and save successful responses', async () => {
  const store = createGuideStore(memoryStorage());
  const calls = [];
  const api = createGuideApi({ origin: 'https://portlore.com', store, request: async url => {
    calls.push(url);
    return { ok: true, json: async () => ({ id: 'halifax' }) };
  } });
  assert.deepEqual(await api.loadGuide('halifax'), { guide: { id: 'halifax' }, offline: false });
  assert.deepEqual(calls, ['https://portlore.com/api/city/halifax']);
  assert.deepEqual(store.readSaved('portlore-guide:halifax'), { id: 'halifax' });
});
test('network failure uses a saved guide before trying the static fallback', async () => {
  const store = createGuideStore(memoryStorage());
  store.saveGuide('port', { id: 'port' });
  let calls = 0;
  const api = createGuideApi({ store, request: async () => { calls++; throw Error('offline'); } });
  assert.equal((await api.loadGuide('port')).offline, true);
  assert.equal(calls, 1);
});
test('missing guide does not use an old static file', async () => {
  const calls = [];
  const api = createGuideApi({ store: createGuideStore(memoryStorage()), request: async url => {
    calls.push(url); return { ok: false, status: 404 };
  } });
  assert.equal(await api.loadGuide('port'), null);
  assert.deepEqual(calls, ['/api/city/port']);
});
test('server failure falls back to a static guide', async () => {
  const calls = [];
  const api = createGuideApi({ store: createGuideStore(memoryStorage()), request: async url => {
    calls.push(url);
    return url.startsWith('/api/') ? { ok: false, status: 503 } : { ok: true, json: async () => ({ id: 'port' }) };
  } });
  assert.equal((await api.loadGuide('port')).guide.id, 'port');
  assert.deepEqual(calls, ['/api/city/port', '/cities/port.json']);
});
test('complete guide failure returns no guide', async () => {
  const api = createGuideApi({ store: createGuideStore(memoryStorage()), request: async () => { throw Error('offline'); } });
  assert.equal(await api.loadGuide('port'), null);
});
test('gateway walking distances start in town without changing stop data', () => {
  const place = { id: 'stop', lat: 41.9, lng: 12.5, suggestedVisitMinutes: 90 };
  const city = { port: { id: 'pier', lat: 42.1, lng: 11.8 }, centre: { lat: 41.9, lng: 12.5 } };
  const [result] = enrich([place], city);
  assert.equal(result.distanceFromTerminalMeters, 0);
  assert.equal(result.nearestTerminalId, 'pier');
  assert.equal(result.tnLabel, '1h 30m');
  assert.equal(result.access, 'walkable');
  assert.equal(place._m, undefined);
});
test('stop categories, visit lengths and line icons survive extraction', () => {
  assert.equal(inferStopCategory({ name: 'Café by the pier' }), 'food_drink');
  assert.equal(inferStopCategory({ name: 'City Museum' }), 'attraction');
  assert.equal(defaultVisitMinutes({ name: 'City Museum', suggestedVisitMinutes: 75 }), 75);
  assert.match(placeLineIcon({ name: 'Coffee shop', category: 'food_drink' }), /<svg/);
});
test('hours handle day ranges, exceptions, split shifts and unsupported syntax', () => {
  const monday = new Date(2026, 9, 5, 12);
  const sunday = new Date(2026, 9, 4, 12);
  assert.equal(todaysHours('Mo-Fr 09:00-17:00; Sa 10:00-14:00; Su off', monday), '9:00 AM – 5:00 PM');
  assert.equal(todaysHours('Mo-Fr 09:00-17:00; Su off', sunday), 'Closed');
  assert.equal(todaysHours('Fr-Mo 10:00-14:00', monday), '10:00 AM – 2:00 PM');
  assert.equal(todaysHours('Mo 09:00-12:00,13:00-18:00', monday), '9:00 AM – 12:00 PM, 1:00 PM – 6:00 PM');
  assert.equal(todaysHours('Mo-Fr 09:00-17:00; Mo off', monday), 'Closed');
  assert.equal(todaysHours('24/7', monday), 'Open 24 hours');
  assert.equal(todaysHours('PH off', monday), '');
  assert.equal(todaysHours('Monday: 8:00 AM – 4:00 PM · Tuesday: Closed', monday), '8:00 AM – 4:00 PM');
  assert.equal(closingMinutes('9:00 AM – 12:00 PM, 1:00 PM – 6:00 PM'), 1080);
  assert.equal(closingMinutes('Open 24 hours'), null);
  assert.equal(escapeText('<b>"&'), '&lt;b&gt;&quot;&amp;');
});
test('planner keeps stop order, hidden gems and nearby places', () => {
  fakeDocument();
  const state = createState();
  state.city = { places: [{ id: 'a' }], hiddenGems: [{ id: 'b' }] };
  state.searchedPlaces = [{ id: 'c' }];
  state.itineraryIds = ['c', 'missing', 'b', 'a'];
  const planner = createPlanner(state, plannerActions);
  assert.deepEqual(planner.getItinPlaces().map(p => p.id), ['c', 'b', 'a']);
  planner.syncItinIds();
  assert.deepEqual(state.itinIds, state.itineraryIds);
});
test('a late walking route cannot enter a new day plan', async () => {
  fakeDocument();
  const state = createState();
  state.city = { port: { lat: 44.6, lng: -63.5 }, places: [{ id: 'a', lat: 44.61, lng: -63.51 }] };
  state.itineraryIds = ['a'];
  const request = deferred();
  globalThis.fetch = () => request.promise;
  let draws = 0;
  const planner = createPlanner(state, { ...plannerActions, drawPlanLine: () => draws++ });
  const pending = planner.calculateItineraryRoute();
  state.itineraryRouteToken++;
  state.city = null;
  state.itineraryIds = [];
  request.resolve({ ok: true, json: async () => ({ durationSeconds: 500 }) });
  await pending;
  assert.equal(state.itineraryRoute, null);
  assert.equal(draws, 0);
});
test('the latest walking route wins when replies arrive out of order', async () => {
  fakeDocument();
  const state = createState();
  state.city = { port: { lat: 44.6, lng: -63.5 }, places: [{ id: 'a', name: 'Stop', lat: 44.61, lng: -63.51 }] };
  state.itineraryIds = ['a'];
  const first = deferred(), second = deferred();
  let calls = 0;
  globalThis.fetch = () => (++calls === 1 ? first.promise : second.promise);
  const planner = createPlanner(state, plannerActions);
  const old = planner.calculateItineraryRoute(), latest = planner.calculateItineraryRoute();
  second.resolve({ ok: true, json: async () => ({ durationSeconds: 120, legs: [] }) });
  await latest;
  first.resolve({ ok: true, json: async () => ({ durationSeconds: 999, legs: [] }) });
  await old;
  assert.equal(state.itineraryRoute.durationSeconds, 120);
});
for (const change of ['port', 'terminal', 'reset', 'newer search']) {
  test(`nearby search ignores a late response after ${change}`, async () => {
    const doc = fakeDocument();
    const state = createState();
    state.city = { port: { lat: 44.6, lng: -63.5 } };
    const request = deferred();
    let calls = 0;
    globalThis.fetch = () => ++calls === 1 ? request.promise : Promise.resolve({ ok: true, json: async () => ({ results: [] }) });
    const maps = createMaps(state, mapActions);
    doc.getElementById('desktop-nearby-input').value = 'coffee';
    const pending = maps.runNearbySearch('desktop');
    if (change === 'port') state.city = { port: { lat: 50, lng: 5 } };
    if (change === 'terminal') state.city.port = { lat: 44.8, lng: -63.5 };
    if (change === 'reset') maps.resetExploreMaps();
    if (change === 'newer search') await maps.runNearbySearch('desktop');
    const status = doc.getElementById('desktop-nearby-status');
    status.textContent = 'Current port';
    request.resolve({ ok: true, json: async () => ({ results: [{ id: 'old', name: 'Old coffee shop' }] }) });
    await pending;
    assert.deepEqual(state.searchedPlaces, []);
    assert.equal(status.textContent, 'Current port');
  });
}
test('resetting maps clears map state and selected pins', () => {
  fakeDocument();
  const state = createState();
  let removed = 0;
  const map = { _animatingZoom: true, remove: () => removed++ };
  state.dMap = state.mMap = map;
  state.dReady = state.mReady = true;
  state.selectedMapPlaceId = 'stop';
  state.dMarkers = { stop: {} };
  createMaps(state, mapActions).resetExploreMaps();
  assert.equal(removed, 2);
  assert.equal(map._animatingZoom, false);
  assert.equal(state.dMap, null);
  assert.equal(state.mReady, false);
  assert.equal(state.selectedMapPlaceId, null);
  assert.deepEqual(state.dMarkers, {});
});
test('native packaging includes the unchanged shared modules, styles and legal pages', () => {
  const root = new URL('../', import.meta.url);
  execFileSync(process.execPath, [fileURLToPath(new URL('mobile/build-web.mjs', root))]);
  const source = new URL('client/src/', root), output = new URL('mobile/www/', root);
  for (const name of readdirSync(source).filter(name => name !== 'index.html' && name !== 'package.json')) {
    assert.deepEqual(readFileSync(new URL(name, output)), readFileSync(new URL(name, source)), `Native asset differs: ${name}`);
  }
  const html = readFileSync(new URL('index.html', output), 'utf8');
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /type="module" src="\/app.js"/);
  assert.match(html, /href="\/styles.css"/);
});
