export const CURRENT_CITY_SCHEMA_VERSION = '2.2';
export const POI_CATALOG_SCHEMA_VERSION = 5;
export const CITY_MAX_TOKENS = 32000;
const MAX_HIDDEN_GEMS = 7;
export const CITY_SYSTEM_PROMPT = 'You are a careful cruise-port guide editor. Output only valid JSON. No narration, explanation, preamble, markdown, or citations outside the JSON fields.';

function compactPoi(poi, terminals = []) {
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
  if (poi.cuisine?.length) value.u = poi.cuisine;
  if (poi.description) value.o = poi.description;
  if (poi.intro) value.d = poi.intro;
  if (poi.fame) value.k = poi.fame;
  if (poi.curated) value.p = 1;
  if (poi.gem) value.g = 1;
  return value;
}

export function buildCityCurationPrompt(portInfo, catalog) {
  const terminals = catalogTerminals(catalog);
  const terminalJson = JSON.stringify(terminals.map(terminal => ({ n: terminal.name, lat: terminal.lat, lng: terminal.lng })));
  // Gateway ports (Civitavecchia for Rome) measure walking distance from the city passengers travel into.
  const centre = catalog.guideCentre;
  const centreName = cleanString(centre?.name).replace(/\s*\([^)]*\)/g, '');
  const origins = centre ? [{ lat: centre.lat, lng: centre.lng }] : terminals;
  const centreKm = centre ? Math.round((nearestTerminal(centre, terminals)?.distance || 0) / 1000) : 0;
  const distanceRule = centre
    ? `The port is about ${centreKm} km from ${centreName}'s centre. Passengers travel in by train, coach, or taxi, then explore on foot from there. t is each POI's distance in metres from ${centreName}'s centre.`
    : "Passengers explore on foot from the terminal. t is each POI's distance in metres from the nearest terminal.";
  const poiJson = JSON.stringify((catalog.pois || []).map(poi => compactPoi(poi, origins)));
  const suggestions = Array.isArray(catalog.gemSuggestions) && catalog.gemSuggestions.length
    ? `
Editor's hidden gem suggestions not in the POI list: ${JSON.stringify(catalog.gemSuggestions)}. Add any that hold up as new stops with "hiddenGem": true.
`
    : '';

  return `Create a practical cruise-port guide for ${portInfo.city}, ${portInfo.country}.

Cruise terminals where passengers come ashore: ${terminalJson}
${distanceRule}

Curate the best possible day ashore from the POI shortlist below: the must-see sights, well-loved local favourites, a few hidden gems, and a varied spread of food and drink, shops, and outdoor stops. Aim for 35 to 50 stops; major cities can go up to 60. Go below 30 only when a port genuinely lacks good options.
- Keep the exact sourceId of each stop you include.
- k is how many Wikipedia language editions cover a place. Keep the most famous places (highest k) unless they are closed or unsuitable for visitors.
- Keep editor's picks (p=1) unless they have closed.
- Favour stops within walking distance, but always keep the headline attractions, even when they need a short ride. Never drop a worthwhile stop only because it is farther away.
- At least 30 to 40% of the stops should be food and drink where the port has enough good options, covering a wide variety: local restaurants, cafés and bakeries, street food and markets, sweets or gelato, and local drinks.
- Also include at least 3 shops, 3 outdoor stops, and 1 or 2 essentials (such as a pharmacy or ATM near the terminal) whenever the shortlist has them.
- Add "hiddenGem": true to 3 to 7 stops: quieter places a first-time visitor would likely miss but locals or seasoned travellers rate highly. Editor's gem candidates (g=1) are gems by default; always keep them as stops, and add "hiddenGem": false only to one that does not hold up. The description of a gem says what makes it special, not just that it is well liked.
- Add at most a few important stops missing from the list (attractions, districts, waterfronts, markets, beaches, viewpoints, food halls, or distinctive local food), with an exact name and address. Only add real places you know well.

Leave out:
- chains and everyday businesses (supermarkets, car rentals, generic takeaways, trade shops) unless locally famous
- private, industrial, or closed places
- duplicates: the same place listed twice, for example under two names

Never invent anything. Describe a place only from its POI data (d is its Wikipedia intro, when it has one) or from what you reliably know about that exact place. If you cannot tell what a place is, leave it out rather than guess from its name.

For each stop, write a subtitle of at most 15 words, a one- or two-sentence description, and suggestedVisitMinutes.

The summary says what the destination offers, how passengers get from the terminal into town with a realistic distance and travel time, and whether they can explore on foot.

Return only this JSON:
{"timezone":"","photo_query":"","overview":{"summary":""},"places":[{"sourceId":"","subtitle":"","description":"","suggestedVisitMinutes":45}],"supplementedPois":[{"sourceId":"supplement/example-slug","name":"","address":"","category":"attraction","subtitle":"","description":"","suggestedVisitMinutes":45}]}

POI keys: id=sourceId, n=name, e=English name, c=category, s=subcategory, lat/lng, t=distance in metres, a=address, h=hours, u=cuisine, o=description, d=Wikipedia intro, k=Wikipedia editions covering the place, p=editor's pick, g=editor's gem candidate.
${suggestions}
POIs:
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

const GOOGLE_CATEGORIES = [
  ['essentials', /^(pharmacy|drugstore|atm|bank|car_rental|hospital|post_office|supermarket|grocery_store|convenience_store|tourist_information_center)$/],
  ['food_drink', /(restaurant|cafe|coffee_shop|bakery|bar|pub|brewery|winery|ice_cream_shop|dessert_shop|food_court|meal_takeaway|tea_house|confectionery|deli)$/],
  ['shopping', /(_store|^store$|shopping_mall|^market$|farmers_market|gift_shop|flea_market)$/],
  ['outdoors', /^(park|national_park|state_park|garden|botanical_garden|beach|hiking_area|marina|plaza|dog_park|city_park)$/],
  ['attraction', /(museum|art_gallery|church|place_of_worship|tourist_attraction|historical_landmark|historical_place|monument|castle|cultural_landmark|aquarium|zoo|observation_deck|performing_arts_theater|landmark)$/],
];

// Google's place types are more reliable than OSM tags, so they decide the category when a stop matched.
function categoryFromGoogle(match) {
  const types = [cleanString(match?.googlePrimaryType), ...(Array.isArray(match?.googleTypes) ? match.googleTypes : [])].filter(Boolean);
  for (const type of types) {
    const found = GOOGLE_CATEGORIES.find(([, pattern]) => pattern.test(type));
    if (found) return found[0];
  }
  return '';
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
  const category = categoryFromGoogle(googleMatch) || generated.category || poi.category;
  const officialWebsiteUrl = cleanString(poi.website) || cleanString(googleMatch?.googleWebsite) || generated.officialWebsiteUrl;
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
  const editorial = normalizeEditorial({ ...poi, displayCategory: categoryFromGoogle(poi) || poi.category });
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
    website: cleanString(poi.googleWebsite) || editorial.officialWebsiteUrl,
    officialWebsiteUrl: cleanString(poi.googleWebsite) || editorial.officialWebsiteUrl,
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

function nameKey(value) {
  return cleanString(value).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Drops an added stop when the model re-adds a supplied stop under a longer or shorter name.
function duplicatesPlace(supplement, places) {
  const name = nameKey(supplement.name);
  if (!name) return false;
  return places.some(place => {
    const other = nameKey(place.name);
    if (!other || (!name.includes(other) && !other.includes(name))) return false;
    return !Number.isFinite(Number(place.lat)) || haversineMeters(place, supplement) <= 500;
  });
}

function buildTerminals(catalog, fallback, portInfo) {
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
export function buildCityData(portInfo, catalog, curation = {}, googleMatches = {}) {
  const byId = new Map((catalog.pois || []).map(poi => [poi.sourceId, poi]));
  const used = new Set();

  const places = [];
  const hiddenGems = [];
  for (const editorial of Array.isArray(curation.places) ? curation.places : []) {
    const id = cleanString(editorial.sourceId);
    const poi = byId.get(id);
    if (!poi || used.has(id)) continue;
    used.add(id);
    // An editor's gem stays a gem unless the model explicitly turns it down.
    const isGem = editorial.hiddenGem === true || (poi.gem && editorial.hiddenGem !== false);
    (isGem ? hiddenGems : places).push(copySuppliedPoi(poi, editorial, googleMatches.pois?.[id]));
  }

  const supplements = [];
  for (const item of Array.isArray(curation.supplementedPois) ? curation.supplementedPois : []) {
    const supplement = copySupplement(item);
    if (!supplement || used.has(supplement.id)) continue;
    used.add(supplement.id);
    supplements.push({ supplement, isGem: item.hiddenGem === true });
  }
  for (const { supplement, isGem } of supplements) {
    if (duplicatesPlace(supplement, [...places, ...hiddenGems])) continue;
    (isGem ? hiddenGems : places).push(supplement);
  }
  // Editor's gems go first so the cap trims the model's extra picks; the rest stay as regular stops.
  const rankedGems = [...hiddenGems.filter(item => byId.get(item.sourceId)?.gem), ...hiddenGems.filter(item => !byId.get(item.sourceId)?.gem)];
  hiddenGems.splice(0, hiddenGems.length, ...rankedGems.slice(0, MAX_HIDDEN_GEMS));
  places.push(...rankedGems.slice(MAX_HIDDEN_GEMS));

  const fallback = catalog.portAnchor || catalog.port || portInfo;
  const terminals = buildTerminals(catalog, fallback, portInfo);
  const verifiedTerminals = terminals.some(item => item.verified);
  const defaultTerminal = terminals.find(item => item.id === catalog.defaultTerminalId) || terminals[0];

  const overview = curation.overview && typeof curation.overview === 'object' ? curation.overview : {};
  const distancePlaces = places.map(place => applyTerminalDistance(place, terminals));
  const distanceHiddenGems = hiddenGems.map(place => applyTerminalDistance(place, terminals));

  return {
    schemaVersion: CURRENT_CITY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: 'curated-poi-v5-google-places',
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
      status: verifiedTerminals ? 'confirmed' : 'unresolved',
      warning: verifiedTerminals ? '' : 'No verified cruise terminal was found, so the port anchor is being used.',
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
