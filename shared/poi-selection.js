import fs from 'fs';

const FAME_FILE = new URL('../data/wikidata-fame.json', import.meta.url);
const FAME = fs.existsSync(FAME_FILE) ? JSON.parse(fs.readFileSync(FAME_FILE, 'utf8')).counts : {};
const PICKS_FILE = new URL('../data/curated-picks.json', import.meta.url);
const PICKS = fs.existsSync(PICKS_FILE) ? JSON.parse(fs.readFileSync(PICKS_FILE, 'utf8')).ports : {};

const CATEGORY_BASE_TARGETS = {
  attraction: 58,
  food_drink: 62,
  shopping: 30,
  outdoors: 32,
  essentials: 8,
};

const FLEXIBLE_SLOTS = 30;

const CATEGORY_MAXIMUMS = {
  attraction: 75,
  food_drink: 80,
  shopping: 45,
  outdoors: 45,
  essentials: 15,
};

const BLOCKED_SHOPPING = new Set([
  'beauty', 'car', 'car_parts', 'car_repair', 'chemist', 'copyshop', 'curtain', 'doityourself',
  'dry_cleaning', 'electronics', 'furniture', 'hairdresser', 'hearing_aids', 'locksmith',
  'money_lender', 'motorcycle', 'optician', 'pawnbroker', 'pet', 'printer_ink', 'scuba_diving',
  'sewing', 'tailor', 'tattoo', 'trade', 'travel_agency', 'tyres', 'vacant', 'yes',
  'mobile_phone', 'computer', 'appliance', 'bathroom_furnishing', 'bed', 'flooring', 'kitchen',
  'lighting', 'paint', 'storage_rental', 'wholesale',
]);

const PREFERRED_SHOPPING = new Set([
  'antiques', 'art', 'bakery', 'books', 'boutique', 'cheese', 'chocolate', 'clothes',
  'coffee', 'confectionery', 'deli', 'department_store', 'farm', 'florist', 'gift',
  'greengrocer', 'jewelry', 'local_food', 'mall', 'marketplace', 'music', 'seafood',
  'second_hand', 'shoes', 'souvenir', 'sports', 'tea', 'toys', 'variety_store',
]);

const LOW_VALUE_SHOPPING = new Set([
  'alcohol', 'beverages', 'butcher', 'convenience', 'general', 'kiosk', 'newsagent',
  'supermarket', 'tobacco', 'video_games',
]);

const BLOCKED_ESSENTIALS = new Set(['bank', 'atm', 'hospital', 'clinic']);
const WEAK_OUTDOORS = new Set(['playground']);
const WEAK_ATTRACTIONS = new Set(['memorial', 'artwork']);

function distanceForCuration(poi) {
  return Number(poi.minDistanceFromAnyTerminalMeters ?? poi.distanceFromTerminalMeters ?? Infinity);
}
// How many Wikipedia editions cover a place, from data/wikidata-fame.json. Chain branches do not count.
function wikidataId(poi) {
  return String(poi.wikidata || '').split(';')[0].trim();
}

function fame(poi) {
  if (poi.brand) return 0;
  const id = wikidataId(poi);
  if (id && Number.isFinite(FAME[id])) return FAME[id];
  return poi.wikidata || poi.wikipedia ? 1 : 0;
}

function isNotable(poi) {
  return fame(poi) > 0;
}

// Landmarks this well known are never held back by the per-type variety cap.
const WORLD_FAMOUS = 20;
const MAX_LANDMARKS = 15;
const LANDMARK_MIN_FAME = 5;

function hasUsefulMetadata(poi) {
  return Boolean(poi.address || poi.openingHours || poi.website || poi.phone || poi.description || poi.cuisine?.length);
}

// Names that are never a stop worth visiting, whatever OpenStreetMap tagged them as.
const NOT_A_STOP = /parking|community garden|car ?park|rent[ -]?a[ -]?car|car rental|shipping|logistics|freight|cemetery entrance|graveyard|office|headquarters|warehouse|株式会社|有限会社/i;

// Places that are worth listing even without extra details in OpenStreetMap.
const STANDOUT_SUBTYPES = new Set(['museum', 'gallery', 'aquarium', 'zoo', 'theme_park', 'castle', 'fort', 'archaeological_site', 'lighthouse', 'monument', 'ruins', 'cathedral', 'viewpoint', 'beach', 'nature_reserve', 'garden', 'waterfall', 'peak', 'marketplace', 'visitor_information']);

// Keeps thin ports from padding their shortlist with bare, unremarkable entries.
function earnsPlace(poi) {
  return isNotable(poi) || hasUsefulMetadata(poi) || STANDOUT_SUBTYPES.has(poi.subcategory);
}

function isVisitorRelevantPoi(poi) {
  const distance = distanceForCuration(poi);
  if (!Number.isFinite(distance) || !poi?.name) return false;
  if (NOT_A_STOP.test(poi.name) || !earnsPlace(poi)) return false;
  if (poi.category === 'food_drink') return true;
  if (poi.category === 'shopping') return !BLOCKED_SHOPPING.has(poi.subcategory);
  if (poi.category === 'essentials') return !BLOCKED_ESSENTIALS.has(poi.subcategory);
  if (poi.category === 'outdoors') return !WEAK_OUTDOORS.has(poi.subcategory) || hasUsefulMetadata(poi);
  if (poi.category === 'attraction') return !WEAK_ATTRACTIONS.has(poi.subcategory) || hasUsefulMetadata(poi);
  return false;
}

function metadataScore(poi) {
  return [
    poi.address ? 1 : 0,
    poi.openingHours ? 1 : 0,
    poi.website ? 1 : 0,
    poi.phone ? 1 : 0,
    poi.cuisine?.length ? 1 : 0,
    poi.description ? 1 : 0,
  ].reduce((sum, value) => sum + value, 0) * 9;
}

function subtypeScore(poi) {
  if (poi.category === 'attraction') {
    if (['museum', 'gallery', 'aquarium', 'zoo', 'theme_park', 'castle', 'fort', 'archaeological_site', 'lighthouse'].includes(poi.subcategory)) return 30;
    if (['attraction', 'monument', 'ruins', 'church', 'cathedral', 'temple', 'shrine', 'square'].includes(poi.subcategory)) return 20;
    if (WEAK_ATTRACTIONS.has(poi.subcategory)) return -10;
    return 10;
  }
  if (poi.category === 'outdoors') {
    if (['viewpoint', 'beach', 'nature_reserve', 'garden', 'park', 'waterfall', 'peak'].includes(poi.subcategory)) return 24;
    if (WEAK_OUTDOORS.has(poi.subcategory)) return -12;
    return 8;
  }
  if (poi.category === 'shopping') {
    if (PREFERRED_SHOPPING.has(poi.subcategory)) return 28;
    if (LOW_VALUE_SHOPPING.has(poi.subcategory)) return -18;
    return 2;
  }
  if (poi.category === 'essentials') {
    if (['visitor_information', 'toilets', 'drinking_water', 'pharmacy', 'car_rental', 'bicycle_rental'].includes(poi.subcategory)) return 18;
    return 0;
  }
  if (poi.category === 'food_drink') {
    if (poi.cuisine?.length) return 10;
    return 4;
  }
  return 0;
}

function candidateScore(poi) {
  const distance = distanceForCuration(poi);
  const distancePenalty = Math.min(70, Math.round(distance / 180));
  const localBonus = poi.brand ? -8 : 12;
  const nameBonus = poi.name && poi.name.length >= 3 ? 6 : 0;
  // Grows with fame so a landmark in 100 Wikipedias outranks a nearby museum in 2, even a few km further out.
  const notableBonus = Math.min(120, 18 * Math.log2(1 + fame(poi)));
  return metadataScore(poi) + subtypeScore(poi) + localBonus + nameBonus + notableBonus - distancePenalty;
}

function ranked(items) {
  return [...items].sort((a, b) => candidateScore(b) - candidateScore(a)
    || distanceForCuration(a) - distanceForCuration(b)
    || String(a.name).localeCompare(String(b.name)));
}

function nameKey(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function metersBetween(a, b) {
  const toRadians = value => (value * Math.PI) / 180;
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLng = toRadians(b.lng - a.lng);
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(deltaLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
}

// Picks are matched by name and location because OpenStreetMap-derived IDs change whenever a place is edited.
function findPick(pick, pois) {
  const key = nameKey(pick.name);
  let best = null;
  for (const poi of pois) {
    if (nameKey(poi.name) !== key && nameKey(poi.nameEnglish) !== key) continue;
    const distance = metersBetween(pick, poi);
    if (distance <= 250 && (!best || distance < best.distance)) best = { poi, distance };
  }
  return best?.poi || null;
}

// A pick that is not in OpenStreetMap at all is built from its own entry, which then needs a category.
function pickedPoi(pick, portId) {
  if (!Number.isFinite(pick.lat) || !Number.isFinite(pick.lng) || !pick.category) return null;
  const slug = nameKey(pick.name).replace(/ /g, '-');
  return {
    source: 'curated',
    sourceId: `curated/${portId}/${slug}`,
    name: pick.name,
    nameEnglish: '',
    category: pick.category,
    subcategory: pick.subcategory || pick.category,
    lat: pick.lat,
    lng: pick.lng,
    address: pick.address || '',
    website: pick.website || '',
    description: pick.note || '',
  };
}

// Picks named without a location are passed to the guide model, which can add them as new stops for Google Places to locate.
export function gemSuggestions(portId) {
  return (PICKS[portId] || []).filter(pick => pick.gem && !Number.isFinite(pick.lat)).map(pick => pick.name);
}

function curatedPicks(catalog) {
  const portId = catalog.port?.id;
  return (PICKS[portId] || [])
    .map(pick => {
      const poi = findPick(pick, catalog.pois || []) || pickedPoi(pick, portId);
      return poi && { ...poi, curated: true, ...(pick.gem ? { gem: true } : {}) };
    })
    .filter(Boolean);
}

export function selectCurationCandidates(catalog, maxCandidates = 220) {
  const curated = curatedPicks(catalog);
  const curatedIds = new Set(curated.map(poi => poi.sourceId));
  const source = (catalog.pois || []).filter(poi => isVisitorRelevantPoi(poi) && !curatedIds.has(poi.sourceId));
  const byCategory = new Map();
  for (const poi of source) {
    if (!byCategory.has(poi.category)) byCategory.set(poi.category, []);
    byCategory.get(poi.category).push(poi);
  }
  for (const [category, items] of byCategory.entries()) byCategory.set(category, ranked(items));

  const scale = Math.min(1, maxCandidates / 220);
  const selected = [];
  const seen = new Set();
  // Each port's best-known landmarks go in first, whatever their category or how sparse their details are.
  // Memorials are skipped here because their Wikidata link often describes the person commemorated.
  const landmarkIds = new Set();
  const landmarks = source
    .filter(poi => fame(poi) >= LANDMARK_MIN_FAME && poi.subcategory !== 'memorial' && poi.category !== 'essentials')
    .sort((a, b) => fame(b) - fame(a) || distanceForCuration(a) - distanceForCuration(b));
  for (const poi of landmarks) {
    if (landmarkIds.size >= MAX_LANDMARKS) break;
    const id = wikidataId(poi) || poi.sourceId;
    if (landmarkIds.has(id)) continue;
    landmarkIds.add(id);
    selected.push(poi);
    seen.add(poi.sourceId);
  }
  for (const [category, baseTarget] of Object.entries(CATEGORY_BASE_TARGETS)) {
    const target = Math.round(baseTarget * scale);
    // No single type (museum, park, mall, ...) may take more than about a third of a category.
    const typeLimit = Math.max(2, Math.ceil(target * 0.35));
    const typeCounts = {};
    for (const poi of (byCategory.get(category) || [])) {
      if (selected.filter(item => item.category === category).length >= target) break;
      if (seen.has(poi.sourceId)) continue;
      if ((typeCounts[poi.subcategory] || 0) >= typeLimit && fame(poi) < WORLD_FAMOUS) continue;
      selected.push(poi);
      seen.add(poi.sourceId);
      typeCounts[poi.subcategory] = (typeCounts[poi.subcategory] || 0) + 1;
    }
  }

  const remainingSlots = Math.min(Math.round(FLEXIBLE_SLOTS * scale) + Math.max(0, maxCandidates - 220), maxCandidates - selected.length);
  if (remainingSlots > 0) {
    const categoryCounts = Object.fromEntries(Object.keys(CATEGORY_BASE_TARGETS).map(category => [category, selected.filter(poi => poi.category === category).length]));
    const typeCounts = {};
    for (const poi of selected) typeCounts[poi.subcategory] = (typeCounts[poi.subcategory] || 0) + 1;
    const remaining = ranked(source.filter(poi => !seen.has(poi.sourceId)));
    for (const poi of remaining) {
      if (selected.length >= maxCandidates) break;
      const categoryLimit = Math.round((CATEGORY_MAXIMUMS[poi.category] || maxCandidates) * scale);
      if ((categoryCounts[poi.category] || 0) >= categoryLimit) continue;
      if ((typeCounts[poi.subcategory] || 0) >= Math.max(2, Math.ceil(categoryLimit * 0.35)) && fame(poi) < WORLD_FAMOUS) continue;
      typeCounts[poi.subcategory] = (typeCounts[poi.subcategory] || 0) + 1;
      selected.push(poi);
      seen.add(poi.sourceId);
      categoryCounts[poi.category] = (categoryCounts[poi.category] || 0) + 1;
    }
  }

  // Curated picks come on top of the rule-based shortlist rather than displacing it.
  return [...curated, ...selected.slice(0, maxCandidates)]
    .map(poi => (fame(poi) ? { ...poi, fame: fame(poi) } : poi));
}
