import { NATIVE_APP, API_ORIGIN, nativePlugin } from './platform.js';
import { createState } from './state.js';
import { lineIconSvg, placeLineIcon } from './icons.js';
import { hav, dlabel, enrich as enrichPlaces, STOP_CATEGORY_LABELS, inferStopCategory, normalizeStop, defaultVisitMinutes, walkMinutes } from './places.js';
import { todaysHours, escapeText, closingMinutes, clockLabel } from './hours.js';
import { findPorts } from './search.js';
import { createGuideStore } from './storage.js';
import { createGuideApi } from './guide-api.js';
import { createPlanner } from './planner.js';
import { createMaps } from './maps.js';
import { createScreens, isDesktop } from './screens.js';
import { createReminders } from './reminders.js';

const state = createState();
let activeStopCategory = 'all';
const { readSaved, saveGuide } = createGuideStore(localStorage);
const { loadGuide } = createGuideApi({ origin: API_ORIGIN, store: { readSaved, saveGuide } });
const { allAvailablePlaces, getItinPlaces, isInItin, syncItinIds, addToItin, removeFromItin,
  refreshExploreButtons, updateDetailItinBtn, fmtMinutes, refreshItinTab, renderItinerary } = createPlanner(state, {
  openDetail, showToast,
  highlightPins: () => highlightPins(),
  drawPlanLine: map => drawPlanLine(map),
});
const { closeHomePortMap, resetExploreMaps, initDesktopMap, initMobileMap, updateUserPins,
  highlightPins, pulsePin, unpulsePin, clearSelectedMapPlace, drawPlanLine } = createMaps(state, {
  syncSystemBars, selectPort, switchPortFromMap, terminalKey, setActiveTerminal, enrich,
  googleMapsSearchUrl, googleMapsDirectionsUrl, openDetail, getItinPlaces, isInItin, addToItin, removeFromItin,
});
createScreens(state, { initDesktopMap, initMobileMap });
const { checkSailReminder, renderSailReminder, syncNativeSailReminder } = createReminders(state, {
  showToast, closeDetail, closeHomePortMap, goToWelcome,
});

const PATH = window.location.pathname.replace(/\/$/, '') || '/';
const IS_EXPLORE = PATH === '/explore';

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  syncSystemBars();
}
// Newer Android WebViews draw the page under the status bar, so the icons follow the page; older ones keep a
// navy band above it, where the icons always stay light.
function drawsUnderStatusBar() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;height:var(--inset-top)';
  document.body.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return height > 0;
}
function syncSystemBars() {
  const bars = nativePlugin('SystemBars');
  if (!bars) return;
  const darkTop = !drawsUnderStatusBar()
    || (document.getElementById('page-welcome').classList.contains('active')
      && !document.getElementById('port-map-overlay').classList.contains('open'));
  bars.setStyle({ style: darkTop ? 'DARK' : 'LIGHT' }).catch(() => {});
}
function resetGoButton() {
  const btn = document.getElementById('goBtn');
  btn.textContent = 'Plan my day';
  refreshBtn();
}

function goToWelcome() {
  history.pushState({}, '', '/');
  showPage('page-welcome');
  clearInterval(state.cdownTimer);
  resetExploreMaps();
  state.city = null;
  state.exploreBooted = false;
  resetDayPlan();
  resetGoButton();
}
// A day plan belongs to one port, so every way of changing port starts a new one.
function resetDayPlan() {
  state.searchedPlaces = [];
  state.itineraryIds = [];
  state.itineraryDurations = {};
  state.itineraryRoute = null;
  state.itineraryRouteToken++; // drops a walking route still loading for the old port
  syncItinIds();
  document.querySelector('.nav-tab[data-tab="explore"]').click();
}
window.addEventListener('popstate', async () => {
  const p = window.location.pathname.replace(/\/$/, '') || '/';
  if (p !== '/explore') {
    goToWelcome();
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const mins = parseInt(params.get('minutes'));
  const portId = params.get('port');
  if (!mins || mins < 10 || !portId) {
    goToWelcome();
    return;
  }

  state.totalMins = mins;
  state.cdownMins = mins;
  state.exploreBooted = false;
  if (state.city?.id !== portId) resetDayPlan();
  await loadCity(portId);
  if (!state.city) {
    goToWelcome();
    return;
  }

  showPage('page-explore');
  bootExplore();
  resetGoButton();
});

let toastTmr=null;

async function init() {
  try {
    const r = await fetch(API_ORIGIN+'/ports.json', { cache: 'no-store' });
    if (r.ok) state.ports = await r.json();

    const generatedResponse = await fetch(API_ORIGIN+'/api/city', { cache: 'no-store' });
    if (generatedResponse.ok) {
      const { generatedIds = [] } = await generatedResponse.json();
      const generatedSet = new Set(generatedIds);
      state.ports.forEach(port => {
        if (generatedSet.has(port.id)) port.generated = true;
      });
    }
    if (state.ports.length) localStorage.setItem('portlore-ports', JSON.stringify(state.ports));
  } catch {}
  if (!state.ports.length) {
    const saved = readSaved('portlore-ports');
    const savedGuides = new Set(readSaved('portlore-saved-guides') || []);
    if (Array.isArray(saved)) state.ports = saved.map(port => ({ ...port, generated: port.generated || savedGuides.has(port.id) }));
  }
  fetchGenericPhoto();
  checkNewGuides();

  const presetPort = !IS_EXPLORE && state.ports.find(p => p.id === new URLSearchParams(window.location.search).get('port'));
  if (presetPort) {
    selectPort(presetPort);
    history.replaceState({}, '', '/');
  }

  if (IS_EXPLORE) {
    const mins = parseInt(new URLSearchParams(window.location.search).get('minutes'));
    const portId = new URLSearchParams(window.location.search).get('port');
    if (mins && mins >= 10 && portId) {
      state.totalMins = mins; state.cdownMins = mins;
      await loadCity(portId);
      if (state.city) { showPage('page-explore'); bootExplore(); }
      else goToWelcome();
    } else goToWelcome();
  }
}
function findNearestPort(lat, lng) {
  if (!state.ports.length) return null;
  let nearest=null, minDist=Infinity;
  for (const p of state.ports) {
    const d = hav(lat, lng, p.lat, p.lng);
    if (d < minDist) { minDist=d; nearest=p; }
  }
  return minDist < 50000 ? nearest : null;
}

function selectPort(port) {
  resetGoButton();
  state.selectedPort = port;
  document.getElementById('w-port-row').style.display = 'flex';
  document.getElementById('w-port-search').style.display = 'none';
  document.getElementById('w-port-name').textContent = port.city;
  document.getElementById('w-port-name').classList.remove('detecting');
  document.getElementById('w-port-sub').textContent = `${port.terminal}, ${port.country}`;
  document.getElementById('w-city').textContent = port.city;
  document.getElementById('w-eyebrow').textContent = port.country;
  document.getElementById('w-tagline').textContent = 'Discover what this port has to offer';
  refreshBtn();
  if (!port.generated) checkNewGuides();
  if (port.generated) {
    fetchPortPhoto(port);
  } else {
    fetchPhotoByQuery(`${port.city} ${port.country} harbor cruise port`, 'center 65%');
  }
}

async function fetchGenericPhoto() {
  await fetchPhotoByQuery('cruise ship harbor port travel', 'center 65%');
}

async function fetchPortPhoto(port) {
  try {
    const r = await fetch(`${API_ORIGIN}/api/city/${port.id}`);
    if (!r.ok) return;
    const data = await r.json();
    if (data.photo_query) {
      await fetchPhotoByQuery(data.photo_query, data.background_position || 'center 70%');
    }
  } catch {}
}

async function fetchPhotoByQuery(query, bgPosition) {
  try {
    const r = await fetch(`${API_ORIGIN}/api/photo?q=${encodeURIComponent(query)}`);
    if (!r.ok) return;

    const data = await r.json();
    if (data.photos?.length) {
      applyPhoto(data.photos[Math.floor(Math.random() * data.photos.length)], bgPosition);
    }
  } catch {}
}

function applyPhoto(photoData, bgPosition) {
  const url = typeof photoData === 'string' ? photoData : photoData?.url;
  const photographer = typeof photoData === 'object' ? photoData.photographer : null;
  const photographerUrl = typeof photoData === 'object' ? photoData.photographer_url : null;
  if (!url) return;
  const photo = document.getElementById('w-photo');
  const img = new Image();
  img.onload = () => {
    photo.style.backgroundImage = `url('${url}')`;
    photo.style.backgroundPosition = bgPosition || 'center 70%';
    photo.classList.add('loaded');
    const credit = document.getElementById('w-photo-credit');
    if (photographer) {
      credit.innerHTML = `Photo by <a href="${photographerUrl || '#'}" target="_blank" rel="noopener noreferrer">${photographer}</a> on <a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer">Pexels</a>`;
    } else {
      credit.textContent = '';
    }
  };
  img.src = url;
}
function showSearch() {
  document.getElementById('w-port-row').style.display = 'none';
  document.getElementById('w-port-search').style.display = 'flex';
  setTimeout(() => document.getElementById('w-search-input')?.focus(), 50);
}

function hideSearch() {
  document.getElementById('w-port-search').style.display = 'none';
  document.getElementById('w-port-row').style.display = 'flex';
}

document.getElementById('w-port-change').addEventListener('click', showSearch);
document.getElementById('w-search-clear').addEventListener('click', () => {
  document.getElementById('w-search-input').value = '';
  document.getElementById('w-search-results').innerHTML = '';
  if (state.selectedPort) hideSearch();
});

document.getElementById('w-locate-btn').addEventListener('click', () => {
  const btn = document.getElementById('w-locate-btn');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="w-spinner"></span>';
  document.getElementById('w-port-sub').textContent = 'Finding your nearest cruise port...';

  if (!navigator.geolocation) {
    showToast('Location is not supported in this browser');
    btn.disabled = false;
    btn.innerHTML = original;
    return;
  }

  navigator.geolocation.getCurrentPosition(
    pos => {
      state.userLat = pos.coords.latitude;
      state.userLng = pos.coords.longitude;
      state.locationGranted = true;
      state.usingPortFallback = false;
      const nearest = findNearestPort(state.userLat, state.userLng);
      if (nearest) { selectPort(nearest); hideSearch(); }
      else {
        showToast('No cruise port found nearby');
        document.getElementById('w-port-sub').textContent = 'Search worldwide or use your location';
      }
      btn.disabled = false;
      btn.innerHTML = original;
    },
    () => {
      showToast('Could not get location');
      document.getElementById('w-port-sub').textContent = 'Search worldwide or use your location';
      btn.disabled = false;
      btn.innerHTML = original;
    },
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 }
  );
});

let searchTimeout;
document.getElementById('w-search-input').addEventListener('input', e => {
  clearTimeout(searchTimeout);
  const q = e.target.value.trim().toLowerCase();
  if (q.length < 2) { document.getElementById('w-search-results').innerHTML = ''; return; }
  searchTimeout = setTimeout(() => renderSearchResults(q), 150);
});

function renderSearchResults(q) {
  const results = findPorts(state.ports, q);

  const el = document.getElementById('w-search-results');
  el.innerHTML = '';
  results.forEach(p => {
    const btn = document.createElement('button');
    btn.className = `w-search-result${p.generated ? '' : ' not-generated'}`;
    btn.innerHTML = `<span class="w-search-result-city">${p.city}</span><span class="w-search-result-meta">${p.terminal}, ${p.country}</span>`;
    btn.addEventListener('click', () => {
      selectPort(p);
      hideSearch();
      document.getElementById('w-search-input').value = '';
      document.getElementById('w-search-results').innerHTML = '';
    });
    el.appendChild(btn);
  });

  if (!results.length) {
    el.innerHTML = `<div style="color:rgba(255,255,255,0.35);font-size:0.78rem;padding:0.5rem 0.75rem">No ports found</div>`;
  }
}
function terminalKey(terminal) {
  if (!terminal) return '';
  if (terminal.osmType && terminal.osmId) return `${terminal.osmType}:${terminal.osmId}`;
  return `${terminal.name || ''}|${Number(terminal.lat).toFixed(6)}|${Number(terminal.lng).toFixed(6)}`;
}

function terminalStorageKey() {
  const portId = state.selectedPort?.id || state.city?.id;
  return portId ? `portlore-terminal:${portId}` : '';
}

function renderTerminalSelector() {
  const wrap = document.getElementById('terminal-picker');
  const select = document.getElementById('terminal-select');
  if (!wrap || !select) return;
  const terminals = state.city?.terminals || [];
  const walkFrom = document.getElementById('walk-from');
  const dockNote = document.getElementById('dock-note');
  if (walkFrom) {
    walkFrom.innerHTML = state.city?.centre ? `From <b>${state.city.centre.name}</b>` : terminals.length < 2 ? `From <b>${state.city?.port?.name || 'the pier'}</b>` : 'From';
    dockNote.innerHTML = state.city?.centre ? `Ships dock at ${terminals.length < 2 ? `<b>${state.city.port?.name || 'the port'}</b>` : ''}` : '';
    (state.city?.centre ? dockNote : document.getElementById('walk-from-line')).appendChild(wrap);
  }
  if (terminals.length < 2) {
    wrap.classList.remove('visible');
    select.innerHTML = '';
    return;
  }

  const activeKey = terminalKey(state.city.port);
  select.innerHTML = '';
  terminals.forEach((terminal, index) => {
    const option = document.createElement('option');
    option.value = terminalKey(terminal);
    option.textContent = terminal.name || `Cruise terminal ${index + 1}`;
    option.selected = option.value === activeKey;
    select.appendChild(option);
  });
  wrap.classList.add('visible');
}

function setActiveTerminal(terminal, remember = true) {
  if (!state.city || !terminal) return;
  state.city.port = { ...state.city.port, ...terminal, address: terminal.address || state.city.port.address || '' };
  if (remember) {
    const key = terminalStorageKey();
    if (key) localStorage.setItem(key, terminalKey(terminal));
  }
  renderTerminalSelector();
  if (state.exploreBooted) {
    buildExploreList();
    buildMapList();
    refreshMapsForResolvedTerminals();
    refreshItinTab();
  }
}

document.getElementById('terminal-select').addEventListener('change', event => {
  const terminal = state.city?.terminals?.find(item => terminalKey(item) === event.target.value);
  if (terminal) setActiveTerminal(terminal);
});

function resolvePortTerminals(portId) {
  if (!state.city) return;
  const port = state.ports.find(item => item.id === portId) || state.selectedPort;
  if (!port) return;

  const embeddedTerminals = (state.city.terminals || []).filter(terminal =>
    Number.isFinite(Number(terminal.lat)) && Number.isFinite(Number(terminal.lng))
  );
  const fallbackTerminal = {
    id: 'ports-json-anchor',
    name: state.city.port?.name || port.terminal,
    lat: Number(state.city.port?.lat ?? port.lat),
    lng: Number(state.city.port?.lng ?? port.lng),
    address: state.city.port?.address || port.address || '',
    source: 'ports.json',
  };

  state.city.terminals = embeddedTerminals.length ? embeddedTerminals : [fallbackTerminal];
  const savedKey = localStorage.getItem(`portlore-terminal:${portId}`);
  const selectedTerminal = state.city.terminals.find(terminal => terminalKey(terminal) === savedKey)
    || state.city.terminals.find(terminal => terminal.id === state.city.defaultTerminalId)
    || state.city.terminals[0];
  state.city.port = {
    ...state.city.port,
    ...selectedTerminal,
    address: selectedTerminal.address || state.city.port?.address || port.address || '',
  };
  const centreName = port.guideCentre || '';
  state.city.centre = centreName ? { name: `central ${centreName}`, lat: Number(port.lat), lng: Number(port.lng) } : null;
  renderTerminalSelector();
  setTerminalLookupStatus(false);
  if (state.exploreBooted) {
    buildExploreList();
    buildMapList();
  }
  refreshMapsForResolvedTerminals();
  if (state.itineraryIds.length) refreshItinTab();
}

function setTerminalLookupStatus(show) {
  ['mobile-terminal-status', 'desktop-terminal-status'].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.classList.toggle('visible', show);
  });
}

function refreshMapsForResolvedTerminals() {
  if (!state.exploreBooted) return;
  resetExploreMaps();
  if (isDesktop()) {
    initDesktopMap();
    return;
  }
  const mapPanel = document.getElementById('tab-map');
  if (mapPanel?.classList.contains('active')) initMobileMap();
}

async function loadCity(portId) {
  const result = await loadGuide(portId);
  if (!result) return false;
  state.city = result.guide;
  resolvePortTerminals(portId);
  if (result.offline) showToast('Offline. Showing your saved guide.');
  return true;
}

async function generateCity(port) {
  showPage('page-generating');
  document.getElementById('gen-title').textContent = `Building the ${port.city} guide`;

  const fill = document.getElementById('gen-bar-fill');
  const status = document.getElementById('gen-status');
  const startedAt = Date.now();
  const statuses = [
    [0, 'Getting to know the port...'],
    [4, 'Finding the places worth your time...'],
    [8, 'Picking out the must-see sights...'],
    [13, 'Looking for good places to eat and shop...'],
    [18, 'Adding a few local favourites...'],
    [24, 'Writing your port guide...'],
    [30, 'Checking how far everything is from the ship...'],
    [38, 'Finishing up your recommendations...'],
    [50, 'Almost there. Bigger destinations can take a little longer...']
  ];
  let statusIndex = 0;
  fill.style.width = '4%';
  status.textContent = statuses[0][1];
  const interval = setInterval(() => {
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    const pct = Math.min(92, 4 + 88 * (1 - Math.exp(-elapsedSeconds / 22)));
    fill.style.width = pct.toFixed(1) + '%';

    while (statusIndex + 1 < statuses.length && elapsedSeconds >= statuses[statusIndex + 1][0]) {
      statusIndex++;
      status.textContent = statuses[statusIndex][1];
    }
  }, 1000);

  try {
    const startResponse = await fetch(`${API_ORIGIN}/api/generate/${port.id}`, { method: 'POST' });
    const startData = await startResponse.json().catch(() => ({}));

    if (!startResponse.ok) {
      throw new Error(startData.error || 'Could not start city generation.');
    }

    let ready = startData.status === 'exists';
    let attempts = 0;
    const maxAttempts = 150;
    while (!ready && attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 2000));
      const r = await fetch(`${API_ORIGIN}/api/generate/${port.id}/status`);
      const data = await r.json();
      if (data.status === 'failed') throw new Error(data.error);
      ready = data.status === 'ready';
      attempts++;
    }

    if (!ready || !(await loadCity(port.id))) {
      throw new Error('City generation did not finish. Try again in a few minutes.');
    }
  } catch (err) {
    showToast(err.message);
    showPage('page-welcome');
    return false;
  } finally {
    clearInterval(interval);
    fill.style.width = '100%';
  }

  return true;
}
document.getElementById('goBtn').addEventListener('click', async () => {
  const mins = getMins();
  if (!mins || !state.selectedPort) return;
  state.totalMins = mins; state.cdownMins = mins;

  if (state.city?.id !== state.selectedPort.id) resetDayPlan();
  const goBtn = document.getElementById('goBtn');
  const originalText = goBtn.textContent;
  goBtn.disabled = true;
  goBtn.innerHTML = '<span class="w-loading-inline"><span class="w-spinner"></span>Loading stops...</span>';

  const loaded = await loadCity(state.selectedPort.id);

  if (!loaded) {
    if (!state.selectedPort.generated) {
      const generated = await generateCity(state.selectedPort);
      if (!generated) { goBtn.textContent = originalText; refreshBtn(); return; }
      state.selectedPort.generated = true;
      await fetchPortPhoto(state.selectedPort);
    } else {
      showToast('Could not load city data. Is the server running?');
      showPage('page-welcome');
      goBtn.textContent = originalText; refreshBtn();
      return;
    }
  }

  if (!state.city) { showToast('Could not load city data'); showPage('page-welcome'); goBtn.textContent = originalText; refreshBtn(); return; }

  history.pushState({}, '', `/explore?minutes=${mins}&port=${state.selectedPort.id}`);
  showPage('page-explore');
  bootExplore();
});
async function fetchCityPhoto() {
  if (!state.city) return;
  const query = state.city.photo_query || state.city.unsplash_query;
  if (!query) return;

  try {
    const r = await fetch(`${API_ORIGIN}/api/photo?q=${encodeURIComponent(query)}`);
    if (!r.ok) return;
    const data = await r.json();
    const photos = data.photos;
    if (!photos || !photos.length) return;

    const pick = photos[Math.floor(Math.random() * photos.length)];
    const url = pick.url;
    const photographer = pick.photographer;
    const photographerUrl = pick.photographer_url;

    if (!url) return;
    const photo = document.getElementById('w-photo');
    const img = new Image();
    img.onload = () => {
      photo.style.backgroundImage = `url('${url}')`;
      photo.style.backgroundPosition = state.city.background_position || 'center 70%';
      photo.classList.add('loaded');
      if (photographer) {
        document.getElementById('w-photo-credit').innerHTML =
          `Photo by <a href="${photographerUrl}" target="_blank">${photographer}</a> on <a href="https://www.pexels.com" target="_blank">Pexels</a>`;
      }
    };
    img.src = url;
  } catch {
  }
}
// The clock is the device's local time, which matches the port on the day; hours mode covers planning ahead.
const timeState = { mode: 'aboard', aboard: null, hours: 240 };
const STEP_MINS = 30;
const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const clockText = mins => { const m = ((mins % 1440) + 1440) % 1440; const h = Math.floor(m / 60); return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')}`; };
const durationText = mins => `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}`;

function getMins() {
  if (timeState.mode === 'hours') return timeState.hours;
  if (timeState.aboard === null) return null;
  const mins = timeState.aboard - nowMinutes();
  return mins >= 10 ? mins : null;
}

function renderTime() {
  const aboardMode = timeState.mode === 'aboard';
  const clock = document.getElementById('w-aboard');
  const hoursView = document.getElementById('w-hours');
  const note = document.getElementById('w-time-note');
  clock.hidden = !aboardMode;
  hoursView.hidden = aboardMode;
  document.getElementById('w-time-label').textContent = aboardMode ? 'When is all aboard?' : 'How long are you ashore?';
  document.getElementById('w-mode').textContent = aboardMode ? 'Planning ahead? Set hours ashore instead' : 'In port today? Set all aboard time instead';
  if (aboardMode && timeState.aboard !== null) {
    const h = String(Math.floor(timeState.aboard / 60)).padStart(2, '0');
    const m = String(timeState.aboard % 60).padStart(2, '0');
    if (clock.value !== `${h}:${m}`) clock.value = `${h}:${m}`;
  }
  hoursView.textContent = durationText(timeState.hours);
  const mins = getMins();
  note.classList.toggle('warn', aboardMode && timeState.aboard !== null && !mins);
  note.textContent = aboardMode
    ? (mins ? `About ${durationText(mins)} ashore. Head back by ${clockText(nowMinutes() + mins - STEP_MINS)}.` : 'That time has already passed')
    : `Head back ${durationText(Math.max(0, timeState.hours - STEP_MINS))} after arrival.`;

  const bar = document.getElementById('w-hours-bar');
  const ticks = document.getElementById('w-ticks');
  if (!mins) { bar.innerHTML = ''; ticks.innerHTML = ''; return; }
  const start = aboardMode ? nowMinutes() : null;
  const hours = Math.max(1, Math.min(10, Math.floor((mins - STEP_MINS) / 60)));
  const label = offset => (offset === 0 ? (start === null ? 'Arrive' : 'Now') : start === null ? `+${offset / 60}h` : clockText(start + offset));
  bar.innerHTML = '<span></span>'.repeat(hours) + '<span class="back"></span>';
  ticks.innerHTML = Array.from({ length: hours }, (_, i) => `<span>${i % 2 && hours > 6 ? '' : label(i * 60)}</span>`).join('')
    + '<span class="back"></span>';
  requestAnimationFrame(() => {
    for (const el of bar.children) {
      el.style.backgroundSize = `${bar.clientWidth}px 100%`;
      el.style.backgroundPosition = `-${el.offsetLeft - bar.offsetLeft}px 0`;
    }
  });
}

function refreshBtn() {
  renderTime();
  const blocked = !!state.selectedPort && !state.selectedPort.generated && !state.newGuides.available;
  document.getElementById('goBtn').disabled = !(getMins() && state.selectedPort) || blocked;
  document.getElementById('w-go-note').textContent = blocked ? newGuidesMessage() : '';
}

// The server can pause new guides for the day or until a date; ports that already have a guide stay open.
async function checkNewGuides() {
  try {
    const r = await fetch(API_ORIGIN+'/api/generate/availability', { cache: 'no-store' });
    if (r.ok) state.newGuides = await r.json();
  } catch {}
  document.getElementById('page-welcome').classList.toggle('new-guides-off', !state.newGuides.available);
  refreshBtn();
}
function newGuidesMessage() {
  return 'This port is temporarily unavailable.';
}

function stepTime(direction) {
  if (timeState.mode === 'hours') {
    timeState.hours = Math.min(720, Math.max(STEP_MINS, timeState.hours + direction * STEP_MINS));
  } else {
    const base = timeState.aboard ?? nowMinutes();
    timeState.aboard = Math.min(1439, Math.max(0, base + direction * STEP_MINS));
  }
  refreshBtn();
}

timeState.aboard = Math.min(1439, Math.ceil((nowMinutes() + 240) / STEP_MINS) * STEP_MINS);
document.getElementById('w-aboard').addEventListener('input', event => {
  const [h, m] = String(event.target.value).split(':').map(Number);
  timeState.aboard = Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
  refreshBtn();
});
document.getElementById('w-less').addEventListener('click', () => stepTime(-1));
document.getElementById('w-more').addEventListener('click', () => stepTime(1));
document.getElementById('w-mode').addEventListener('click', () => {
  timeState.mode = timeState.mode === 'aboard' ? 'hours' : 'aboard';
  refreshBtn();
});
window.addEventListener('resize', renderTime);
refreshBtn();
document.getElementById('backBtn').addEventListener('click', goToWelcome);
function bootExplore() {
  if (state.exploreBooted) return;
  state.exploreBooted = true;
  document.getElementById('explore-list').innerHTML = '<div class="explore-loading"><div class="w-spinner"></div>Loading stops...</div>';
  document.getElementById('maplist').innerHTML = '<div class="explore-loading"><div class="w-spinner"></div>Loading nearby stops...</div>';

  document.getElementById('topbar-city').textContent = state.city.city;
  document.getElementById('topbar-city').classList.toggle('long', state.city.city.length > 13);
  document.title = `Portlore · ${state.city.city}`;
  buildDeals();
  renderTerminalSelector();

  tickCountdown();
  state.cdownTimer = setInterval(tickCountdown, 60000);
  buildExploreList();
  buildMapList();
  renderItinerary();
  fetchWeather();
  requestLocation();
  if (isDesktop()) initDesktopMap();
}
function requestLocation() {
  if (!navigator.geolocation) return fallbackLoc();
  navigator.geolocation.getCurrentPosition(
    pos => {
      state.userLat = pos.coords.latitude;
      state.userLng = pos.coords.longitude;
      state.locationGranted = true;
      state.usingPortFallback = false;
      document.getElementById('loc-status').innerHTML = '';
      buildExploreList();
      buildMapList();
      updateUserPins();
    },
    () => fallbackLoc(),
    { enableHighAccuracy: true, timeout: 10000 }
  );
}
function fallbackLoc() {
  state.usingPortFallback = false;
  document.getElementById('loc-status').innerHTML = '';
  buildExploreList();
  buildMapList();
}
function googleMapsSearchUrl(place){
  const query=encodeURIComponent([place?.name,place?.address,state.city?.city,state.city?.country].filter(Boolean).join(', ')||`${place?.lat},${place?.lng}`);
  const placeId=place?.googlePlaceId?`&query_place_id=${encodeURIComponent(place.googlePlaceId)}`:'';
  return `https://www.google.com/maps/search/?api=1&query=${query}${placeId}`;
}
function googleMapsDirectionsUrl(place){
  const destination=encodeURIComponent([place?.name,place?.address,state.city?.city,state.city?.country].filter(Boolean).join(', ')||`${place?.lat},${place?.lng}`);
  const placeId=place?.googlePlaceId?`&destination_place_id=${encodeURIComponent(place.googlePlaceId)}`:'';
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}${placeId}`;
}

function enrich(arr) { return enrichPlaces(arr, state.city); }

document.getElementById('stop-filters').addEventListener('click', event => {
  const button = event.target.closest('.stop-filter');
  if (!button) return;
  activeStopCategory = button.dataset.category;
  document.querySelectorAll('.stop-filter').forEach(item => item.classList.toggle('active', item === button));
  buildExploreList();
});

const STOP_BANDS = [
  [5, 'Close to the pier', 'Under 5 minutes'],
  [15, 'A short walk', '6 to 15 minutes'],
  [30, 'A longer walk', '16 to 30 minutes'],
  [Infinity, 'Worth a ride', 'Taxi, bus or train'],
];


// The gems section is moved into the stops list when it is built, and loading a new port clears the list,
// so it is held here rather than looked up each time.
const hiddenGemsSection = document.getElementById('hidden-gems');
const hiddenGemsList = document.getElementById('hidden-gems-list');
function buildExploreList() {
  if (!state.city) return;
  const regular = enrich((state.city.places || []).map(normalizeStop));
  const gems = enrich((state.city.hiddenGems || []).map(normalizeStop));
  const inCategory = place => activeStopCategory === 'all' || place.category === activeStopCategory;
  const filtered = regular.filter(inCategory);
  const filteredGems = gems.filter(inCategory);
  document.querySelectorAll('.stop-filter').forEach(button => {
    const category = button.dataset.category;
    const count = [...regular, ...gems].filter(place => category === 'all' || place.category === category).length;
    button.querySelector('.c').textContent = count || '';
    button.hidden = category !== 'all' && !count;
  });
  const el = document.getElementById('explore-list');
  const gemsWrap = hiddenGemsSection;
  const gemsList = hiddenGemsList;
  el.innerHTML = '';
  gemsList.innerHTML = '';
  filteredGems.forEach(place => gemsList.appendChild(makeCard(place)));
  gemsWrap.style.display = filteredGems.length ? '' : 'none';
  if (!filtered.length && !filteredGems.length) {
    el.innerHTML = '<div class="explore-empty">No stops in this category yet.</div>';
  }
  let lower = 0;
  let gemsPlaced = false;
  STOP_BANDS.forEach(([upper, title, note]) => {
    const items = filtered.filter(place => walkMinutes(place) > lower && walkMinutes(place) <= upper);
    lower = upper;
    if (!items.length) return;
    const head = document.createElement('div');
    head.className = 'stop-band';
    head.innerHTML = `<h3>${state.city.centre && title === 'Close to the pier' ? 'Close to the centre' : title}<span>${items.length}</span></h3><p>${note}</p>`;
    el.appendChild(head);
    items.forEach(place => el.appendChild(makeCard(place)));
    if (!gemsPlaced) { el.appendChild(gemsWrap); gemsPlaced = true; }
  });
  if (!gemsPlaced) el.appendChild(gemsWrap);
  refreshExploreButtons();
}

function buildMapList(){
  if(!state.city) return;
  const el=document.getElementById('maplist'); el.innerHTML='';
  enrich(state.city.places.map(normalizeStop)).slice(0,4).forEach(p=>el.appendChild(makeCard(p)));
}

function makeCard(place){
  const el=document.createElement('div');
  el.className='acard';
  el.dataset.id=place.id;
  const minutes=walkMinutes(place);
  const visit=place.tnLabel||(place.suggestedVisitMinutes?`${place.suggestedVisitMinutes} min`:'');
  const walk=minutes>45?'<div class="awalk ride">Ride</div>':`<div class="awalk">${minutes}<small>min walk</small></div>`;
  el.innerHTML=`
    ${walk}
    <div class="abody">
      <div class="aname">${placeLineIcon(place)}<span>${place.name}</span></div>
      <div class="ameta">${place.subtitle || ''}</div>
      <div class="amins">${visit ? `${visit} visit` : ''}</div>
      <div class="tags">${(place.goodFor||[]).map(t=>`<span class="tag ${t==='deal'?'deal':''}">${t}</span>`).join('')}</div>
    </div>
    <button class="acard-add" data-id="${place.id}" title="Add to my day">${lineIconSvg('plus')}</button>`;
  el.querySelector('.acard-add').addEventListener('click', e => {
    e.stopPropagation();
    if (isInItin(place.id)) removeFromItin(place.id);
    else addToItin(place.id);
  });
  el.addEventListener('mouseenter',()=>pulsePin(place.id));
  el.addEventListener('mouseleave',()=>unpulsePin(place.id));
  el.addEventListener('click',()=>openDetail(place));
  return el;
}
function buildDeals(){
  const deals=(state.city.deals||[]).filter(d=>!d.sample);
  const el=document.getElementById('deals-content');
  if(!deals.length){
    el.className='deals-empty';
    el.textContent='No deals available for this port call yet.';
    return;
  }
  el.className='';
  el.innerHTML='';
  deals.forEach(d=>{
    const div=document.createElement('div');
    div.style.cssText='background:var(--card);border-radius:9px;border:1px solid var(--border);padding:0.85rem 0.9rem;display:flex;gap:0.75rem;align-items:flex-start;margin-bottom:0.75rem';
    div.innerHTML=`<div style="width:38px;height:38px;border-radius:7px;background:#fdf8ef;border:1px solid #e8d8b0;display:flex;align-items:center;justify-content:center;font-size:1.15rem;flex-shrink:0">${d.icon}</div><div><div style="font-size:0.88rem;font-weight:700;color:var(--navy);margin-bottom:0.18rem">${d.name}</div><div style="font-size:0.72rem;color:var(--muted);line-height:1.5">${d.desc}</div><div style="margin-top:0.3rem;font-size:0.68rem;font-weight:700;color:#7a5c20">${d.discount}</div></div>`;
    el.appendChild(div);
  });
}
async function fetchWeather(){
  if(!state.city) return;
  const{lat,lng}=state.city.weather;
  try{
    const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weathercode,windspeed_10m&hourly=temperature_2m&timezone=auto&forecast_days=1`);
    const d=await r.json(); const c=d.current;
    const temp=Math.round(c.temperature_2m), wind=Math.round(c.windspeed_10m);
    const{icon,desc}=wcode(c.weathercode);
    const hour=new Date().getHours();
    const note=wnote(c.weathercode, temp, wind, hour);

    document.getElementById('wx').innerHTML=`
      <div class="wx-icon">${icon}</div>
      <div>
        <span class="wx-temp">${temp}<span class="wx-unit">°C</span></span>
      </div>
      <div class="wx-right">
        <div class="wx-cond-row">and ${String(desc).toLowerCase()}</div>
        <div class="wx-meta-row">${wind} km/h wind</div>
      </div>`;
    document.getElementById('wx-note').textContent=note||'';

  }catch{
    document.getElementById('wx').innerHTML=`<span class="wx-loading">Weather unavailable</span>`;
  }
}
function wcode(c){
  const m={0:{icon:'☀',desc:'Clear'},1:{icon:'🌤',desc:'Mainly clear'},2:{icon:'⛅',desc:'Partly cloudy'},3:{icon:'☁',desc:'Overcast'},45:{icon:'🌫',desc:'Fog'},51:{icon:'🌦',desc:'Light drizzle'},53:{icon:'🌧',desc:'Drizzle'},55:{icon:'🌧',desc:'Heavy drizzle'},61:{icon:'🌧',desc:'Light rain'},63:{icon:'🌧',desc:'Rain'},65:{icon:'🌧',desc:'Heavy rain'},71:{icon:'🌨',desc:'Light snow'},73:{icon:'❄',desc:'Snow'},75:{icon:'❄',desc:'Heavy snow'},80:{icon:'🌦',desc:'Showers'},81:{icon:'🌧',desc:'Showers'},82:{icon:'⛈',desc:'Heavy showers'},95:{icon:'⛈',desc:'Thunderstorm'},99:{icon:'⛈',desc:'Thunderstorm'}};
  return m[c]||{icon:'🌡',desc:'Variable'};
}
function wnote(code, temp, wind, hour){
  // Suppress upbeat status notes overnight.
  if(hour >= 22 || hour < 6) return '';
  if([95,99,82].includes(code)) return 'Bring a rain jacket.';
  if([61,63,65,51,53,55,80,81].includes(code)) return 'Wet out there. Good day for the market.';
  if(wind > 40) return 'Very windy. Exposed areas will be rough.';
  if(temp < 0) return 'Well below freezing. Dress warmly.';
  if(temp < 5) return 'Cold out. Bundle up.';
  if(temp >= 28) return 'Hot day. Stay hydrated.';
  if(temp >= 22 && [0,1,2].includes(code)) return 'Good conditions for walking.';
  return '';
}

async function switchPortFromMap(port) {
  if (!port || port.id === state.selectedPort?.id) return;
  if (!port.generated && !state.newGuides.available) return showToast(newGuidesMessage());
  state.selectedPort = port;
  showToast(`Loading ${port.city}...`);
  resetExploreMaps();
  state.city = null;
  state.exploreBooted = false;
  clearInterval(state.cdownTimer);
  resetDayPlan();

  let loaded = await loadCity(port.id);
  if (!loaded && !port.generated) {
    loaded = await generateCity(port);
    if (loaded) port.generated = true;
  }
  if (!loaded || !state.city) {
    showToast('Could not load that port');
    goToWelcome();
    selectPort(port);
    return;
  }

  history.pushState({}, '', `/explore?minutes=${state.totalMins}&port=${port.id}`);
  showPage('page-explore');
  bootExplore();
}

function openDetail(place){
  state.currentPlace=place;
  const walk=walkMinutes(place);
  const visit=Number(place.suggestedVisitMinutes)||defaultVisitMinutes(place);
  document.getElementById('d-kind').innerHTML=`${placeLineIcon(place)}${STOP_CATEGORY_LABELS[place.category] || STOP_CATEGORY_LABELS[inferStopCategory(place)] || 'Stop'}`;
  document.getElementById('d-name').textContent=place.name;
  // The name on signs and in local maps, for stops whose guide name is translated or romanised.
  const plainName=value=>String(value||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\p{L}\p{N}]+/gu,'');
  const localName=document.getElementById('d-local');
  localName.textContent=place.localName||'';
  localName.hidden=!place.localName||plainName(place.localName)===plainName(place.name);
  document.getElementById('d-meta').textContent=place.subtitle || '';
  document.getElementById('d-desc').textContent=place.description || '';
  document.getElementById('d-dist').textContent=walk>45?'Ride':String(walk);
  document.getElementById('d-dist-label').textContent=walk>45?'taxi or transit':`min walk${state.city?.centre?` from ${state.city.centre.name}`:''}`;
  document.getElementById('d-time').textContent=visit>=60?`${Math.floor(visit/60)}h${visit%60?` ${visit%60}m`:''}`:`${visit}m`;
  const today=todaysHours(place.hours);
  const close=closingMinutes(today);
  document.getElementById('d-close-time').textContent=close===null?'—':clockLabel(close);
  document.getElementById('d-close-label').textContent=close===null?'check hours':'closes today';
  const now=new Date();
  const nowMins=now.getHours()*60+now.getMinutes();
  const backBy=nowMins+walk*2+visit;
  const spare=state.cdownMins-(walk*2+visit);
  const note=document.getElementById('d-fit-note');
  const origin=state.city?.centre?state.city.centre.name:'the pier';
  note.classList.toggle('warn', spare<30);
  note.innerHTML=walk>45
    ? 'Too far to walk. Allow for a taxi or transit each way.'
    : spare<0
      ? `Leave now and you'd miss all aboard by <b>${fmtMinutes(-spare)}</b>.`
      : `Leave now and you're back at ${origin} by <b>${clockLabel(backBy)}</b>, ${fmtMinutes(spare)} before all aboard.`;
  const goodFor=place.goodFor || [];
  document.getElementById('d-good-for').textContent=goodFor.map((t,i)=>i?t:t.charAt(0).toUpperCase()+t.slice(1)).join(', ');
  document.getElementById('d-good-for-row').hidden=!goodFor.length;
  const allHours=String(place.hours||'').split(/\s*[·;]\s*/).filter(Boolean);
  const mapsLink=`<a class="d-hours-link" href="${escapeText(googleMapsSearchUrl(place))}" target="_blank" rel="noopener">${today?'Check in Google Maps':'Check hours in Google Maps'}</a>`;
  document.getElementById('d-hours').innerHTML=today
    ? `Today ${escapeText(today)}${allHours.length>1?`<details><summary>All hours</summary><div>${allHours.map(escapeText).join('<br>')}</div></details>`:''}${mapsLink}`
    : `${place.hours?`<div>${escapeText(place.hours)}</div>`:''}${mapsLink}`;
  document.getElementById('d-address').textContent=place.address||'';
  document.getElementById('d-address-row').hidden=!place.address;
  const websiteBtn=document.getElementById('d-website');
  const website=place.officialWebsiteUrl||place.website||'';
  websiteBtn.hidden=!website;
  websiteBtn.dataset.url=website;
  document.getElementById('detail').classList.add('open');
  document.documentElement.classList.add('detail-open');
  document.body.classList.add('detail-open');
  updateDetailItinBtn();
}
function resetDetailSwipe(){
  const sheet=document.querySelector('.d-sheet');
  const backdrop=document.getElementById('dbackdrop');
  sheet.classList.remove('swiping','settling');
  sheet.style.transform='';
  backdrop.style.opacity='';
}
function closeDetail(){
  document.getElementById('detail').classList.remove('open');
  document.documentElement.classList.remove('detail-open');
  document.body.classList.remove('detail-open');
  resetDetailSwipe();
}
const detailSheet=document.querySelector('.d-sheet');
const detailBackdrop=document.getElementById('dbackdrop');
let detailSwipeStartY=0;
let detailSwipeLastY=0;
let detailSwipeStartTime=0;
let detailSwipeActive=false;
let detailSwipeTracking=false;
detailSheet.addEventListener('touchstart',event=>{
  if(!window.matchMedia('(max-width: 760px)').matches||event.touches.length!==1)return;
  const touch=event.touches[0];
  const startedOnHandle=event.target.closest('.d-handle');
  const startedNearTop=touch.clientY-detailSheet.getBoundingClientRect().top<72;
  if(!startedOnHandle&&!startedNearTop&&detailSheet.scrollTop>0)return;
  detailSwipeStartY=touch.clientY;
  detailSwipeLastY=touch.clientY;
  detailSwipeStartTime=Date.now();
  detailSwipeActive=false;
  detailSwipeTracking=true;
},{passive:true});
detailSheet.addEventListener('touchmove',event=>{
  if(!detailSwipeTracking||event.touches.length!==1)return;
  const y=event.touches[0].clientY;
  const delta=y-detailSwipeStartY;
  detailSwipeLastY=y;
  if(delta<=0){
    if(detailSwipeActive){
      detailSheet.style.transform='translateX(-50%) translateY(0)';
      detailBackdrop.style.opacity='';
    }
    return;
  }
  if(!detailSwipeActive){
    if(delta<8)return;
    if(detailSheet.scrollTop>0){detailSwipeTracking=false;return;}
    detailSwipeActive=true;
    detailSheet.classList.add('swiping');
  }
  event.preventDefault();
  detailSheet.style.transform=`translateX(-50%) translateY(${delta}px)`;
  detailBackdrop.style.opacity=String(Math.max(0,1-delta/(detailSheet.offsetHeight*0.75)));
},{passive:false});
function settleDetailSwipe(shouldClose){
  detailSheet.classList.remove('swiping');
  void detailSheet.offsetHeight;
  detailSheet.classList.add('settling');

  let finished=false;
  const finish=()=>{
    if(finished)return;
    finished=true;
    detailSheet.removeEventListener('transitionend',onTransitionEnd);
    if(shouldClose)closeDetail();
    else resetDetailSwipe();
  };
  const onTransitionEnd=event=>{
    if(event.target===detailSheet&&event.propertyName==='transform')finish();
  };
  detailSheet.addEventListener('transitionend',onTransitionEnd);

  requestAnimationFrame(()=>{
    detailSheet.style.transform=shouldClose
      ? 'translateX(-50%) translateY(105%)'
      : 'translateX(-50%) translateY(0)';
    detailBackdrop.style.opacity=shouldClose?'0':'';
  });
  setTimeout(finish,320);
}
detailSheet.addEventListener('touchend',()=>{
  if(!detailSwipeTracking)return;
  const delta=Math.max(0,detailSwipeLastY-detailSwipeStartY);
  const elapsed=Math.max(1,Date.now()-detailSwipeStartTime);
  const velocity=delta/elapsed;
  detailSwipeTracking=false;
  if(!detailSwipeActive){resetDetailSwipe();return;}
  settleDetailSwipe(delta>90||velocity>0.55);
});
detailSheet.addEventListener('touchcancel',()=>{
  detailSwipeTracking=false;
  resetDetailSwipe();
});
document.getElementById('dbackdrop').addEventListener('touchmove',event=>event.preventDefault(),{passive:false});
document.getElementById('dbackdrop').addEventListener('click',closeDetail);
document.getElementById('d-close').addEventListener('click',closeDetail);
document.getElementById('d-maps').addEventListener('click',()=>{if(!state.currentPlace)return;window.open(googleMapsSearchUrl(state.currentPlace),'_blank');});
document.getElementById('d-website').addEventListener('click',event=>{const url=event.currentTarget.dataset.url;if(url&&/^https?:\/\//i.test(url))window.open(url,'_blank','noopener');});
document.getElementById('d-itin-btn').addEventListener('click',()=>{
  if(!state.currentPlace) return;
  if(isInItin(state.currentPlace.id)) removeFromItin(state.currentPlace.id);
  else addToItin(state.currentPlace.id);
});
function doSurp(){
  if(!state.city)return;
  const options=[...(state.city.places||[]), ...(state.city.hiddenGems||[])];
  if(!options.length)return;
  const pick={...options[Math.floor(Math.random()*options.length)]};
  const m=hav(state.city.port.lat,state.city.port.lng,pick.lat,pick.lng);
  pick.distLabel=dlabel(m);
  pick.tnLabel=`${pick.suggestedVisitMinutes ?? 45} min`;
  openDetail(pick);
  showToast('Here is one to try');
}
document.getElementById('surpLink').addEventListener('click',doSurp);
function focusMapSearch(){
  if(isDesktop()){
    const input=document.getElementById('desktop-nearby-input');
    input?.scrollIntoView({behavior:'smooth',block:'center'});
    setTimeout(()=>input?.focus(),350);
    return;
  }
  document.querySelector('[data-tab="map"]')?.click();
  setTimeout(()=>document.getElementById('mobile-nearby-input')?.focus(),120);
}
document.getElementById('explore-search-map').addEventListener('click',focusMapSearch);
document.getElementById('b-port').addEventListener('click',()=>{if(!state.city)return;window.open(googleMapsDirectionsUrl(state.city.port),'_blank');});
document.querySelectorAll('.lang-pill').forEach(p=>{
  p.addEventListener('click',()=>{
    document.querySelectorAll('.lang-pill').forEach(x=>x.classList.remove('sel'));
    p.classList.add('sel');
    const l=p.textContent.trim();
    if(l==='EN'){showToast('Language set to English');return;}
    showToast(`${l} coming soon`);
    setTimeout(()=>{document.querySelectorAll('.lang-pill').forEach(x=>x.classList.remove('sel'));document.querySelector('.lang-pill').classList.add('sel');},1500);
  });
});

function updateLocalTime(){
  const el=document.getElementById('local-time');
  if(!el||!state.city)return;
  try{
    const format=zone=>new Intl.DateTimeFormat([], {timeZone:zone,hour:'numeric',minute:'2-digit'}).format(new Date());
    const time=format(state.city.timezone||undefined);
    el.textContent=time===format(undefined)?'':`${time} in port`;
  }catch{el.textContent='';}
}
function editTimeLeft(){
  const value=prompt('Minutes left in port:', String(state.cdownMins));
  if(value===null)return;
  const mins=Math.round(Number(value));
  if(!Number.isFinite(mins)||mins<10||mins>1440){showToast('Enter between 10 and 1440 minutes');return;}
  state.totalMins=mins; state.cdownMins=mins;
  const params=new URLSearchParams(window.location.search);
  params.set('minutes', String(mins));
  history.replaceState({},'',`${window.location.pathname}?${params.toString()}`);
  tickCountdown();
  renderItinerary();
  showToast('Time left updated');
}
document.getElementById('chip').addEventListener('click',editTimeLeft);
const stopFilters=document.getElementById('stop-filters');
stopFilters.addEventListener('wheel',event=>{
  if(stopFilters.scrollWidth<=stopFilters.clientWidth)return;
  event.preventDefault();
  stopFilters.scrollLeft+=event.deltaY||event.deltaX;
},{passive:false});

let stopFilterScrollFrame=null;
let stopFilterScrollSpeed=0;
function runStopFilterEdgeScroll(){
  if(!stopFilterScrollSpeed){stopFilterScrollFrame=null;return;}
  stopFilters.scrollLeft+=stopFilterScrollSpeed;
  stopFilterScrollFrame=requestAnimationFrame(runStopFilterEdgeScroll);
}
stopFilters.addEventListener('mousemove',event=>{
  if(window.innerWidth<900||stopFilters.scrollWidth<=stopFilters.clientWidth)return;
  const rect=stopFilters.getBoundingClientRect();
  const edge=56;
  if(event.clientX<rect.left+edge){
    stopFilterScrollSpeed=-Math.max(2,(rect.left+edge-event.clientX)/5);
  }else if(event.clientX>rect.right-edge){
    stopFilterScrollSpeed=Math.max(2,(event.clientX-(rect.right-edge))/5);
  }else{
    stopFilterScrollSpeed=0;
  }
  stopFilters.style.cursor=stopFilterScrollSpeed?'ew-resize':'';
  if(stopFilterScrollSpeed&&!stopFilterScrollFrame)stopFilterScrollFrame=requestAnimationFrame(runStopFilterEdgeScroll);
});
stopFilters.addEventListener('mouseleave',()=>{
  stopFilterScrollSpeed=0;
  stopFilters.style.cursor='';
});

function tickCountdown(){
  const h=Math.floor(state.cdownMins/60),m=state.cdownMins%60;
  const chip=document.getElementById('chip');
  const aboard=new Date(Date.now()+state.cdownMins*60000);
  chip.innerHTML=`All aboard<b>${aboard.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</b>${h>0?`${h}h ${String(m).padStart(2,'0')}m left`:`${m}m left`}`;
  const now=document.getElementById('rail-now');
  if(now)now.textContent=new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  chip.classList.toggle('urgent',state.cdownMins<=30);
  checkSailReminder();
  if(state.cdownMins===15)showToast('15 minutes. Head back to port.');
  updateLocalTime();
  renderSailReminder();
  syncNativeSailReminder();
  if(state.cdownMins>0)state.cdownMins--;
}
function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTmr);toastTmr=setTimeout(()=>t.classList.remove('show'),2800);}

init();
