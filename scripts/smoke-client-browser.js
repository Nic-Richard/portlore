import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, mkdtemp, rm, open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.CHROME_PATH || (process.platform === 'win32'
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'google-chrome');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const html = await readFile(path.join(root, 'client/src/index.html'), 'utf8');
const ports = JSON.parse(await readFile(path.join(root, 'cities/ports.json'), 'utf8'));
const mapFixture = await readFile(path.join(root, 'scripts/fixtures/world.pmtiles'));
const mapRequests = [];
async function mapResponse(url, headers = {}) {
  if (!/^\/maps\/(world|outer|region|town|detail)\.pmtiles$/.test(url.pathname)) return null;
  const file = process.env.MAP_FIXTURE_DIR
    ? await open(path.join(process.env.MAP_FIXTURE_DIR, path.basename(url.pathname))) : null;
  try {
    const size = file ? (await file.stat()).size : mapFixture.length;
    const range = (headers.range || headers.Range)?.match(/^bytes=(\d+)-(\d+)$/);
    assert.ok(range, 'Browser maps must use bounded byte ranges, not download whole archives');
    const start = Number(range[1]), end = Math.min(Number(range[2]), size - 1);
    assert.ok(start <= end && end < size, 'Map Range request must fit the archive');
    const body = file ? Buffer.alloc(end - start + 1) : mapFixture.subarray(start, end + 1);
    if (file) {
      const { bytesRead } = await file.read(body, 0, body.length, start);
      assert.equal(bytesRead, body.length, 'Complete map range must be read');
    }
    mapRequests.push(url.href);
    return { status: 206, body, headers: {
      'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'ETag, Content-Range',
      'Content-Range': `bytes ${start}-${end}/${size}`,
    } };
  } finally { await file?.close(); }
}
const vendors = new Map();
for (const url of new Set(html.match(/https:\/\/cdnjs\.cloudflare\.com\/[^"\s]+/g))) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error(`Could not load browser dependency: ${url}`);
  vendors.set(url, Buffer.from(await response.arrayBuffer()));
}
const fixtures = Object.fromEntries(['halifax-canada', 'saint-john-canada'].map(id => {
  const port = ports.find(item => item.id === id);
  assert.ok(port, `Missing fixture port ${id}`);
  return [id, {
    id, city: port.city, country: port.country, timezone: 'America/Halifax',
    port: { id: 'pier', name: port.terminal, lat: port.lat, lng: port.lng },
    terminals: [
      { id: 'pier', name: port.terminal, lat: port.lat, lng: port.lng },
      { id: 'other', name: 'Second terminal', lat: port.lat + .005, lng: port.lng },
    ],
    weather: { lat: port.lat, lng: port.lng }, deals: [],
    places: [
      { id: `${id}-museum`, name: 'Harbour Museum', category: 'attraction', lat: port.lat + .001, lng: port.lng,
        subtitle: 'A fixture museum', description: 'Museum description', hours: '24/7', suggestedVisitMinutes: 60, googlePlaceId: 'fixture-id' },
      { id: `${id}-cafe`, name: 'Harbour Café', localName: 'مقهى', category: 'food_drink', lat: port.lat + .002, lng: port.lng,
        subtitle: 'A fixture café', description: 'Café description', suggestedVisitMinutes: 45 },
    ],
    hiddenGems: [{ id: `${id}-gem`, name: 'Hidden Garden', category: 'outdoors', lat: port.lat + .003, lng: port.lng, suggestedVisitMinutes: 30 }],
  }];
}));
let routeDelay = 0, guideOffline = false;
let markFixturePaused, cancelledFixtures = 0;
const fixturePaused = new Promise(resolve => { markFixturePaused = resolve; });
const requests = [];
function apiResponse(url, method) {
  const pathname = url.pathname;
  requests.push(`${method} ${pathname}`);
  if (pathname === '/ports.json') return ports.map(port => ({ ...port, generated: !!fixtures[port.id] }));
  if (pathname === '/api/city') return { generatedIds: Object.keys(fixtures) };
  if (pathname.startsWith('/api/city/')) return fixtures[pathname.split('/').pop()] || null;
  if (pathname === '/api/generate/availability') return { available: true };
  if (pathname.startsWith('/api/generate/')) throw Error('Browser check must not generate a guide');
  if (pathname === '/api/photo') return { photos: [] };
  if (pathname === '/api/nearby') return { results: [{ id: 'nearby-coffee', name: 'Nearby Coffee', category: 'food_drink', lat: 44.65, lng: -63.57, address: 'Fixture address' }] };
  if (pathname === '/api/route') return { durationSeconds: 360, legs: [{ durationSeconds: 180 }, { durationSeconds: 180 }], path: [[44.65, -63.57], [44.651, -63.57]] };
  return null;
}
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const map = await mapResponse(url, request.headers);
    if (map) { response.writeHead(map.status, map.headers).end(map.body); return; }
    if (url.pathname === '/ports.json' || url.pathname.startsWith('/api/')) {
      if (guideOffline && url.pathname.startsWith('/api/city/')) { request.socket.destroy(); return; }
      const data = apiResponse(url, request.method);
      if (url.pathname === '/api/route') await delay(routeDelay);
      response.writeHead(data ? 200 : 404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(data || {}));
      return;
    }
    const name = url.pathname === '/' || url.pathname === '/explore' ? 'index.html' : url.pathname.slice(1);
    if (!/^[a-z0-9.-]+$/i.test(name)) { response.writeHead(404).end(); return; }
    const base = /\.(svg|ico|png|json)$/.test(name) ? 'client/public' : 'client/src';
    const content = await readFile(path.join(root, base, name));
    const type = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml' }[path.extname(name)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type }); response.end(content);
  } catch (error) { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(path.join(tmpdir(), 'portlore-headless-'));
let browser, socket;
const errors = [];
try {
  browser = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  browser.on('error', error => errors.push(error.message));
  const activePort = path.join(profile, 'DevToolsActivePort');
  const started = Date.now();
  while (!existsSync(activePort)) {
    if (errors.length || Date.now() - started > 20000) throw Error(errors.join('\n') || 'Headless Chrome did not start; set CHROME_PATH');
    await delay(100);
  }
  const port = (await readFile(activePort, 'utf8')).split('\n')[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await once(socket, 'open');
  let nextId = 0;
  const pending = new Map();
  function command(method, params = {}) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 15000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  socket.addEventListener('message', async event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      clearTimeout(waiter.timeout); pending.delete(message.id);
      if (message.error) waiter.reject(Error(message.error.message)); else waiter.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(arg => arg.description || arg.value).join(' '));
    if (message.method === 'Fetch.requestPaused') {
      const { requestId, request, resourceType } = message.params;
      const url = new URL(request.url);
      try {
        if (url.origin === origin && !(guideOffline && url.pathname.startsWith('/api/city/'))) {
          await command('Fetch.continueRequest', { requestId }); return;
        }
        if (guideOffline && url.pathname.startsWith('/api/city/')) {
          await command('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' }); return;
        }
        let body = Buffer.alloc(0), type = 'text/css', status = 200;
        if (vendors.has(request.url)) {
          body = vendors.get(request.url); type = url.pathname.endsWith('.js') ? 'application/javascript' : 'text/css';
        } else if (url.hostname === 'cancelled-fixture.invalid') {
          markFixturePaused();
          await delay(200);
        } else if (url.hostname === 'portlore.com' && url.pathname.startsWith('/maps/')) {
          const map = await mapResponse(url, request.headers);
          assert.ok(map, 'Unexpected map archive');
          await command('Fetch.fulfillRequest', { requestId, responseCode: map.status,
            responseHeaders: Object.entries(map.headers).map(([name, value]) => ({ name, value })), body: map.body.toString('base64') });
          return;
        } else if (url.hostname === 'portlore.com' || url.hostname === 'api.open-meteo.com') {
          const data = url.hostname === 'portlore.com' ? apiResponse(url, request.method) : { current: { temperature_2m: 18, weathercode: 0, windspeed_10m: 8 } };
          if (url.pathname === '/api/route') await delay(routeDelay);
          body = Buffer.from(JSON.stringify(data || {})); type = 'application/json'; status = data ? 200 : 404;
        } else if (resourceType === 'Image') {
          body = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7x8AAAAASUVORK5CYII=', 'base64'); type = 'image/png';
        }
        await command('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: type }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: body.toString('base64') });
      } catch (error) {
        // Chrome can retire a request before its queued interception event reaches the test.
        if (error.message === 'Invalid InterceptionId.') {
          if (url.hostname === 'cancelled-fixture.invalid') cancelledFixtures++;
          return;
        }
        errors.push(error.message);
      }
    }
  });
  await command('Runtime.enable'); await command('Page.enable');
  await command('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  async function evaluate(expression) {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async function until(expression, label) {
    const start = Date.now();
    while (!(await evaluate(`(() => { try { return !!(${expression}); } catch { return false; } })()`))) {
      if (errors.length || Date.now() - start > 10000) throw Error(`${label}: ${errors.join('\n') || 'timed out'}`);
      await delay(50);
    }
  }
  async function viewport(width, height) {
    await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await delay(150);
  }
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (yes, no) => no({ code: 1 }) } });` });
  await viewport(390, 844);
  await command('Page.navigate', { url: origin });
  await until("!!document.querySelector('#goBtn') && document.querySelector('#w-aboard').value !== ''", 'Welcome initialization');
  await click('#w-port-change');
  await evaluate("const search = document.querySelector('#w-search-input'); search.value = 'mazatlan'; search.dispatchEvent(new Event('input', { bubbles: true }));");
  await until("document.querySelector('#w-search-results').textContent.includes('Mazatlán')", 'Accent-insensitive search');
  await evaluate("window.portDots = 0; const circleMarker = L.circleMarker; L.circleMarker = (...args) => { window.portDots++; return circleMarker(...args); };");
  await click('#w-map-open');
  await until("document.querySelector('#home-port-map canvas')", 'Port canvas map');
  assert.equal(await evaluate("document.querySelectorAll('#home-port-map .leaflet-interactive').length"), 0);
  assert.equal(await evaluate('window.portDots'), ports.length);
  await until("document.querySelector('#home-port-map canvas.leaflet-tile-loaded')", 'World background tiles');
  assert.ok(await evaluate("document.querySelector('#home-port-map .leaflet-control-attribution').textContent.includes('OpenStreetMap contributors')"));
  await click('#port-map-close');
  for (const [width, height] of [[360, 640], [390, 844], [430, 932], [915, 412], [1280, 600]]) {
    await viewport(width, height);
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), `Welcome overflow at ${width}x${height}`);
    if (width < 900) assert.ok(await evaluate('document.documentElement.scrollHeight <= innerHeight + 1'), `Welcome height at ${width}x${height}`);
  }
  await viewport(1280, 800);
  await command('Page.navigate', { url: `${origin}/explore?minutes=240&port=halifax-canada` });
  await until("document.querySelectorAll('#explore-list .acard').length === 3 && document.querySelector('#dp-map canvas')", 'Desktop guide and map');
  await until("document.querySelector('#dp-map canvas.leaflet-tile-loaded')", 'Desktop background fallback');
  await click('#explore-list .acard-add');
  await until("document.querySelectorAll('#itin-list .itin-card').length === 1", 'Add to day');
  await click('[data-tab="itinerary"]');
  await until("document.querySelector('#itin-summary').textContent.includes('walking')", 'Walking route');
  await evaluate("const duration = document.querySelector('.itin-duration input'); duration.value = 90; duration.dispatchEvent(new Event('change', { bubbles: true }));");
  assert.ok(await evaluate("document.querySelector('#itin-summary').textContent.includes('1 hr 30 min')"));
  await click('[data-tab="explore"]');
  await click('#explore-list .acard');
  await until("document.querySelector('#detail').classList.contains('open')", 'Stop details');
  assert.ok(await evaluate("document.querySelector('#d-hours').textContent.includes('Open 24 hours')"));
  await click('#d-close');
  await click('#explore-list .acard[data-id="halifax-canada-cafe"]');
  assert.equal(await evaluate("document.querySelector('#d-local').hidden"), false);
  assert.equal(await evaluate("document.querySelector('#d-local').textContent"), 'مقهى');
  await click('#d-close');
  await click('[data-tab="more"]');
  await click('#b-sail');
  await until("document.querySelector('#reminder-picker').classList.contains('open')", 'Sail-away reminder picker');
  await click('#reminder-picker-cancel');
  await click('[data-tab="explore"]');
  await evaluate("document.querySelector('#desktop-nearby-input').value = 'coffee'; document.querySelector('[data-nearby-search=desktop]').click();");
  await until("document.querySelector('#desktop-nearby-status').textContent.includes('1 place')", 'Nearby map search');
  await viewport(390, 844);
  await click('[data-tab="map"]');
  await until("document.querySelector('#map-container canvas')", 'Phone map');
  await until("document.querySelector('#map-container canvas.leaflet-tile-loaded')", 'Phone background fallback');
  await viewport(1280, 800);
  await until("document.querySelector('[data-tab=explore]').classList.contains('active')", 'Wide-screen map tab switch');
  await viewport(390, 844);
  await until("document.querySelector('[data-tab=map]').classList.contains('active')", 'Phone map tab restored');
  await click('[data-tab="explore"]');
  await click('#backBtn');
  await until("document.querySelector('#page-welcome').classList.contains('active')", 'Back to welcome');
  routeDelay = 500;
  await command('Page.navigate', { url: `${origin}/explore?minutes=240&port=halifax-canada` });
  await until("document.querySelectorAll('#explore-list .acard').length === 3", 'Reload guide');
  await click('#explore-list .acard-add');
  await click('#backBtn');
  await delay(650);
  assert.ok(await evaluate("document.querySelector('#page-welcome').classList.contains('active')"));
  routeDelay = 0;
  await viewport(1280, 800);
  await command('Page.navigate', { url: `${origin}/explore?minutes=240&port=halifax-canada` });
  await until("document.querySelectorAll('#explore-list .acard').length === 3 && document.querySelector('#dp-map canvas')", 'Guide before port change');
  await evaluate("window.portMarkers = []; const marker = L.circleMarker; L.circleMarker = (...args) => { const result = marker(...args); window.portMarkers.push(result); return result; }; const select = document.querySelector('#terminal-select'); select.selectedIndex = 1; select.dispatchEvent(new Event('change', { bubbles: true }));");
  await until('window.portMarkers.length > 600', 'Terminal map rebuild');
  routeDelay = 500;
  await click('#explore-list .acard-add');
  await evaluate("const nextPortMarker = window.portMarkers.find(marker => marker.getPopup()?.getContent().querySelector('strong')?.textContent === 'Saint John'); nextPortMarker.getPopup().getContent().querySelector('.port-popup-select').click();");
  await until("document.querySelector('#topbar-city').textContent.includes('Saint John')", 'In-session port change');
  await delay(650);
  routeDelay = 0;
  assert.equal(await evaluate("document.querySelectorAll('#itin-list .itin-card').length"), 0);
  assert.equal(await evaluate("document.querySelectorAll('#hidden-gems-list .acard').length"), 1);
  await evaluate("void fetch('https://cancelled-fixture.invalid/request').catch(() => {});");
  await fixturePaused;
  guideOffline = true;
  await command('Page.navigate', { url: `${origin}/explore?minutes=240&port=saint-john-canada` });
  await until("document.querySelector('#toast').textContent.includes('Offline')", 'Saved offline guide');
  await delay(250);
  assert.equal(cancelledFixtures, 1, 'Cancelled fixture response must be ignored after navigation');
  guideOffline = false;
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `window.Capacitor = { isNativePlatform: () => true, Plugins: { App: { addListener() {} }, SystemBars: { setStyle: async () => {} } } };` });
  await command('Page.navigate', { url: `${origin}/explore?minutes=240&port=halifax-canada` });
  await until("document.querySelectorAll('#explore-list .acard').length === 3", 'Native-origin client');
  assert.equal(await evaluate("import('/platform.js').then(platform => platform.API_ORIGIN)"), 'https://portlore.com');
  await viewport(390, 844);
  await click('[data-tab="map"]');
  await until("document.querySelector('#map-container canvas')", 'Native phone map');
  await until("document.querySelector('#map-container canvas.leaflet-tile-loaded')", 'Native background tiles');
  assert.ok(mapRequests.some(url => url.startsWith('https://portlore.com/maps/')));
  await click('#backBtn');
  await delay(200);
  assert.ok(await evaluate("document.querySelector('#page-welcome').classList.contains('active')"));
  assert.ok(requests.every(request => !/POST \/api\/generate\//.test(request)));
  assert.deepEqual(errors, []);
  console.log('Headless client checks passed: search, canvas maps, planner, details, nearby search, responsive tabs, port reset, late route, offline guide and native origin.');
} finally {
  socket?.close();
  if (browser && browser.exitCode === null) { browser.kill(); await Promise.race([once(browser, 'exit'), delay(3000)]); }
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
