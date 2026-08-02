import fs from 'fs';

const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const DETAILS_URL = 'https://places.googleapis.com/v1/places';

const DETAILS_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'primaryType',
  'types',
  'businessStatus',
  'regularOpeningHours',
].join(',');

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.primaryType',
  'places.types',
  'places.googleMapsTypeLabel',
  'places.businessStatus',
].join(',');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalize(value) {
  return cleanString(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function loadCache(cachePath) {
  if (!cachePath) return {};
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch {
    return {};
  }
}

function saveCache(cachePath, cache) {
  if (!cachePath) return;
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
}

function toRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

function haversineMeters(a, b) {
  const earthRadius = 6371000;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLat = lat2 - lat1;
  const deltaLng = toRadians(b.lng) - toRadians(a.lng);
  const value = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function tokenScore(expected, actual) {
  const wanted = new Set(normalize(expected).split(' ').filter(token => token.length > 2));
  const present = new Set(normalize(actual).split(' '));
  if (!wanted.size) return 0;
  let matched = 0;
  for (const token of wanted) if (present.has(token)) matched += 1;
  return matched / wanted.size;
}

function placePoint(place) {
  const lat = Number(place?.location?.latitude);
  const lng = Number(place?.location?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function scorePlace(place, request) {
  const displayName = cleanString(place?.displayName?.text);
  const formattedAddress = cleanString(place?.formattedAddress);
  const nameScore = tokenScore(request.name, displayName) * 70;
  const addressScore = request.address ? tokenScore(request.address, formattedAddress) * 15 : 0;
  const localityScore = tokenScore(`${request.city} ${request.country}`, formattedAddress) * 15;
  const point = placePoint(place);
  let distancePenalty = 0;
  if (request.reference && point) {
    const km = haversineMeters(request.reference, point) / 1000;
    distancePenalty = Math.min(45, km * (request.kind === 'terminal' ? 0.7 : 2.2));
  }
  const statusPenalty = place?.businessStatus === 'CLOSED_PERMANENTLY' ? 35 : 0;
  return nameScore + addressScore + localityScore - distancePenalty - statusPenalty;
}

function buildTextQuery(request) {
  return [request.name, request.address, request.city, request.country].filter(Boolean).join(', ');
}

async function searchText(request, apiKey) {
  const body = {
    textQuery: buildTextQuery(request),
    pageSize: 5,
    languageCode: 'en',
  };
  if (request.reference) {
    body.locationBias = {
      circle: {
        center: {
          latitude: request.reference.lat,
          longitude: request.reference.lng,
        },
        radius: request.kind === 'terminal' ? 50000 : 25000,
      },
    };
  }

  const response = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Places returned ${response.status}: ${text.slice(0, 300)}`);
  }
  const data = await response.json();
  return Array.isArray(data.places) ? data.places : [];
}


function openingHoursText(place) {
  const descriptions = place?.regularOpeningHours?.weekdayDescriptions;
  return Array.isArray(descriptions)
    ? descriptions.filter(value => typeof value === 'string' && value.trim()).join(' · ')
    : '';
}

async function placeDetails(placeId, apiKey) {
  if (!cleanString(placeId)) return null;
  const response = await fetch(`${DETAILS_URL}/${encodeURIComponent(placeId)}`, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': DETAILS_FIELD_MASK,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Place Details returned ${response.status}: ${text.slice(0, 300)}`);
  }
  return response.json();
}

function publicMatch(place, score, query) {
  const point = placePoint(place);
  return {
    googlePlaceId: cleanString(place?.id),
    googleDisplayName: cleanString(place?.displayName?.text),
    googleFormattedAddress: cleanString(place?.formattedAddress),
    googlePrimaryType: cleanString(place?.primaryType),
    googleBusinessStatus: cleanString(place?.businessStatus),
    googleOpeningHours: openingHoursText(place),
    googleLocation: point,
    googleMatchConfidence: score >= 82 ? 'high' : 'medium',
    googleMatchScore: Math.round(score),
    googleQuery: query,
  };
}

export async function resolveGooglePlace(request, options = {}) {
  const apiKey = cleanString(options.apiKey);
  if (!apiKey || !cleanString(request?.name)) return null;

  const cache = options.cache || loadCache(options.cachePath);
  const cacheKey = cleanString(options.cacheKey) || normalize(JSON.stringify({
    name: request.name,
    address: request.address,
    city: request.city,
    country: request.country,
    kind: request.kind,
  }));
  const cached = cache[cacheKey];
  if (cached?.googlePlaceId && !options.force && !options.requireDetails) {
    return {
      googlePlaceId: cached.googlePlaceId,
      googleMatchConfidence: 'cached',
      googleQuery: buildTextQuery(request),
    };
  }
  if (cached?.googlePlaceId && !options.force && options.requireDetails) {
    const places = await searchText({ ...request, name: cached.queryName || request.name }, apiKey);
    const exact = places.find(place => place.id === cached.googlePlaceId);
    if (exact) {
      const score = scorePlace(exact, request);
      return publicMatch(exact, score, buildTextQuery(request));
    }
  }

  const places = await searchText(request, apiKey);
  let best = null;
  for (const place of places) {
    const score = scorePlace(place, request);
    if (!best || score > best.score) best = { place, score };
  }
  if (!best || best.score < 55 || !best.place.id) {
    cache[cacheKey] = { googlePlaceId: '', queryName: request.name, resolvedAt: new Date().toISOString() };
    saveCache(options.cachePath, cache);
    return null;
  }

  cache[cacheKey] = {
    googlePlaceId: best.place.id,
    queryName: request.name,
    resolvedAt: new Date().toISOString(),
  };
  saveCache(options.cachePath, cache);
  return publicMatch(best.place, best.score, buildTextQuery(request));
}

function portReference(portInfo, catalog) {
  const fallback = catalog.portAnchor || catalog.port || portInfo;
  const lat = Number(fallback.lat);
  const lng = Number(fallback.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const output = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, run));
  return output;
}

function terminalFromPlace(place) {
  const point = placePoint(place);
  if (!point || !cleanString(place?.id)) return null;
  return {
    id: `google-terminal-${place.id}`,
    sourceId: `google-terminal-${place.id}`,
    name: cleanString(place?.displayName?.text, 'Cruise terminal'),
    lat: point.lat,
    lng: point.lng,
    address: cleanString(place?.formattedAddress),
    terminalType: 'passenger_cruise_terminal',
    verified: true,
    source: 'google_places_terminal_search',
    sourceUrls: [],
    coordinateSource: 'google_places',
    googlePlaceId: cleanString(place?.id),
    googlePlaceMatchConfidence: 'high',
    googlePrimaryType: cleanString(place?.primaryType),
    googleTypes: Array.isArray(place?.types) ? place.types.filter(type => typeof type === 'string') : [],
    googleMapsTypeLabel: cleanString(place?.googleMapsTypeLabel?.text),
  };
}

export async function discoverGoogleCruiseTerminals(portInfo, catalog, options = {}) {
  const apiKey = cleanString(options.apiKey);
  const reference = portReference(portInfo, catalog);
  if (!apiKey || !reference) return [];

  const cache = loadCache(options.cachePath);
  const cacheKey = `terminal-discovery:${portInfo.id}`;
  const cached = cache[cacheKey];
  if (Array.isArray(cached?.terminals) && cached.terminals.length && !options.force) {
    return cached.terminals;
  }

  const fallback = catalog.portAnchor || catalog.port || portInfo;
  const portName = cleanString(fallback.name || fallback.terminal || portInfo.terminal || portInfo.address);
  const textQuery = [portName, portInfo.city, portInfo.country, 'cruise terminals'].filter(Boolean).join(', ');
  const body = {
    textQuery,
    pageSize: 20,
    languageCode: options.languageCode || 'en',
    locationBias: {
      circle: {
        center: { latitude: reference.lat, longitude: reference.lng },
        radius: options.radiusMeters || 10000,
      },
    },
  };

  const response = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google terminal discovery returned ${response.status}: ${text.slice(0, 300)}`);
  }

  const data = await response.json();
  const places = Array.isArray(data.places) ? data.places : [];
  const radiusMeters = options.radiusMeters || 10000;
  const typed = places.filter(place => {
    const types = Array.isArray(place?.types) ? place.types : [];
    const typeLabel = normalize(place?.googleMapsTypeLabel?.text);
    return place?.primaryType === 'cruise_terminal'
      || types.includes('cruise_terminal')
      || typeLabel === 'cruise terminal';
  });
  const candidates = typed.length ? typed : places;
  const terminals = [];
  const seen = new Set();
  for (const place of candidates) {
    const terminal = terminalFromPlace(place);
    if (!terminal || seen.has(terminal.googlePlaceId)) continue;
    if (haversineMeters(reference, terminal) > radiusMeters) continue;
    seen.add(terminal.googlePlaceId);
    terminals.push(terminal);
  }

  terminals.sort((a, b) => haversineMeters(reference, a) - haversineMeters(reference, b));
  cache[cacheKey] = { terminals, query: textQuery, resolvedAt: new Date().toISOString() };
  saveCache(options.cachePath, cache);
  return terminals;
}

export async function resolveCatalogGooglePlaces(portInfo, catalog, options = {}) {
  const apiKey = cleanString(options.apiKey);
  if (!apiKey) return { pois: {}, terminals: {} };
  const cache = loadCache(options.cachePath);
  const reference = portReference(portInfo, catalog);
  const pois = {};
  const terminals = {};

  await mapWithConcurrency(catalog.pois || [], options.concurrency || 3, async poi => {
    const sourceId = cleanString(poi.sourceId || poi.id);
    if (!sourceId || !cleanString(poi.name)) return;
    try {
      const match = await resolveGooglePlace({
        name: poi.nameEnglish || poi.name,
        address: poi.address || '',
        city: portInfo.city,
        country: portInfo.country,
        reference: Number.isFinite(Number(poi.lat)) && Number.isFinite(Number(poi.lng))
          ? { lat: Number(poi.lat), lng: Number(poi.lng) }
          : reference,
        kind: 'poi',
      }, {
        apiKey,
        cache,
        cachePath: options.cachePath,
        cacheKey: `poi:${sourceId}`,
        force: options.force,
      });
      if (match) pois[sourceId] = match;
    } catch (error) {
      console.warn(`Google Places lookup failed for ${poi.name}: ${error.message}`);
    }
  });


  return { pois, terminals };
}

export async function resolveCurationGooglePlaces(portInfo, catalog, curation, options = {}) {
  const result = structuredClone(curation || {});
  const apiKey = cleanString(options.apiKey);
  if (!apiKey) return result;
  const cache = loadCache(options.cachePath);
  const reference = portReference(portInfo, catalog);
  const catalogMatches = options.catalogMatches || { pois: {} };

  const selectedIds = new Set([
    ...(Array.isArray(result.places) ? result.places : []),
    ...(Array.isArray(result.hiddenGems) ? result.hiddenGems : []),
  ].map(item => cleanString(item?.sourceId)).filter(Boolean));

  await mapWithConcurrency([...selectedIds], options.concurrency || 4, async sourceId => {
    const match = catalogMatches.pois?.[sourceId];
    if (!match?.googlePlaceId) return;
    try {
      const details = await placeDetails(match.googlePlaceId, apiKey);
      if (!details) return;
      catalogMatches.pois[sourceId] = {
        ...match,
        ...publicMatch(details, Number(match.googleMatchScore) || 100, match.googleQuery || ''),
      };
    } catch (error) {
      console.warn(`Google Place Details failed for ${sourceId}: ${error.message}`);
    }
  });

  const isPermanentlyClosed = item => {
    const sourceId = cleanString(item?.sourceId);
    return catalogMatches.pois?.[sourceId]?.googleBusinessStatus === 'CLOSED_PERMANENTLY';
  };
  result.places = (Array.isArray(result.places) ? result.places : []).filter(item => !isPermanentlyClosed(item));
  result.hiddenGems = (Array.isArray(result.hiddenGems) ? result.hiddenGems : []).filter(item => !isPermanentlyClosed(item));

  const supplements = Array.isArray(result.supplementedPois) ? result.supplementedPois : [];
  const resolvedSupplements = [];
  for (const poi of supplements) {
    const request = {
      name: cleanString(poi.name),
      address: cleanString(poi.address),
      city: portInfo.city,
      country: portInfo.country,
      reference,
      kind: 'poi',
    };
    let match = null;
    try {
      match = await resolveGooglePlace(request, {
        apiKey,
        cache,
        cachePath: options.cachePath,
        cacheKey: `supplement:${cleanString(poi.sourceId) || normalize(JSON.stringify(request))}`,
        requireDetails: true,
      });
      if (match?.googlePlaceId) {
        const details = await placeDetails(match.googlePlaceId, apiKey);
        match = { ...match, ...publicMatch(details, match.googleMatchScore || 100, match.googleQuery || '') };
      }
    } catch (error) {
      console.warn(`Google supplement lookup failed for ${request.name}: ${error.message}`);
    }
    if (!match?.googleLocation || match.googleBusinessStatus === 'CLOSED_PERMANENTLY') {
      console.warn(`Skipping unresolved supplemental POI: ${request.name}`);
      continue;
    }
    resolvedSupplements.push({
      ...poi,
      ...match,
      lat: match.googleLocation.lat,
      lng: match.googleLocation.lng,
      address: cleanString(poi.address) || match.googleFormattedAddress,
      hoursNote: cleanString(poi.hoursNote) || match.googleOpeningHours,
      coordinateSource: 'google_places',
    });
  }
  result.supplementedPois = resolvedSupplements;
  return result;
}

