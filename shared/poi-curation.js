export const CURRENT_CITY_SCHEMA_VERSION = '1.9';
export const POI_CATALOG_SCHEMA_VERSION = 5;
export const CITY_MODEL = 'claude-haiku-4-5-20251001';
export const CITY_MAX_TOKENS = 20000;
export const CITY_SYSTEM_PROMPT = 'You are a careful cruise-port guide editor with web research access. Output only valid JSON. No narration, explanation, preamble, markdown, or citations outside the JSON fields.';
export const CITY_TOOLS = [
  {
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: 10,
  },
];

function compactPoi(poi, googleMatch = null, terminals = []) {
  const value = {
    id: poi.sourceId,
    n: poi.name,
    e: poi.nameEnglish || undefined,
    c: poi.category,
    s: poi.subcategory,
    lat: poi.lat,
    lng: poi.lng,
  };
  if (!value.e) delete value.e;
  const nearest = nearestTerminal(poi, terminals);
  if (nearest) value.t = nearest.distance;
  if (poi.address) value.a = poi.address;
  if (poi.openingHours) value.h = poi.openingHours;
  if (poi.website) value.w = poi.website;
  if (poi.phone) value.p = poi.phone;
  if (poi.cuisine?.length) value.u = poi.cuisine;
  if (poi.wheelchair) value.x = poi.wheelchair;
  if (poi.description) value.o = poi.description;
  if (poi.osmTags && Object.keys(poi.osmTags).length) value.g = poi.osmTags;
  if (googleMatch?.googlePlaceId) {
    value.gp = googleMatch.googlePlaceId;
    value.gn = googleMatch.googleDisplayName || undefined;
    value.ga = googleMatch.googleFormattedAddress || undefined;
    value.gt = googleMatch.googlePrimaryType || undefined;
    value.gb = googleMatch.googleBusinessStatus || undefined;
  }
  return value;
}

export function buildCityCurationPrompt(portInfo, catalog, googleMatches = {}) {
  const terminals = catalogTerminals(catalog);
  const terminalJson = JSON.stringify(terminals.map(terminal => ({ n: terminal.name, lat: terminal.lat, lng: terminal.lng })));
  const poiJson = JSON.stringify((catalog.pois || []).map(poi => compactPoi(poi, googleMatches.pois?.[poi.sourceId], terminals)));

  return `Create a practical cruise-port guide for ${portInfo.city}, ${portInfo.country}.

Use the supplied curated POIs as the main list. Make a final editorial pass: keep good stops, remove weak or unsuitable ones, and add only a few obvious omissions. Do not rebuild the destination from scratch.

Port ID: ${portInfo.id}
Cruise terminals where passengers come ashore: ${terminalJson}

POIS

- Keep the exact sourceId for each supplied POI you include.
- Remove closed, private, industrial, malformed, duplicated, unrelated, or low-value stops.
- Source categories may be wrong. Choose the best display category.
- Keep a useful range of food and drink options when they differ by cuisine, format, or visitor need.
- Each POI's t value is its straight-line distance in metres from the nearest cruise terminal. Passengers start from a terminal, not the city centre.
- Favor stops within walking distance of a terminal and the walkable visitor core near it, while still including important farther attractions when worthwhile.
- Access classifications and Maps links are calculated after your curation.
- Google match fields are provided when available. Use them to confirm identity and closure status, but do not repeat routine verification.
- Search only for questionable POIs, missing official websites, duplicates, and obvious missing headline stops.

You may add a few important missing attractions, districts, waterfronts, markets, beaches, viewpoints, food halls, shopping areas, or distinctive local food stops. For each supplement return an exact name, address when available, and a practical location hint. Do not return coordinates.

For each included stop return:
- subtitle: at most 10 words
- description: 1 or 2 useful sentences
- suggestedVisitMinutes
- goodFor: 1 to 4 short labels
- displayCategory: attraction, food_drink, shopping, outdoors, or essentials
- officialWebsiteUrl: official site when confidently known, otherwise empty
- hoursNote: only when limited hours materially affect a cruise visit
- operatingStatus: open, uncertain, or not_applicable

Do not research, select, rename, or return cruise terminals. The terminals above are verified.
Do not select hidden gems. Return hiddenGems as an empty array. That field is reserved for future manual entries.
Do not calculate coordinates, distance, access, or Maps links. Do not include prices, ratings, detailed schedules, construction updates, or temporary details.


Write a concise overview of what the destination offers, general walkability, and whether transport is needed.

Return only this JSON shape:
{"province":"","timezone":"","photo_query":"","background_position":"center 70%","overview":{"summary":"","arrivalContext":""},"places":[{"sourceId":"","source":"supplied","subtitle":"","description":"","suggestedVisitMinutes":45,"goodFor":[],"displayCategory":"attraction","operatingStatus":"open","officialWebsiteUrl":"","hoursNote":"","verificationSourceUrls":[]}],"hiddenGems":[],"supplementedPois":[{"sourceId":"supplement/example-slug","source":"supplement","name":"","address":"","locationHint":"main visitor entrance","category":"attraction","subtitle":"","description":"","suggestedVisitMinutes":45,"goodFor":[],"operatingStatus":"open","officialWebsiteUrl":"","hoursNote":"","reasonAdded":"","confidence":"high","verificationSourceUrls":[]}],"excludedPoiIds":[{"sourceId":"","reason":""}]}

Candidate keys: id=source ID, n=name, e=English name, c=category, s=subcategory, lat/lng=source coordinates, t=metres from the nearest cruise terminal, a=address, h=hours, w=website, p=phone, u=cuisine, x=wheelchair, o=description, g=source tags, gp=Google Place ID, gn=Google name, ga=Google address, gt=Google type, gb=Google business status.

Supplied curated POIs:
${poiJson}`;
}

function cleanString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function cleanStringArray(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return [...new Set(value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean))];
}

function clampMinutes(value, fallback = 45) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(10, Math.min(360, Math.round(number)));
}

function iconFor(category, subcategory = '') {
  const value = `${category} ${subcategory}`.toLowerCase();
  if (/food|restaurant|cafe|bar|pub|bakery/.test(value)) return 'restaurant';
  if (/shopping|market|mall|shop/.test(value)) return 'market';
  if (/beach/.test(value)) return 'beach';
  if (/park|garden|nature|trail/.test(value)) return 'park';
  if (/viewpoint|lookout|tower/.test(value)) return 'viewpoint';
  if (/castle|fort/.test(value)) return 'castle';
  if (/church|cathedral|temple|shrine/.test(value)) return 'church';
  if (/museum/.test(value)) return 'museum';
  if (/gallery|artwork/.test(value)) return 'gallery';
  return category || 'default';
}

function normalizeEditorial(editorial = {}) {
  return {
    subtitle: cleanString(editorial.subtitle),
    description: cleanString(editorial.description),
    suggestedVisitMinutes: clampMinutes(editorial.suggestedVisitMinutes),
    goodFor: cleanStringArray(editorial.goodFor).slice(0, 4),
    category: ['attraction', 'food_drink', 'shopping', 'outdoors', 'essentials'].includes(editorial.displayCategory)
      ? editorial.displayCategory
      : undefined,
    operatingStatus: ['open', 'uncertain', 'not_applicable'].includes(editorial.operatingStatus)
      ? editorial.operatingStatus
      : 'uncertain',
    officialWebsiteUrl: cleanString(editorial.officialWebsiteUrl),
    hoursNote: cleanString(editorial.hoursNote),
    verificationSourceUrls: cleanStringArray(editorial.verificationSourceUrls),
  };
}

function copySuppliedPoi(poi, editorial, googleMatch = null) {
  const generated = normalizeEditorial(editorial);
  const category = generated.category || poi.category;
  const officialWebsiteUrl = generated.officialWebsiteUrl || cleanString(poi.website);
  const hours = cleanString(googleMatch?.googleOpeningHours) || generated.hoursNote || cleanString(poi.openingHours);
  return {
    id: poi.sourceId,
    sourceId: poi.sourceId,
    source: 'supplied',
    name: poi.nameEnglish || poi.name,
    localName: poi.name,
    subtitle: generated.subtitle,
    description: generated.description,
    category,
    subcategory: poi.subcategory || '',
    icon: iconFor(category, poi.subcategory),
    lat: Number(googleMatch?.googleLocation?.lat ?? poi.lat),
    lng: Number(googleMatch?.googleLocation?.lng ?? poi.lng),
    sourceLat: Number(poi.lat),
    sourceLng: Number(poi.lng),
    address: poi.address || '',
    hours,
    website: officialWebsiteUrl,
    officialWebsiteUrl,
    phone: poi.phone || '',
    cuisine: poi.cuisine || [],
    wheelchair: poi.wheelchair || '',
    suggestedVisitMinutes: generated.suggestedVisitMinutes,
    goodFor: generated.goodFor,
    operatingStatus: generated.operatingStatus,
    access: '',
    nearestTerminalId: '',
    distanceFromTerminalMeters: 0,
    verificationSourceUrls: generated.verificationSourceUrls,
    googlePlaceId: cleanString(googleMatch?.googlePlaceId),
    googlePlaceMatchConfidence: cleanString(googleMatch?.googleMatchConfidence),
    googleBusinessStatus: cleanString(googleMatch?.googleBusinessStatus),
  };
}

function copySupplement(poi) {
  const editorial = normalizeEditorial({ ...poi, displayCategory: poi.category });
  const id = cleanString(poi.sourceId);
  if (!id.startsWith('supplement/')) return null;
  const lat = Number(poi.lat);
  const lng = Number(poi.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !cleanString(poi.name)) return null;
  return {
    id,
    sourceId: id,
    source: 'supplement',
    name: cleanString(poi.name),
    localName: cleanString(poi.name),
    subtitle: editorial.subtitle,
    description: editorial.description,
    category: editorial.category || 'attraction',
    subcategory: '',
    icon: iconFor(editorial.category || 'attraction'),
    lat,
    lng,
    address: cleanString(poi.address),
    hours: editorial.hoursNote,
    website: editorial.officialWebsiteUrl,
    officialWebsiteUrl: editorial.officialWebsiteUrl,
    phone: '',
    cuisine: [],
    wheelchair: '',
    suggestedVisitMinutes: editorial.suggestedVisitMinutes,
    goodFor: editorial.goodFor,
    operatingStatus: editorial.operatingStatus,
    access: '',
    nearestTerminalId: '',
    distanceFromTerminalMeters: 0,
    reasonAdded: cleanString(poi.reasonAdded),
    confidence: ['high', 'medium', 'low'].includes(poi.confidence) ? poi.confidence : 'medium',
    verificationSourceUrls: editorial.verificationSourceUrls,
    coordinateSource: cleanString(poi.coordinateSource),
    osmType: cleanString(poi.osmType),
    osmId: cleanString(poi.osmId),
    geocodeConfidence: cleanString(poi.geocodeConfidence),
    googlePlaceId: cleanString(poi.googlePlaceId),
    googlePlaceMatchConfidence: cleanString(poi.googleMatchConfidence),
    googleBusinessStatus: cleanString(poi.googleBusinessStatus),
  };
}

function cleanTerminal(terminal) {
  return {
    id: cleanString(terminal.id || terminal.sourceId),
    sourceId: cleanString(terminal.sourceId || terminal.id),
    name: cleanString(terminal.name, 'Cruise terminal'),
    lat: Number(terminal.lat),
    lng: Number(terminal.lng),
    address: cleanString(terminal.address),
    terminalType: cleanString(terminal.terminalType),
    verified: Boolean(terminal.verified),
    source: cleanString(terminal.source),
    sourceUrls: cleanStringArray(terminal.sourceUrls || terminal.verificationSourceUrls),
    coordinateSource: cleanString(terminal.coordinateSource),
    osmType: cleanString(terminal.osmType),
    osmId: cleanString(terminal.osmId),
    geocodeConfidence: cleanString(terminal.geocodeConfidence),
    googlePlaceId: cleanString(terminal.googlePlaceId),
    googlePlaceMatchConfidence: cleanString(terminal.googleMatchConfidence),
  };
}

function usableTerminals(items) {
  return (Array.isArray(items) ? items : [])
    .map(cleanTerminal)
    .filter(item => item.id && Number.isFinite(item.lat) && Number.isFinite(item.lng));
}

export function hasVerifiedTerminals(catalog) {
  return usableTerminals(catalog?.terminals).some(item => item.verified);
}

function catalogTerminals(catalog) {
  const supplied = usableTerminals(catalog?.terminals);
  const verified = supplied.filter(item => item.verified);
  return verified.length ? verified : supplied;
}

function nearestTerminal(place, terminals) {
  if (!terminals.length || !Number.isFinite(Number(place.lat)) || !Number.isFinite(Number(place.lng))) return null;
  let nearest = null;
  for (const terminal of terminals) {
    const distance = haversineMeters(place, terminal);
    if (!nearest || distance < nearest.distance) nearest = { terminal, distance };
  }
  return nearest;
}

function buildTerminals(catalog, discoveredTerminals, fallback, portInfo) {
  if (hasVerifiedTerminals(catalog)) return catalogTerminals(catalog);

  const discovered = usableTerminals(discoveredTerminals);
  if (discovered.length) return discovered;

  const supplied = catalogTerminals(catalog);
  if (supplied.length) return supplied;

  const lat = Number(fallback.lat);
  const lng = Number(fallback.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  return [{
    id: fallback.id || 'ports-json-anchor',
    sourceId: fallback.id || 'ports-json-anchor',
    name: fallback.name || fallback.terminal || `${portInfo.city} port`,
    lat,
    lng,
    address: fallback.address || '',
    terminalType: 'fallback_port_anchor',
    verified: false,
    source: 'ports.json',
    sourceUrls: [],
  }];
}

function haversineMeters(a, b) {
  const toRadians = value => (value * Math.PI) / 180;
  const earthRadius = 6371000;
  const lat1 = toRadians(Number(a.lat));
  const lat2 = toRadians(Number(b.lat));
  const deltaLat = lat2 - lat1;
  const deltaLng = toRadians(Number(b.lng) - Number(a.lng));
  const value = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return Math.round(earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value)));
}

function accessFromDistance(distanceMeters) {
  if (distanceMeters <= 1600) return 'walkable';
  if (distanceMeters <= 3000) return 'long_walk';
  if (distanceMeters <= 7000) return 'short_ride';
  return 'transport_required';
}

function applyTerminalDistance(place, terminals) {
  if (!terminals.length || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return place;
  let nearest = terminals[0];
  let distance = haversineMeters(place, nearest);
  for (const terminal of terminals.slice(1)) {
    const candidateDistance = haversineMeters(place, terminal);
    if (candidateDistance < distance) {
      nearest = terminal;
      distance = candidateDistance;
    }
  }
  return {
    ...place,
    nearestTerminalId: nearest.id,
    distanceFromTerminalMeters: distance,
    access: accessFromDistance(distance),
  };
}
export function buildCityData(portInfo, catalog, curation = {}, googleMatches = {}, discoveredTerminals = []) {
  const byId = new Map((catalog.pois || []).map(poi => [poi.sourceId, poi]));
  const used = new Set();

  function resolveSupplied(items) {
    const output = [];
    for (const editorial of Array.isArray(items) ? items : []) {
      const id = cleanString(editorial.sourceId);
      const poi = byId.get(id);
      if (!poi || used.has(id)) continue;
      used.add(id);
      output.push(copySuppliedPoi(poi, editorial, googleMatches.pois?.[id]));
    }
    return output;
  }

  const places = resolveSupplied(curation.places);
  const hiddenGems = [];

  const supplements = [];
  for (const item of Array.isArray(curation.supplementedPois) ? curation.supplementedPois : []) {
    const supplement = copySupplement(item);
    if (!supplement || used.has(supplement.id)) continue;
    used.add(supplement.id);
    supplements.push(supplement);
  }
  places.push(...supplements);

  const fallback = catalog.portAnchor || catalog.port || portInfo;
  const terminals = buildTerminals(catalog, discoveredTerminals, fallback, portInfo);
  const verifiedTerminals = hasVerifiedTerminals(catalog);
  const defaultTerminal = terminals.find(item => item.id === catalog.defaultTerminalId) || terminals[0];

  const overview = curation.overview && typeof curation.overview === 'object' ? curation.overview : {};
  const distancePlaces = places.map(place => applyTerminalDistance(place, terminals));
  const distanceHiddenGems = hiddenGems.map(place => applyTerminalDistance(place, terminals));

  return {
    schemaVersion: CURRENT_CITY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: 'curated-poi-v4-google-places-claude-enrichment',
    id: portInfo.id,
    city: portInfo.city,
    country: portInfo.country,
    province: cleanString(curation.province),
    timezone: cleanString(curation.timezone),
    photo_query: cleanString(curation.photo_query, `${portInfo.city} ${portInfo.country} travel`),
    background_position: cleanString(curation.background_position, 'center 70%'),
    overview: {
      summary: cleanString(overview.summary),
      arrivalContext: cleanString(overview.arrivalContext),
    },
    port: defaultTerminal,
    terminal: defaultTerminal,
    terminals,
    terminalReview: {
      status: verifiedTerminals || discoveredTerminals.length ? 'confirmed' : 'unresolved',
      warning: verifiedTerminals || discoveredTerminals.length ? '' : 'No verified cruise terminal was found, so the port anchor is being used.',
      proposedCorrection: null,
    },
    weather: {
      lat: Number(defaultTerminal.lat),
      lng: Number(defaultTerminal.lng),
    },
    places: distancePlaces,
    hiddenGems: distanceHiddenGems,
    excludedPoiIds: (Array.isArray(curation.excludedPoiIds) ? curation.excludedPoiIds : [])
      .map(item => ({ sourceId: cleanString(item?.sourceId), reason: cleanString(item?.reason) }))
      .filter(item => item.sourceId && byId.has(item.sourceId)),
    deals: [],
  };
}
