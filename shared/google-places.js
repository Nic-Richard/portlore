import fs from 'fs';

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

const BUSINESS_TYPES = /(restaurant|cafe|coffee|bakery|bar|pub|brewery|winery|food|store|shop|market|deli|ice_cream|dessert|meal|confectionery|tea_house)/;
const BUSINESS_MATCH_MAX_METRES = 250;

// A café or shop named like a nearby landmark or a similar business ("Gregory's" and Gregory's Arch) can match
// the wrong Google place. Restaurants and shops are pinned accurately in OpenStreetMap, so a match that moves
// one far away, or that Google doesn't list as any kind of business, is a different place.
export function isWrongBusinessMatch(poi, match) {
  if (!['food_drink', 'shopping'].includes(poi?.category) || !match?.googleLocation) return false;
  const lat = Number(poi.lat);
  const lng = Number(poi.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && haversineMeters({ lat, lng }, match.googleLocation) > BUSINESS_MATCH_MAX_METRES) return true;
  const types = [match.googlePrimaryType, ...(match.googleTypes || [])].filter(Boolean);
  return types.length > 0 && !types.some(type => BUSINESS_TYPES.test(type));
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
    if (isWrongBusinessMatch(poisById.get(sourceId), catalogMatches.pois?.[sourceId])) {
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
    resolvedSupplements.push({
      ...poi,
      ...match,
      lat: match.googleLocation.lat,
      lng: match.googleLocation.lng,
      address: cleanString(poi.address) || match.googleFormattedAddress,
      hoursNote: cleanString(poi.hoursNote),
      coordinateSource: 'google_places',
    });
  }
  result.supplementedPois = resolvedSupplements;
  return result;
}

