import { inferStopCategory, defaultVisitMinutes, walkMinutes } from './places.js';
import { lineIconSvg, placeLineIcon } from './icons.js';
import { API_ORIGIN } from './platform.js';

export function createMaps(state, { syncSystemBars, selectPort, switchPortFromMap, terminalKey, setActiveTerminal, enrich, googleMapsSearchUrl, googleMapsDirectionsUrl, openDetail, getItinPlaces, isInItin, addToItin, removeFromItin }) {
  const searchTokens = { desktop: 0, mobile: 0 };
  // Ports are drawn on one canvas per map so hundreds of them pan smoothly on phones; the wider tolerance keeps the
  // small dots easy to tap.
  function portDot(port, map) {
    map.portCanvas = map.portCanvas || L.canvas({ tolerance: 8 });
    return L.circleMarker([port.lat, port.lng], {
      renderer: map.portCanvas,
      radius: port.generated ? 6.5 : 5,
      color: '#fff',
      weight: 2,
      fillColor: port.generated ? '#1a4a7a' : '#7f9aaa',
      fillOpacity: 1,
    });
  }
  function openHomePortMap() {
    const overlay = document.getElementById('port-map-overlay');
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    syncSystemBars();
    if (!state.homeMapReady) initHomePortMap();
    setTimeout(() => state.homeMap?.invalidateSize(), 80);
  }
  function closeHomePortMap() {
    const overlay = document.getElementById('port-map-overlay');
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    syncSystemBars();
  }
  function initHomePortMap() {
    if (state.homeMapReady || !state.ports.length) return;
    state.homeMapReady = true;
    state.homeMap = L.map('home-port-map', { worldCopyJump: true }).setView([25, -20], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 18 }).addTo(state.homeMap);

    state.ports.forEach(port => {
      const popup = document.createElement('div');
      popup.className = 'port-popup';
      popup.innerHTML = `<strong>${port.city}</strong><div class="port-popup-meta">${port.terminal}, ${port.country}</div><div class="port-popup-actions"><button class="port-popup-select">Choose this port</button></div>`;
      popup.querySelector('.port-popup-select').addEventListener('click', () => {
        selectPort(port);
        closeHomePortMap();
      });
      const marker = portDot(port, state.homeMap).addTo(state.homeMap).bindPopup(popup);
      state.homePortMarkers.push(marker);
    });

    if (state.userLat !== null) {
      L.marker([state.userLat, state.userLng], { icon: youPin() }).addTo(state.homeMap).bindPopup('Your location');
      state.homeMap.setView([state.userLat, state.userLng], 4);
    }
  }
  document.getElementById('w-map-open').addEventListener('click', openHomePortMap);
  document.getElementById('port-map-close').addEventListener('click', closeHomePortMap);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeHomePortMap(); });


  function resetExploreMaps() {
    searchTokens.desktop++;
    searchTokens.mobile++;
    nearbySearchMarkers = { desktop: [], mobile: [] };
    for (const map of [state.dMap, state.mMap]) {
      if (!map) continue;
      // Leaflet 1.9.4 leaves its zoom-completion timer running after remove().
      map._animatingZoom = false;
      map.remove();
    }
    state.dMap = null; state.mMap = null;
    state.dReady = false; state.mReady = false;
    state.dMarkers = {}; state.mMarkers = {};
    state.selectedMapPlaceId = null;
    state.dUserPin = null; state.mUserPin = null;
  }

  function makePin(emoji,bg,size=28){return L.divIcon({className:'',html:`<div style="background:${bg};border-radius:50%;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-size:${Math.round(size*0.6)}px;box-shadow:0 2px 6px rgba(0,0,0,0.2);border:2px solid white">${emoji}</div>`,iconSize:[size,size],iconAnchor:[size/2,size/2]});}
  function makePlacePin(place, selected=false, hovered=false){
    const order=state.itinIds.indexOf(place.id);
    const isGem=(state.city?.hiddenGems||[]).some(gem=>gem.id===place.id);
    const size=selected?36:(hovered?34:30);
    const kinds=[inferStopCategory(place)==='food_drink'?'food':'',isGem?'gem':'',order>=0?'planned':''].filter(Boolean).join(' ');
    const inner=order>=0?String(order+1):placeLineIcon(place);
    return L.divIcon({className:'',html:`<div class="place-map-pin${selected?' selected':''}"><div class="place-map-pin-bubble ${kinds}" style="width:${size}px;height:${size}px">${inner}</div></div>`,iconSize:[size,size],iconAnchor:[size/2,size/2]});
  }
  function makePulsePin(emoji){return L.divIcon({className:'',html:`<div style="background:var(--navy);border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 0 0 5px rgba(26,74,122,0.2),0 2px 8px rgba(0,0,0,0.25);border:2px solid white">${emoji}</div>`,iconSize:[34,34],iconAnchor:[17,17]});}
  function youPin(){return L.divIcon({className:'',html:`<div style="background:#2563eb;border:3px solid white;border-radius:50%;width:13px;height:13px;box-shadow:0 0 0 4px rgba(37,99,235,0.2)"></div>`,iconSize:[13,13],iconAnchor:[6,6]});}


  function openPortDirections(port) {
    window.open(googleMapsDirectionsUrl(port), '_blank');
  }


  let nearbySearchMarkers = { desktop: [], mobile: [] };
  function clearNearbyMarkers(kind) {
    const map = kind === 'desktop' ? state.dMap : state.mMap;
    nearbySearchMarkers[kind].forEach(marker => { if (map) map.removeLayer(marker); });
    nearbySearchMarkers[kind] = [];
  }
  function searchPin(selected=false) {
    const size=selected?40:34;
    return L.divIcon({
      className:'',
      html:`<div class="search-map-pin${selected?' selected':''}" style="width:${size}px;height:${size+7}px"><div class="search-pin" style="width:${size}px;height:${size}px"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 5 5"></path></svg></div></div>`,
      iconSize:[size,size+7],
      iconAnchor:[size/2,size+6]
    });
  }
  function defaultSearchMeta(place) { return place.category ? place.category.replaceAll('_',' ') : 'Nearby place'; }
  function addSearchMarkers(map, kind, results) {
    clearNearbyMarkers(kind);
    results.forEach(place => {
      const popup = document.createElement('div');
      popup.className = 'port-popup';
      popup.innerHTML = `<strong>${place.name}</strong><div class="port-popup-meta">${place.address || defaultSearchMeta(place)}</div><span class="search-popup-tag">Found nearby</span><div class="port-popup-actions"><button class="port-popup-select">${isInItin(place.id) ? 'Remove from my day' : 'Add to my day'}</button><button class="port-popup-nav">Open in Maps</button></div>`;
      popup.querySelector('.port-popup-select').addEventListener('click', event => {
        if (isInItin(place.id)) removeFromItin(place.id); else addToItin(place.id);
        event.target.textContent = isInItin(place.id) ? 'Remove from my day' : 'Add to my day';
      });
      popup.querySelector('.port-popup-nav').addEventListener('click', () => window.open(googleMapsSearchUrl(place), '_blank'));
      const marker = L.marker([place.lat, place.lng], { icon:searchPin() }).addTo(map).bindPopup(popup);
      marker.on('popupopen', () => marker.setIcon(searchPin(true)));
      marker.on('popupclose', () => marker.setIcon(searchPin(false)));
      nearbySearchMarkers[kind].push(marker);
    });
    if (results.length) {
      const bounds = L.latLngBounds(results.map(result => [result.lat, result.lng]));
      bounds.extend([state.city.port.lat, state.city.port.lng]);
      map.fitBounds(bounds.pad(.15), { maxZoom:16 });
    }
  }
  async function runNearbySearch(kind) {
    const input = document.getElementById(`${kind}-nearby-input`);
    const status = document.getElementById(`${kind}-nearby-status`);
    const query = input.value.trim();
    if (query.length < 2 || !state.city?.port) return;
    const token = ++searchTokens[kind];
    const city = state.city;
    const terminal = terminalKey(city.port);
    const current = () => token === searchTokens[kind] && state.city === city && terminalKey(city.port) === terminal;
    status.textContent = 'Searching near the selected terminal...';
    try {
      const response = await fetch(`${API_ORIGIN}/api/nearby?q=${encodeURIComponent(query)}&lat=${state.city.port.lat}&lng=${state.city.port.lng}`);
      const data = await response.json();
      if (!current()) return;
      if (!response.ok) throw new Error(data.error || 'Search failed');
      state.searchedPlaces = data.results.map(place => ({ ...place, subtitle:defaultSearchMeta(place), description:place.address, icon:'📍', goodFor:['found nearby'], suggestedVisitMinutes:defaultVisitMinutes(place) }));
      const map = kind === 'desktop' ? state.dMap : state.mMap;
      if (map) addSearchMarkers(map, kind, state.searchedPlaces);
      status.textContent = state.searchedPlaces.length ? `${state.searchedPlaces.length} place${state.searchedPlaces.length === 1 ? '' : 's'} shown on the map` : 'No nearby matches found';
    } catch (error) { if (current()) status.textContent = error.message; }
  }
  document.querySelectorAll('[data-nearby-search]').forEach(button => button.addEventListener('click', () => runNearbySearch(button.dataset.nearbySearch)));
  ['mobile','desktop'].forEach(kind => document.getElementById(`${kind}-nearby-input`).addEventListener('keydown', event => { if (event.key === 'Enter') runNearbySearch(kind); }));
  function addPins(map,markers){
    const terminals = state.city.terminals;
    terminals.forEach((terminal, index) => {
      const label = terminal.name || state.city.port.name || 'Cruise terminal';
      const isActive = terminalKey(terminal) === terminalKey(state.city.port);
      const popup = document.createElement('div');
      popup.className = 'port-popup';
      popup.innerHTML = `<strong>${label}</strong><div class="port-popup-meta">${isActive ? 'Selected terminal' : 'Cruise terminal'}</div><div class="port-popup-actions">${isActive ? '' : '<button class="port-popup-select">Use this terminal</button>'}<button class="port-popup-nav">Directions</button></div>`;
      popup.querySelector('.port-popup-select')?.addEventListener('click', () => setActiveTerminal(terminal));
      popup.querySelector('.port-popup-nav').addEventListener('click', () => {
        window.open(googleMapsDirectionsUrl(terminal), '_blank');
      });
      L.marker([terminal.lat,terminal.lng],{icon:L.divIcon({className:'',html:`<div class="ship-label${isActive?'':' other'}">${lineIconSvg('ship')}${isActive?'Your ship':label}</div>`,iconSize:null,iconAnchor:[-6,14]}),zIndexOffset:1000}).addTo(map).bindPopup(popup);
    });
    state.ports.filter(p => p.id !== state.selectedPort?.id && p.id !== state.city.id).forEach(port => {
      const popup = document.createElement('div');
      popup.className = 'port-popup';
      popup.innerHTML = `<strong>${port.city}</strong><div class="port-popup-meta">${port.terminal}, ${port.country}</div><div class="port-popup-actions"><button class="port-popup-select">Explore port</button><button class="port-popup-nav">Directions</button></div>`;
      popup.querySelector('.port-popup-select').addEventListener('click', () => switchPortFromMap(port));
      popup.querySelector('.port-popup-nav').addEventListener('click', () => openPortDirections(port));
      portDot(port, map).addTo(map).bindPopup(popup);
    });
    const places=enrich([...(state.city.places || []), ...(state.city.hiddenGems || [])]);
    const group=L.markerClusterGroup?L.markerClusterGroup({maxClusterRadius:28,disableClusteringAtZoom:16,showCoverageOnHover:false,iconCreateFunction:cluster=>L.divIcon({className:'',html:`<div class="pin-cluster">${cluster.getChildCount()}</div>`,iconSize:[34,34]})}):map;
    if(group!==map)map.addLayer(group);
    map._pinGroup=group;
    places.forEach(p=>{
      const m=L.marker([p.lat,p.lng],{icon:makePlacePin(p,state.selectedMapPlaceId===p.id),bubblingMouseEvents:false,zIndexOffset:state.itinIds.includes(p.id)?900:0}).addTo(state.itinIds.includes(p.id)?map:group).on('click',()=>{
        state.selectedMapPlaceId=p.id;
        refreshSelectedMapPins();
        openDetail(p);
      });
      markers[p.id]=m;
    });
    const kind = map === state.dMap ? 'desktop' : 'mobile';
    if (state.searchedPlaces.length) addSearchMarkers(map, kind, state.searchedPlaces);
  }
  function clearSelectedMapPlace(){
    if(!state.selectedMapPlaceId)return;
    state.selectedMapPlaceId=null;
    refreshSelectedMapPins();
  }
  function drawPlanLine(map){
    if(!map||!state.city)return;
    map._planLine?.remove();
    const origin=state.city.centre||state.city.port;
    const stops=getItinPlaces();
    if(!stops.length)return;
    // Follow the streets once the walking route for these exact stops has arrived.
    const routed=state.itineraryRoute?.path&&state.itineraryRoute.legs?.length===stops.length+1;
    const points=routed?state.itineraryRoute.path:[[origin.lat,origin.lng],...stops.map(p=>[p.lat,p.lng]),[origin.lat,origin.lng]];
    map._planLine=L.layerGroup([
      L.polyline(points,{color:'#fff',weight:8,opacity:0.9,lineCap:'round',lineJoin:'round',interactive:false}),
      L.polyline(points,{color:'#0f2340',weight:4,dashArray:routed?null:'6 8',lineCap:'round',lineJoin:'round',interactive:false}),
    ]).addTo(map);
  }
  function refreshSelectedMapPins(){
    drawPlanLine(state.dMap);drawPlanLine(state.mMap);
    const allPlaces=[...(state.city?.places||[]),...(state.city?.hiddenGems||[])];
    [[state.dMap,state.dMarkers],[state.mMap,state.mMarkers]].forEach(([map,markerSet])=>Object.entries(markerSet).forEach(([id,marker])=>{
      const place=allPlaces.find(item=>item.id===id);
      if(!place)return;
      marker.setIcon(makePlacePin(place,state.selectedMapPlaceId===id));
      // Planned stops stay out of the clusters so their numbers are always visible.
      const group=map?._pinGroup;
      if(!group||group===map)return;
      const planned=state.itinIds.includes(id);
      marker.setZIndexOffset(planned?900:0);
      if(planned&&group.hasLayer(marker)){group.removeLayer(marker);map.addLayer(marker);}
      else if(!planned&&!group.hasLayer(marker)){map.removeLayer(marker);group.addLayer(marker);}
    }));
  }
  function fitStops(map){
    const origin=state.city.centre||state.city.port;
    const stops=enrich([...(state.city.places||[]),...(state.city.hiddenGems||[])]).filter(p=>walkMinutes(p)<=15);
    const bounds=L.latLngBounds([[origin.lat,origin.lng],...stops.map(p=>[p.lat,p.lng])]);
    map.fitBounds(bounds,{padding:[24,24],maxZoom:17});
    drawPlanLine(map);
  }
  function initDesktopMap(){if(state.dReady||!state.city)return;state.dReady=true;state.dMap=L.map('dp-map',{zoomControl:false,scrollWheelZoom:true}).setView([state.city.port.lat,state.city.port.lng],14);L.control.zoom({position:'bottomright'}).addTo(state.dMap);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap',maxZoom:19}).addTo(state.dMap);addPins(state.dMap,state.dMarkers);fitStops(state.dMap);state.dMap.on('click',clearSelectedMapPlace);if(state.userLat!==null)state.dUserPin=L.marker([state.userLat,state.userLng],{icon:youPin()}).addTo(state.dMap);}
  function initMobileMap(){if(state.mReady||!state.city)return;state.mReady=true;state.mMap=L.map('map-container',{zoomControl:false}).setView([state.city.port.lat,state.city.port.lng],14);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap',maxZoom:19}).addTo(state.mMap);addPins(state.mMap,state.mMarkers);state.mMap.on('click',clearSelectedMapPlace);if(state.userLat!==null)state.mUserPin=L.marker([state.userLat,state.userLng],{icon:youPin()}).addTo(state.mMap);const map=state.mMap;setTimeout(()=>{if(state.mMap!==map)return;map.invalidateSize();fitStops(map);},80);}
  function updateUserPins(){[[state.dMap,'d'],[state.mMap,'m']].forEach(([map,k])=>{if(!map||state.userLat===null)return;const cur=k==='d'?state.dUserPin:state.mUserPin;if(cur)map.removeLayer(cur);const pin=L.marker([state.userLat,state.userLng],{icon:youPin()}).addTo(map);if(k==='d')state.dUserPin=pin;else state.mUserPin=pin;});}
  function highlightPins(){refreshSelectedMapPins();}
  function pulsePin(id){const m=state.dMarkers[id];if(!m)return;const p=(state.city.places || []).find(x=>x.id===id)||(state.city.hiddenGems || []).find(x=>x.id===id);if(p)m.setIcon(makePlacePin(p,state.selectedMapPlaceId===id,true));}
  function unpulsePin(id){const m=state.dMarkers[id];if(!m)return;const p=[...(state.city.places||[]),...(state.city.hiddenGems||[])].find(x=>x.id===id);if(!p)return;m.setIcon(makePlacePin(p,state.selectedMapPlaceId===id));}

  return { openHomePortMap, closeHomePortMap, resetExploreMaps, initDesktopMap, initMobileMap, updateUserPins, highlightPins, pulsePin, unpulsePin, clearSelectedMapPlace, drawPlanLine, runNearbySearch };
}
