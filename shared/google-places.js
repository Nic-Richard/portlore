import fs from 'fs';
import { stopCategory } from './poi-curation.js';

const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.primaryType',
  'places.types',
  'places.businessStatus',
].join(',');

// Google's terms allow keeping place IDs but not the other Places fields, so only a place Google had no match for
// is skipped on later builds, for a year.
const NO_MATCH_REUSE_DAYS = 365;
let searchCount = 0;
let quotaRefused = false;

export function googleSearchCount() {
  return searchCount;
}

// Lookups that fail are skipped, so a guide built after the daily quota runs out is missing its checks.
export function googleQuotaRefused() {
  return quotaRefused;
}

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

// Names written by the model often add words Google leaves out ("San Gervasio Mayan Archaeological Site"
// for "San Gervasio"), so a Google name found whole inside the request counts as a full match.
function nameScore(expected, actual) {
  const googleTokens = normalize(actual).split(' ').filter(token => token.length > 2);
  const requestTokens = new Set(normalize(expected).split(' '));
  const contained = googleTokens.length > 0 && googleTokens.every(token => requestTokens.has(token));
  return contained ? 1 : tokenScore(expected, actual);
}

function placePoint(place) {
  const lat = Number(place?.location?.latitude);
  const lng = Number(place?.location?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

// "Roman Forum (Foro Romano)" should match "Roman Forum" or "Foro Romano", not only the full string.
function nameVariants(value) {
  const text = cleanString(value);
  const outside = text.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const inside = [...text.matchAll(/\(([^)]*)\)/g)].map(match => match[1].trim());
  return [...new Set([text, outside, ...inside].filter(Boolean))];
}

function bestTokenScore(values, target) {
  return Math.max(0, ...values.map(value => tokenScore(value, target)));
}

function scorePlace(place, request) {
  const displayName = cleanString(place?.displayName?.text);
  const formattedAddress = cleanString(place?.formattedAddress);
  const namePoints = Math.max(0, ...nameVariants(request.name).map(value => nameScore(value, displayName))) * 70;
  const addressScore = request.address ? tokenScore(request.address, formattedAddress) * 15 : 0;
  const localityScore = bestTokenScore(nameVariants(request.city).map(city => `${city} ${request.country}`), formattedAddress) * 15;
  const point = placePoint(place);
  let distancePenalty = 0;
  if (request.reference && point) {
    const km = haversineMeters(request.reference, point) / 1000;
    // Places the model adds have no location of their own yet, so distance from the port says little.
    distancePenalty = request.kind === 'supplement' ? Math.min(20, km) : Math.min(45, km * (request.kind === 'terminal' ? 0.7 : 2.2));
  }
  const statusPenalty = place?.businessStatus === 'CLOSED_PERMANENTLY' ? 35 : 0;
  return namePoints + addressScore + localityScore - distancePenalty - statusPenalty;
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

  searchCount += 1;
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
    if (response.status === 429) quotaRefused = true;
    const text = await response.text();
    throw new Error(`Google Places returned ${response.status}: ${text.slice(0, 300)}`);
  }
  const data = await response.json();
  return Array.isArray(data.places) ? data.places : [];
}


function publicMatch(place, score, query) {
  const point = placePoint(place);
  return {
    googlePlaceId: cleanString(place?.id),
    googleDisplayName: cleanString(place?.displayName?.text),
    googleFormattedAddress: cleanString(place?.formattedAddress),
    googlePrimaryType: cleanString(place?.primaryType),
    googleTypes: Array.isArray(place?.types) ? place.types : [],
    googleBusinessStatus: cleanString(place?.businessStatus),
    googleLocation: point,
    googleMatchConfidence: score >= 82 ? 'high' : 'medium',
    googleMatchScore: Math.round(score),
    googleQuery: query,
  };
}

async function resolveGooglePlace(request, options = {}) {
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
  if (cached && !cached.googlePlaceId && !options.force
    && Date.now() - Date.parse(cached.resolvedAt || '') < NO_MATCH_REUSE_DAYS * 86400000) return null;
  if (cached?.googlePlaceId && !options.force && !options.requireFields) {
    return {
      googlePlaceId: cached.googlePlaceId,
      googleMatchConfidence: 'cached',
      googleQuery: buildTextQuery(request),
    };
  }
  if (cached?.googlePlaceId && !options.force && options.requireFields) {
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
  // Google's search already matches translated and alternate names ("The Orange Trees Garden" for
  // "Giardino degli Aranci"), so for places the model adds, its first open result near the port is trusted.
  if (request.kind === 'supplement' && (!best || best.score < 55)) {
    const top = places.find(place => place.businessStatus !== 'CLOSED_PERMANENTLY' && placePoint(place)
      && (!request.reference || haversineMeters(request.reference, placePoint(place)) <= 25000));
    if (top) best = { place: top, score: 55 };
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
  const fallback = catalog.guideCentre || catalog.portAnchor || catalog.port || portInfo;
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

export async function resolveCatalogGooglePlaces(portInfo, catalog, options = {}) {
  const apiKey = cleanString(options.apiKey);
  if (!apiKey) return { pois: {}, terminals: {} };
  const cache = loadCache(options.cachePath);
  const reference = portReference(portInfo, catalog);
  const pois = {};
  const terminals = {};

  const onlyIds = options.onlyIds ? new Set(options.onlyIds) : null;
  const candidates = (catalog.pois || []).filter(poi => !onlyIds || onlyIds.has(cleanString(poi.sourceId || poi.id)));
  await mapWithConcurrency(candidates, options.concurrency || 3, async poi => {
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
        requireFields: options.requireFields,
      });
      if (match) pois[sourceId] = match;
    } catch (error) {
      console.warn(`Google Places lookup failed for ${poi.name}: ${error.message}`);
    }
  });


  return { pois, terminals };
}

const FOOD_TYPE_WORDS = new Set(['restaurant', 'cafe', 'coffee', 'bakery', 'bar', 'pub', 'brewery', 'winery', 'food', 'deli', 'ice', 'dessert', 'meal', 'confectionery', 'tea', 'bistro', 'diner', 'cafeteria', 'pizza', 'steak', 'sandwich', 'seafood', 'brunch', 'breakfast']);
const SHOP_TYPE_WORDS = new Set(['store', 'shop', 'market', 'mall', 'boutique', 'florist', 'jeweler']);
const BUSINESS_MATCH_MAX_METRES = 250;
const OTHER_MATCH_MAX_METRES = 1000;

// Food wins for types like "coffee_shop" or "ice_cream_shop"; "barber_shop" is a shop.
function typeFamily(type) {
  const words = cleanString(type).split('_');
  if (words.some(word => FOOD_TYPE_WORDS.has(word))) return 'food_drink';
  if (words.some(word => SHOP_TYPE_WORDS.has(word))) return 'shopping';
  return type ? 'other' : '';
}

// A stop named like a nearby landmark or a similar business ("Gregory's" and Gregory's Arch, a boutique and a
// café called Del Sol) can match the wrong Google place. OpenStreetMap pins and tags are the reference, so a
// match that lies far from the OSM point, or that is a different kind of place, is ignored.
export function isWrongMatch(poi, match) {
  if (!poi || !match?.googleLocation) return false;
  const category = stopCategory(poi);
  const business = category === 'food_drink' || category === 'shopping';
  const lat = Number(poi.lat);
  const lng = Number(poi.lng);
  const limit = business ? BUSINESS_MATCH_MAX_METRES : OTHER_MATCH_MAX_METRES;
  if (Number.isFinite(lat) && Number.isFinite(lng) && haversineMeters({ lat, lng }, match.googleLocation) > limit) return true;
  const primary = typeFamily(match.googlePrimaryType);
  if (business) {
    if (primary) return primary !== category;
    const families = (match.googleTypes || []).map(typeFamily);
    return families.length > 0 && !families.includes(category);
  }
  return primary === 'food_drink' || primary === 'shopping';
}

const OVERPASS_URLS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const OVERPASS_GAP_MS = 1500;
const OVERPASS_RETRY_MS = [5000, 10000, 15000];
const SUPPLEMENT_SEARCH_METRES = 800;
// Words the model adds to describe a place that OSM names usually leave out.
const GENERIC_NAME_WORDS = new Set(['the', 'and', 'of', 'de', 'del', 'della', 'di', 'la', 'le', 'el', 'ruins', 'ruin', 'mayan', 'site', 'visitor', 'center', 'centre', 'path', 'trail', 'walk', 'caldera', 'historic', 'district', 'old', 'town', 'area']);
let nextOverpassAt = 0;

// Overpass asks for gentle use, so calls queue behind each other, move to the next server when one is
// busy, and back off before trying again.
async function overpass(query, { retries, timeoutMs }) {
  for (let attempt = 0; ; attempt += 1) {
    const wait = Math.max(0, nextOverpassAt - Date.now());
    nextOverpassAt = Date.now() + wait + OVERPASS_GAP_MS;
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    let status;
    try {
      const response = await fetch(OVERPASS_URLS[attempt % OVERPASS_URLS.length], {
        method: 'POST',
        headers: { 'User-Agent': 'Portlore/1.0 (https://portlore.com)', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) return response.json();
      status = response.status;
    } catch (error) {
      status = error.name === 'TimeoutError' ? 'timeout' : error.message;
    }
    if (![429, 502, 503, 504, 'timeout'].includes(status) || attempt >= retries) {
      throw new Error(`Overpass returned ${status}`);
    }
    if (attempt % OVERPASS_URLS.length === OVERPASS_URLS.length - 1) {
      await new Promise(resolve => setTimeout(resolve, OVERPASS_RETRY_MS[attempt]));
    }
  }
}

function nameWords(value) {
  return normalize(String(value || '').replace(/\(.*?\)/g, ' '))
    .split(' ')
    .filter(word => word.length > 1 && !GENERIC_NAME_WORDS.has(word));
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_GAP_MS = 1100;
let nextNominatimAt = 0;

// Nominatim knows translated names ("Roman Forum" for Foro Romano) and allows one request a second.
async function nominatimNear(name, near) {
  const wait = Math.max(0, nextNominatimAt - Date.now());
  nextNominatimAt = Date.now() + wait + NOMINATIM_GAP_MS;
  if (wait) await new Promise(resolve => setTimeout(resolve, wait));
  const latDelta = SUPPLEMENT_SEARCH_METRES / 111000;
  const lngDelta = latDelta / Math.max(Math.cos((near.lat * Math.PI) / 180), 0.2);
  const response = await fetch(`${NOMINATIM_URL}?${new URLSearchParams({
    q: name, format: 'jsonv2', addressdetails: '1', limit: '5', bounded: '1',
    viewbox: `${near.lng - lngDelta},${near.lat + latDelta},${near.lng + lngDelta},${near.lat - latDelta}`,
  })}`, {
    headers: { 'User-Agent': 'Portlore/1.0 (https://portlore.com)', Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Nominatim returned ${response.status}`);
  const results = await response.json();
  const item = (Array.isArray(results) ? results : [])
    .map(result => ({ result, point: { lat: Number(result.lat), lng: Number(result.lon) } }))
    .filter(({ point }) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
    .sort((a, b) => haversineMeters(near, a.point) - haversineMeters(near, b.point))[0];
  if (!item) return null;
  const address = item.result.address || {};
  return {
    ...item.point,
    distance: haversineMeters(near, item.point),
    address: [address.house_number, address.road].filter(Boolean).join(' '),
    osmType: cleanString(item.result.osm_type),
    osmId: String(item.result.osm_id || ''),
  };
}

// A guide build waits on this, so it tries Overpass once; a one-off cleanup can afford to retry.
export async function osmPlaceNear(name, near, { patient = false } = {}) {
  const found = await nominatimNear(name, near).catch(() => null);
  // A visitor is waiting on a live build, so it only tries the second server once; batch builds can wait out
  // a busy Overpass.
  return found || overpassNear(name, near, patient
    ? { retries: OVERPASS_RETRY_MS.length, timeoutMs: 20000 }
    : { retries: 1, timeoutMs: 10000 });
}

// The named OpenStreetMap feature near where Google found a place, so a stop the model added is pinned
// with OSM data instead of Google's. Most of the name's distinctive words must match.
async function overpassNear(name, near, options) {
  const wanted = nameWords(name);
  if (!wanted.length) return null;
  const data = await overpass(`[out:json][timeout:25];nwr(around:${SUPPLEMENT_SEARCH_METRES},${near.lat},${near.lng})[name];out center tags 400;`, options);
  let best = null;
  for (const element of Array.isArray(data?.elements) ? data.elements : []) {
    const tags = element.tags || {};
    const point = { lat: Number(element.center?.lat ?? element.lat), lng: Number(element.center?.lon ?? element.lon) };
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue;
    const labels = [tags['name:en'], tags.name, tags.alt_name, tags.official_name].filter(Boolean);
    const score = Math.max(0, ...labels.map(label => {
      const words = new Set(nameWords(label));
      return wanted.filter(word => words.has(word)).length / wanted.length;
    }));
    if (score < 0.6) continue;
    const distance = haversineMeters(near, point);
    if (best && (score < best.score || (score === best.score && distance >= best.distance))) continue;
    const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
    best = {
      ...point, score, distance,
      address: street,
      osmType: cleanString(element.type),
      osmId: String(element.id || ''),
    };
  }
  return best;
}

export async function resolveCurationGooglePlaces(portInfo, catalog, curation, options = {}) {
  const result = structuredClone(curation || {});
  const apiKey = cleanString(options.apiKey);
  if (!apiKey) return result;
  const cache = loadCache(options.cachePath);
  const reference = portReference(portInfo, catalog);
  const catalogMatches = options.catalogMatches || { pois: {} };
  const poisById = new Map((catalog.pois || []).map(poi => [cleanString(poi.sourceId), poi]));

  const selectedIds = new Set([
    ...(Array.isArray(result.places) ? result.places : []),
    ...(Array.isArray(result.hiddenGems) ? result.hiddenGems : []),
  ].map(item => cleanString(item?.sourceId)).filter(Boolean));

  for (const sourceId of selectedIds) {
    if (isWrongMatch(poisById.get(sourceId), catalogMatches.pois?.[sourceId])) {
      console.warn(`Ignoring Google match for ${sourceId}: ${catalogMatches.pois[sourceId].googleDisplayName} is a different place`);
      delete catalogMatches.pois[sourceId];
    }
  }

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
      kind: 'supplement',
    };
    let match = null;
    try {
      match = await resolveGooglePlace(request, {
        apiKey,
        cache,
        cachePath: options.cachePath,
        cacheKey: `supplement:${cleanString(poi.sourceId) || normalize(JSON.stringify(request))}`,
        requireFields: true,
      });
    } catch (error) {
      console.warn(`Google supplement lookup failed for ${request.name}: ${error.message}`);
    }
    if (!match?.googleLocation || match.googleBusinessStatus === 'CLOSED_PERMANENTLY') {
      console.warn(`Skipping unresolved supplemental POI: ${request.name}`);
      continue;
    }
    let place = null;
    try {
      place = await osmPlaceNear(request.name, match.googleLocation, { patient: options.patient });
    } catch (error) {
      console.warn(`OpenStreetMap lookup failed for ${request.name}: ${error.message}`);
    }
    if (!place) {
      console.warn(`Skipping supplemental POI not found in OpenStreetMap: ${request.name}`);
      continue;
    }
    resolvedSupplements.push({
      ...poi,
      googlePlaceId: match.googlePlaceId,
      googleMatchConfidence: match.googleMatchConfidence,
      lat: place.lat,
      lng: place.lng,
      address: cleanString(poi.address) || place.address,
      hoursNote: cleanString(poi.hoursNote),
      coordinateSource: 'openstreetmap',
      osmType: place.osmType,
      osmId: place.osmId,
    });
  }
  result.supplementedPois = resolvedSupplements;
  return result;
}

