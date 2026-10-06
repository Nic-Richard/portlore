import { hav, normalizeStop, defaultVisitMinutes } from './places.js';
import { lineIconSvg } from './icons.js';
import { clockLabel } from './hours.js';
import { API_ORIGIN } from './platform.js';

export function createPlanner(state, { openDetail, highlightPins, drawPlanLine, showToast }) {
  function allAvailablePlaces() {
    return [...(state.city?.places||[]), ...(state.city?.hiddenGems||[]), ...state.searchedPlaces].map(normalizeStop);
  }
  function getItinPlaces() {
    const all = allAvailablePlaces();
    return state.itineraryIds.map(id => all.find(p => p.id === id)).filter(Boolean);
  }
  function isInItin(id) { return state.itineraryIds.includes(id); }
  function syncItinIds() { state.itinIds = [...state.itineraryIds]; }
  function addToItin(id) {
    if (isInItin(id)) return;
    const place = allAvailablePlaces().find(item => item.id === id);
    if (!place) return;
    state.itineraryIds.push(id);
    state.itineraryDurations[id] ??= defaultVisitMinutes(place);
    syncItinIds();
    refreshItinTab(); refreshExploreButtons(); updateDetailItinBtn(); highlightPins();
    showToast('Added to my day');
  }
  function removeFromItin(id) {
    state.itineraryIds = state.itineraryIds.filter(x => x !== id);
    delete state.itineraryDurations[id];
    syncItinIds();
    refreshItinTab(); refreshExploreButtons(); updateDetailItinBtn(); highlightPins();
    showToast('Removed from my day');
  }
  function refreshExploreButtons() {
    document.querySelectorAll('.acard-add').forEach(btn => {
      const active = isInItin(btn.dataset.id);
      btn.innerHTML = lineIconSvg(active ? 'check' : 'plus');
      btn.classList.toggle('in-itin', active);
      btn.title = active ? 'Remove from my day' : 'Add to my day';
    });
  }
  function updateDetailItinBtn() {
    const btn = document.getElementById('d-itin-btn');
    if (!btn || !state.currentPlace) return;
    const active = isInItin(state.currentPlace.id);
    btn.textContent = active ? 'Remove from my day' : 'Add to my day';
    btn.classList.toggle('in-itin', active);
  }
  function fmtMinutes(minutes) {
    const mins = Math.max(0, Math.round(minutes || 0));
    return mins >= 60 ? `${Math.floor(mins / 60)} hr ${mins % 60 ? `${mins % 60} min` : ''}`.trim() : `${mins} min`;
  }
  function legMinutes(index) { return Math.max(0, Math.ceil((state.itineraryRoute?.legs?.[index]?.durationSeconds || 0) / 60)); }
  async function calculateItineraryRoute() {
    const places = getItinPlaces();
    const token = ++state.itineraryRouteToken;
    if (!state.city?.port || !places.length) { state.itineraryRoute = null; renderItinerary(); return; }
    const origin = state.city.centre || state.city.port;
    const points = [origin, ...places, origin].map(p => ({ lat: Number(p.lat), lng: Number(p.lng) }));
    try {
      const response = await fetch(API_ORIGIN+'/api/route', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ points }) });
      const data = await response.json();
      if (token !== state.itineraryRouteToken) return;
      state.itineraryRoute = response.ok ? data : null;
    } catch { if (token === state.itineraryRouteToken) state.itineraryRoute = null; }
    if (token === state.itineraryRouteToken) { renderItinerary(); drawPlanLine(state.dMap); drawPlanLine(state.mMap); }
  }
  function refreshItinTab() { renderItinerary(); calculateItineraryRoute(); }
  function renderShoreRail(places, visitMins, walkingMins) {
    const rail = document.getElementById('shore-rail');
    const plan = document.getElementById('rail-plan');
    const count = document.getElementById('nav-day-count');
    if (!rail) return;
    count.textContent = places.length ? String(places.length) : '';
    const span = Math.max(state.cdownMins, 1);
    const used = visitMins + walkingMins;
    rail.classList.toggle('over', used > state.cdownMins);
    const back = new Date(Date.now() + used * 60000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    plan.textContent = places.length ? `${fmtMinutes(used)} planned, ${used > state.cdownMins ? 'over time' : `back by ${back}`}` : 'Nothing planned yet';
    const leg = places.length ? walkingMins / (places.length + 1) : 0;
    let at = 0;
    const parts = [];
    const push = (tag, mins) => { const width = Math.min(100, (mins / span) * 100); if (at < 100 && width > 0) parts.push(`<${tag} style="left:${at}%;width:${Math.min(width, 100 - at)}%"></${tag}>`); at += width; };
    places.forEach(place => { push('u', leg); push('i', state.itineraryDurations[place.id] ?? defaultVisitMinutes(place)); });
    if (places.length) push('u', leg);
    rail.innerHTML = parts.join('');
    for (const el of rail.children) {
      el.style.backgroundSize = `${rail.clientWidth}px 100%`;
      el.style.backgroundPosition = `-${el.offsetLeft}px 0`;
    }
  }
  function renderItinerary() {
    const places = getItinPlaces();
    const empty = document.getElementById('itin-empty');
    const list = document.getElementById('itin-list');
    const bar = document.getElementById('itin-time-used');
    const label = document.getElementById('itin-time-label');
    const summary = document.getElementById('itin-summary');
    const optimize = document.getElementById('itin-optimize');
    empty.style.display = places.length ? 'none' : 'flex';
    optimize.style.display = places.length > 1 ? '' : 'none';
    document.getElementById('itin-bar').hidden = !places.length;
    list.innerHTML = '';
    const visitMins = places.reduce((sum, p) => sum + (state.itineraryDurations[p.id] ?? defaultVisitMinutes(p)), 0);
    const walkingMins = state.itineraryRoute ? Math.ceil(state.itineraryRoute.durationSeconds / 60) : 0;
    const totalUsed = visitMins + walkingMins;
    const pct = state.totalMins > 0 ? Math.min((totalUsed / state.totalMins) * 100, 100) : 0;
    const over = totalUsed > state.totalMins;
    bar.style.width = pct + '%'; bar.classList.toggle('over', over); label.classList.toggle('over', over);
    renderShoreRail(places, visitMins, walkingMins);
    label.textContent = places.length ? `${fmtMinutes(totalUsed)} planned` : 'Nothing planned yet';
    summary.textContent = places.length ? `${fmtMinutes(visitMins)} at stops and ${state.itineraryRoute ? `${fmtMinutes(walkingMins)} walking` : 'working out the walking'}.` : 'Add stops from the Stops tab to build your day.';
    const originName = state.city.centre ? state.city.centre.name : (state.city.port.name || 'the pier');
    const start = new Date();
    let clock = start.getHours() * 60 + start.getMinutes();
    if (places.length) list.insertAdjacentHTML('beforeend', `<div class="itin-return itin-start"><div class="itin-clock">${clockLabel(clock)}<small>set off</small></div><div class="itin-axis"><strong>${originName}</strong>${state.city.centre ? 'Where the walking times start' : 'Where your ship docks'}</div></div>`);
    places.forEach((place, i) => {
      const leg = state.itineraryRoute ? legMinutes(i) : null;
      const where = i === 0 ? `Walk from ${originName}` : 'Walk to the next stop';
      if (leg !== 0) list.insertAdjacentHTML('beforeend', `<div class="itin-leg"><b>${leg === null ? '' : fmtMinutes(leg)}</b><span>${leg === null ? 'Working out the walk...' : where}</span></div>`);
      if (leg !== null) clock += leg;
      list.appendChild(makeItinCard(place, i, state.itineraryRoute ? clock : null));
      clock += state.itineraryDurations[place.id] ?? defaultVisitMinutes(place);
    });
    if (places.length) {
      const returnLeg = state.itineraryRoute ? legMinutes(places.length) : null;
      const buffer = state.totalMins - totalUsed;
      const safe = buffer >= 30;
      const statusText = buffer < 0 ? `Over budget by ${fmtMinutes(Math.abs(buffer))}` : `${fmtMinutes(buffer)} buffer`;
      const statusNote = safe ? 'On track' : 'Tight timing';
      if (returnLeg !== null) list.insertAdjacentHTML('beforeend', `<div class="itin-leg"><b>${fmtMinutes(returnLeg)}</b><span>Walk back to ${originName}</span></div>`);
      list.insertAdjacentHTML('beforeend', `<div class="itin-return itin-end"><div class="itin-clock">${returnLeg === null ? '' : clockLabel(clock + returnLeg)}</div><div class="itin-axis"><strong>Back at ${originName}</strong>${returnLeg === null ? 'Working out the walk back...' : state.city.centre ? 'Then the train or coach to the ship' : 'Ready to board'}<div class="itin-safety ${safe ? 'safe' : 'over'}"><span>${statusText}</span><span>${statusNote}</span></div></div></div>`);
    }
  }
  function makeItinCard(place, index, arriveAt = null) {
    const card = document.createElement('div');
    card.className = 'itin-card'; card.dataset.id = place.id; card.draggable = true;
    const duration = state.itineraryDurations[place.id] ?? defaultVisitMinutes(place);
    card.innerHTML = `<div class="itin-clock">${arriveAt === null ? '' : clockLabel(arriveAt)}<small>${fmtMinutes(duration)}</small></div><div class="itin-axis"><div class="itin-card-body"><div class="itin-card-main"><div class="itin-card-name">${place.name}</div><div class="itin-card-meta">${place.subtitle || place.address || place.category || ''}</div>${place.source === 'search' ? '<span class="itin-source-tag">Found nearby</span>' : ''}<div class="itin-duration"><input type="number" min="10" max="360" step="5" value="${duration}" aria-label="Visit duration for ${place.name}"><span>min at this stop</span></div></div><div class="itin-card-right"><button class="itin-grip itin-drag-handle-btn" title="Drag to reorder" aria-label="Drag to reorder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/></svg></button><button class="itin-card-remove" data-id="${place.id}" title="Remove from my day" aria-label="Remove from my day"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div></div></div>`;
    const durationInput = card.querySelector('.itin-duration input');
    durationInput.addEventListener('click', e => e.stopPropagation());
    durationInput.addEventListener('change', e => { state.itineraryDurations[place.id] = Math.max(10, Math.min(360, Number(e.target.value) || defaultVisitMinutes(place))); renderItinerary(); });
    card.querySelector('.itin-card-remove').addEventListener('click', e => { e.stopPropagation(); removeFromItin(place.id); });
    card.addEventListener('click', () => openDetail(place));
    card.addEventListener('dragstart', onDragStart); card.addEventListener('dragover', onDragOver); card.addEventListener('dragleave', onDragLeave); card.addEventListener('drop', onDrop); card.addEventListener('dragend', onDragEnd);
    const dragHandle = card.querySelector('.itin-grip');
    dragHandle.addEventListener('touchstart', onTouchStart, { passive:false }); dragHandle.addEventListener('touchmove', onTouchMove, { passive:false }); dragHandle.addEventListener('touchend', onTouchEnd);
    return card;
  }
  function optimizeItineraryOrder() {
    const places = getItinPlaces();
    if (places.length < 2) return;
    const remaining = [...places];
    const ordered = [];
    let current = state.city.centre || state.city.port;
    while (remaining.length) {
      remaining.sort((a,b) => hav(current.lat,current.lng,a.lat,a.lng)-hav(current.lat,current.lng,b.lat,b.lng));
      current = remaining.shift(); ordered.push(current);
    }
    state.itineraryIds = ordered.map(p => p.id); syncItinIds(); refreshItinTab(); showToast('Reordered for the shortest walk');
  }
  document.getElementById('itin-optimize').addEventListener('click', optimizeItineraryOrder);
  document.getElementById('itin-open-maps').addEventListener('click', () => {
    const origin = state.city.centre || state.city.port;
    const at = p => `${p.lat},${p.lng}`;
    const stops = getItinPlaces().map(at).join('|');
    window.open(`https://www.google.com/maps/dir/?api=1&origin=${at(origin)}&destination=${at(origin)}&waypoints=${encodeURIComponent(stops)}&travelmode=walking`, '_blank');
  });
  let dragId = null;
  let touchDragEl = null, touchClone = null, touchStartY = 0;

  function onDragStart(e) {
    dragId = e.currentTarget.dataset.id;
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  }
  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const card = e.currentTarget;
    if (card.dataset.id === dragId) return;
    const rect = card.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    card.classList.remove('drag-over-top', 'drag-over-bottom');
    card.classList.add(e.clientY < mid ? 'drag-over-top' : 'drag-over-bottom');
  }
  function onDragLeave(e) {
    e.currentTarget.classList.remove('drag-over-top', 'drag-over-bottom');
  }
  function onDrop(e) {
    e.preventDefault();
    const target = e.currentTarget;
    target.classList.remove('drag-over-top', 'drag-over-bottom');
    if (!dragId || target.dataset.id === dragId) return;
    const rect = target.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    const insertBefore = e.clientY < mid;
    const fromIdx = state.itineraryIds.indexOf(dragId);
    let toIdx = state.itineraryIds.indexOf(target.dataset.id);
    state.itineraryIds.splice(fromIdx, 1);
    if (!insertBefore) toIdx = state.itineraryIds.indexOf(target.dataset.id) + 1;
    else toIdx = state.itineraryIds.indexOf(target.dataset.id);
    state.itineraryIds.splice(toIdx, 0, dragId);
    syncItinIds();
    refreshItinTab();
  }
  function onDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    document.querySelectorAll('.itin-card').forEach(c =>
      c.classList.remove('drag-over-top', 'drag-over-bottom', 'dragging')
    );
  }

  function onTouchStart(e) {
    if (e.touches.length !== 1) return;
    e.preventDefault();
    touchDragEl = e.currentTarget.closest('.itin-card');
    dragId = touchDragEl.dataset.id;
    touchStartY = e.touches[0].clientY;
    touchClone = touchDragEl.cloneNode(true);
    touchClone.style.cssText = `position:fixed;left:${touchDragEl.getBoundingClientRect().left}px;width:${touchDragEl.offsetWidth}px;opacity:0.85;pointer-events:none;z-index:500;border-radius:9px;box-shadow:0 8px 24px rgba(0,0,0,0.15);`;
    touchClone.style.top = touchDragEl.getBoundingClientRect().top + 'px';
    document.body.appendChild(touchClone);
    touchDragEl.classList.add('dragging');
  }
  function onTouchMove(e) {
    if (!touchClone) return;
    e.preventDefault();
    const t = e.touches[0];
    touchClone.style.top = (t.clientY - touchDragEl.offsetHeight / 2) + 'px';
    touchClone.style.display = 'none';
    const el = document.elementFromPoint(t.clientX, t.clientY);
    touchClone.style.display = '';
    const targetCard = el?.closest('.itin-card');
    document.querySelectorAll('.itin-card').forEach(c =>
      c.classList.remove('drag-over-top', 'drag-over-bottom')
    );
    if (targetCard && targetCard.dataset.id !== dragId) {
      const rect = targetCard.getBoundingClientRect();
      targetCard.classList.add(t.clientY < rect.top + rect.height / 2 ? 'drag-over-top' : 'drag-over-bottom');
    }
  }
  function onTouchEnd(e) {
    if (!touchClone) return;
    const t = e.changedTouches[0];
    touchClone.style.display = 'none';
    const el = document.elementFromPoint(t.clientX, t.clientY);
    touchClone.remove(); touchClone = null;
    touchDragEl.classList.remove('dragging');
    const targetCard = el?.closest('.itin-card');
    document.querySelectorAll('.itin-card').forEach(c =>
      c.classList.remove('drag-over-top', 'drag-over-bottom')
    );
    if (targetCard && targetCard.dataset.id !== dragId) {
      const rect = targetCard.getBoundingClientRect();
      const insertBefore = t.clientY < rect.top + rect.height / 2;
      const fromIdx = state.itineraryIds.indexOf(dragId);
      state.itineraryIds.splice(fromIdx, 1);
      const toIdx = insertBefore
        ? state.itineraryIds.indexOf(targetCard.dataset.id)
        : state.itineraryIds.indexOf(targetCard.dataset.id) + 1;
      state.itineraryIds.splice(toIdx, 0, dragId);
      syncItinIds();
      refreshItinTab();
    }
    dragId = null; touchDragEl = null;
  }

  return { allAvailablePlaces, getItinPlaces, isInItin, syncItinIds, addToItin, removeFromItin, refreshExploreButtons, updateDetailItinBtn, fmtMinutes, calculateItineraryRoute, refreshItinTab, renderItinerary };
}
