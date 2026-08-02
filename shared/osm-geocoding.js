import fs from 'fs';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
let lastRequestAt = 0;

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

function flattenCoordinates(value, output = []) {
  if (!Array.isArray(value)) return output;
  if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
    output.push({ lng: Number(value[0]), lat: Number(value[1]) });
    return output;
  }
  for (const item of value) flattenCoordinates(item, output);
  return output;
}

function practicalPoint(result, reference) {
  const fallback = { lat: Number(result.lat), lng: Number(result.lon) };
  if (!reference || !result.geojson?.coordinates) return fallback;
  const points = flattenCoordinates(result.geojson.coordinates);
  if (!points.length) return fallback;

  let nearest = points[0];
  let distance = haversineMeters(reference, nearest);
  for (const point of points.slice(1)) {
    const candidate = haversineMeters(reference, point);
    if (candidate < distance) {
      nearest = point;
      distance = candidate;
    }
  }
  return nearest;
}

function tokenScore(expected, actual) {
  const wanted = new Set(normalize(expected).split(' ').filter(token => token.length > 2));
  const present = new Set(normalize(actual).split(' '));
  if (!wanted.size) return 0;
  let matched = 0;
  for (const token of wanted) if (present.has(token)) matched += 1;
  return matched / wanted.size;
}

function resultScore(result, request, reference) {
  const display = `${result.display_name || ''} ${result.namedetails?.name || ''}`;
  const nameScore = tokenScore(request.name, display) * 60;
  const placeScore = tokenScore(`${request.city} ${request.country}`, display) * 20;
  const importance = Number(result.importance || 0) * 10;
  const point = practicalPoint(result, reference);
  const distanceKm = reference ? haversineMeters(reference, point) / 1000 : 0;
  const distancePenalty = reference ? Math.min(25, distanceKm / 8) : 0;
  const typeBonus = ['attraction', 'tourism', 'amenity', 'building', 'place', 'leisure', 'highway', 'man_made'].includes(result.class) ? 5 : 0;
  return nameScore + placeScore + importance + typeBonus - distancePenalty;
}

async function waitForRateLimit() {
  const waitMs = Math.max(0, 1100 - (Date.now() - lastRequestAt));
  if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
  lastRequestAt = Date.now();
}

async function searchNominatim(query, userAgent) {
  await waitForRateLimit();
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    addressdetails: '1',
    namedetails: '1',
    extratags: '1',
    polygon_geojson: '1',
    limit: '5',
  });
  const response = await fetch(`${NOMINATIM_URL}?${params}`, {
    headers: {
      'User-Agent': userAgent,
      'Accept-Language': 'en',
    },
  });
  if (!response.ok) throw new Error(`Nominatim returned ${response.status}`);
  return response.json();
}

function buildQueries(request) {
  const exact = [request.name, request.address, request.city, request.country].filter(Boolean).join(', ');
  const hinted = [request.name, request.locationHint, request.city, request.country].filter(Boolean).join(', ');
  const simple = [request.name, request.city, request.country].filter(Boolean).join(', ');
  return [...new Set([exact, hinted, simple].filter(Boolean))];
}

async function geocodeOne(request, options) {
  const reference = options.reference;
  const cacheKey = normalize(JSON.stringify(request));
  if (Object.prototype.hasOwnProperty.call(options.cache, cacheKey)) {
    return options.cache[cacheKey];
  }

  let best = null;
  for (const query of buildQueries(request)) {
    let results = [];
    try {
      results = await searchNominatim(query, options.userAgent);
    } catch (error) {
      console.warn(`OSM geocoding failed for ${request.name}: ${error.message}`);
      break;
    }
    for (const result of results) {
      const score = resultScore(result, request, reference);
      if (!best || score > best.score) best = { result, score, query };
    }
    if (best?.score >= 70) break;
  }

  if (!best || best.score < 42) {
    options.cache[cacheKey] = null;
    saveCache(options.cachePath, options.cache);
    return null;
  }

  const point = practicalPoint(best.result, reference);
  const resolved = {
    lat: point.lat,
    lng: point.lng,
    address: cleanString(best.result.display_name),
    coordinateSource: 'openstreetmap_nominatim',
    osmType: cleanString(best.result.osm_type),
    osmId: best.result.osm_id == null ? '' : String(best.result.osm_id),
    geocodeConfidence: best.score >= 70 ? 'high' : 'medium',
    geocodeQuery: best.query,
  };
  options.cache[cacheKey] = resolved;
  saveCache(options.cachePath, options.cache);
  return resolved;
}

function catalogTerminalById(catalog) {
  return new Map((catalog.terminals || []).map(item => [item.id || item.sourceId, item]));
}

export async function resolveCurationLocations(portInfo, catalog, curation, options = {}) {
  const result = structuredClone(curation || {});
  const fallback = catalog.portAnchor || catalog.port || portInfo;
  const reference = {
    lat: Number(fallback.lat),
    lng: Number(fallback.lng),
  };
  const cache = loadCache(options.cachePath);
  const settings = {
    reference: Number.isFinite(reference.lat) && Number.isFinite(reference.lng) ? reference : null,
    cache,
    cachePath: options.cachePath,
    userAgent: options.userAgent || 'Portlore/1.0 (cruise guide geocoding)',
  };

  const suppliedTerminals = catalogTerminalById(catalog);
  const terminalItems = Array.isArray(result.terminalReview?.terminals) ? result.terminalReview.terminals : [];
  const resolvedTerminals = [];

  for (const terminal of terminalItems) {
    const sourceId = cleanString(terminal?.sourceId || terminal?.id);
    const original = suppliedTerminals.get(sourceId);
    const request = {
      name: cleanString(terminal?.name || original?.name),
      address: cleanString(terminal?.address || original?.address),
      locationHint: cleanString(terminal?.locationHint || 'cruise passenger terminal entrance'),
      city: cleanString(portInfo.city),
      country: cleanString(portInfo.country),
    };
    const resolved = request.name ? await geocodeOne(request, settings) : null;

    if (resolved) {
      resolvedTerminals.push({ ...terminal, ...resolved });
    } else if (original) {
      resolvedTerminals.push({
        ...terminal,
        lat: original.lat,
        lng: original.lng,
        address: cleanString(terminal?.address || original.address),
        coordinateSource: 'supplied_terminal',
        geocodeConfidence: 'fallback',
      });
    }
  }

  if (result.terminalReview && typeof result.terminalReview === 'object') {
    result.terminalReview.terminals = resolvedTerminals;
  }

  const supplements = Array.isArray(result.supplementedPois) ? result.supplementedPois : [];
  const resolvedSupplements = [];
  for (const poi of supplements) {
    const request = {
      name: cleanString(poi?.name),
      address: cleanString(poi?.address),
      locationHint: cleanString(poi?.locationHint),
      city: cleanString(portInfo.city),
      country: cleanString(portInfo.country),
    };
    const resolved = request.name ? await geocodeOne(request, settings) : null;
    if (!resolved) {
      console.warn(`Skipping unresolved supplemental POI: ${request.name}`);
      continue;
    }
    resolvedSupplements.push({ ...poi, ...resolved });
  }
  result.supplementedPois = resolvedSupplements;

  return result;
}
