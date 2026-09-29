#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { POI_CATALOG_SCHEMA_VERSION } from '../shared/poi-curation.js';
import { gemSuggestions, selectCurationCandidates } from '../shared/poi-selection.js';
import { distanceMeters, fallbackTerminal } from '../shared/port-resolution.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORTS_FILE = path.join(ROOT, 'cities', 'ports.json');
const RAW_OUT_DIR = path.join(ROOT, 'cities', 'poi-raw');
const OUT_DIR = path.join(ROOT, 'cities', 'poi');

function usage() {
  console.log('Usage: node scripts/build-poi-catalog.js --pbf <extract.osm.pbf> [--port <id>] [--radius 10000]');
}

function parseArgs(argv) {
  const args = { radius: 10000 };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--pbf') args.pbf = argv[++i];
    else if (key === '--port') args.port = argv[++i];
    else if (key === '--radius') args.radius = Number(argv[++i]);
    else if (key === '--help' || key === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${key}`);
  }
  return args;
}

function requireOsmium() {
  const result = spawnSync('osmium', ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('osmium-tool is required. Install it locally, then rerun this command.');
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

// Enough for the guide model to build a varied port day without drowning it in minor places.
const CANDIDATE_COUNT = 80;

function toRadians(value) { return value * Math.PI / 180; }

function boundsFor(lat, lng, radius) {
  const latDelta = radius / 111000;
  const lngDelta = radius / (111000 * Math.max(0.2, Math.cos(toRadians(lat))));
  return { south: lat - latDelta, west: lng - lngDelta, north: lat + latDelta, east: lng + lngDelta };
}

function collectCoordinates(value, output = []) {
  if (!Array.isArray(value)) return output;
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    output.push(value);
    return output;
  }
  for (const child of value) collectCoordinates(child, output);
  return output;
}

function featurePoint(feature) {
  const geometry = feature.geometry;
  if (!geometry) return null;
  if (geometry.type === 'Point') return { lng: geometry.coordinates[0], lat: geometry.coordinates[1] };
  const coordinates = collectCoordinates(geometry.coordinates);
  if (!coordinates.length) return null;
  let minLng = Infinity; let maxLng = -Infinity; let minLat = Infinity; let maxLat = -Infinity;
  for (const [lng, lat] of coordinates) {
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }
  return { lng: (minLng + maxLng) / 2, lat: (minLat + maxLat) / 2 };
}

function parseFeature(line) {
  const cleaned = line.replace(/^\x1e/, '').trim();
  return cleaned ? JSON.parse(cleaned) : null;
}

function normalizedName(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function addressFor(tags) {
  if (tags['addr:full']) return tags['addr:full'];
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  return [street, tags['addr:city'], tags['addr:state'], tags['addr:postcode'], tags['addr:country']].filter(Boolean).join(', ');
}

function websiteFor(tags) { return tags.website || tags['contact:website'] || tags.url || ''; }
function phoneFor(tags) { return tags.phone || tags['contact:phone'] || ''; }

function sourceIdFor(feature, tags, name) {
  const rawId = tags['@id'] || feature.id || tags.id;
  if (rawId) return String(rawId).includes('/') ? String(rawId) : `osm/${rawId}`;
  const fingerprint = JSON.stringify({
    geometry: feature.geometry || null,
    name,
    tags: Object.fromEntries(Object.entries(tags).sort(([a], [b]) => a.localeCompare(b))),
  });
  return `osm/generated/${crypto.createHash('sha1').update(fingerprint).digest('hex').slice(0, 20)}`;
}

const FOOD = new Set(['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'food_court', 'ice_cream', 'biergarten']);
const ESSENTIAL = new Set(['pharmacy', 'clinic', 'hospital', 'bank', 'atm', 'toilets', 'drinking_water', 'post_office', 'car_rental', 'bicycle_rental']);

function categoryFor(tags) {
  if (FOOD.has(tags.amenity)) return ['food_drink', tags.amenity];
  if (tags.shop) return ['shopping', tags.shop];
  if (tags.craft) return ['shopping', tags.craft];
  if (tags.amenity === 'marketplace') return ['shopping', 'marketplace'];
  if (ESSENTIAL.has(tags.amenity) || tags.tourism === 'information') return ['essentials', tags.amenity || 'visitor_information'];
  if (tags.leisure || tags.natural || tags.tourism === 'viewpoint') return ['outdoors', tags.natural || tags.leisure || tags.tourism];
  if (tags.man_made === 'lighthouse') return ['attraction', 'lighthouse'];
  if (tags.tourism || tags.historic || tags.place === 'square') return ['attraction', tags.tourism || tags.historic || tags.place];
  return null;
}

function normalizeFeature(feature, anchor, radius) {
  const tags = feature.properties || {};
  const name = tags.name || tags['name:en'];
  if (!name) return null;
  if (tags.disused === 'yes' || tags.abandoned === 'yes' || tags.demolished === 'yes' || tags.closed === 'yes') return null;
  const category = categoryFor(tags);
  if (!category) return null;
  const point = featurePoint(feature);
  if (!point) return null;
  const distance = Math.round(distanceMeters(anchor.lat, anchor.lng, point.lat, point.lng));
  if (distance > radius) return null;
  const cuisine = String(tags.cuisine || '').split(/[;,]/).map(value => value.trim()).filter(Boolean);

  return {
    source: 'openstreetmap',
    sourceId: sourceIdFor(feature, tags, name),
    name,
    nameEnglish: tags['name:en'] || '',
    category: category[0],
    subcategory: category[1] || category[0],
    lat: Number(point.lat.toFixed(7)),
    lng: Number(point.lng.toFixed(7)),
    distanceFromTerminalMeters: distance,
    distanceFromDefaultTerminalMeters: distance,
    minDistanceFromAnyTerminalMeters: distance,
    nearestTerminalId: anchor.id,
    address: addressFor(tags),
    openingHours: tags.opening_hours || '',
    website: websiteFor(tags),
    phone: phoneFor(tags),
    cuisine,
    wheelchair: tags.wheelchair || '',
    brand: tags.brand || '',
    description: tags.description || '',
    wikidata: tags.wikidata || '',
    wikipedia: tags.wikipedia || '',
    osmTags: Object.fromEntries(Object.entries(tags)
      .filter(([key]) => ['amenity', 'tourism', 'historic', 'leisure', 'natural', 'shop', 'craft', 'man_made', 'place'].includes(key))),
  };
}

function quality(poi) {
  return [poi.address, poi.openingHours, poi.website, poi.phone, poi.cuisine.length, poi.description]
    .filter(Boolean).length * 10 - poi.minDistanceFromAnyTerminalMeters / 500;
}

function dedupe(pois) {
  const groups = new Map();
  for (const poi of pois) {
    const key = normalizedName(poi.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(poi);
  }
  const output = [];
  for (const items of groups.values()) {
    items.sort((a, b) => quality(b) - quality(a));
    const kept = [];
    for (const poi of items) {
      if (kept.some(other => distanceMeters(poi.lat, poi.lng, other.lat, other.lng) < 60)) continue;
      kept.push(poi);
    }
    output.push(...kept);
  }
  return output.sort((a, b) => a.minDistanceFromAnyTerminalMeters - b.minDistanceFromAnyTerminalMeters || a.name.localeCompare(b.name));
}

function countByCategory(pois) {
  return Object.fromEntries(['attraction', 'food_drink', 'shopping', 'outdoors', 'essentials']
    .map(category => [category, pois.filter(poi => poi.category === category).length]));
}

async function buildForPort(pbf, port, radius) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `portlore-${port.id}-`));
  const rawOutput = path.join(RAW_OUT_DIR, `${port.id}.json`);
  const output = path.join(OUT_DIR, `${port.id}.json`);
  try {
    const anchor = fallbackTerminal(port);
    if (!anchor) throw new Error(`${port.id}: invalid ports.json coordinates`);

    const bounds = boundsFor(anchor.lat, anchor.lng, radius);
    const extract = path.join(tmp, 'area.osm.pbf');
    const filtered = path.join(tmp, 'pois.osm.pbf');
    const geojson = path.join(tmp, 'pois.geojsonseq');
    const bbox = `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`;

    run('osmium', ['extract', '--bbox', bbox, '--overwrite', '-o', extract, pbf]);
    run('osmium', ['tags-filter', '--overwrite', '-o', filtered, extract,
      'nwr/amenity=restaurant,cafe,bar,pub,fast_food,food_court,ice_cream,biergarten,marketplace,pharmacy,clinic,hospital,bank,atm,toilets,drinking_water,post_office,car_rental,bicycle_rental',
      'nwr/tourism=attraction,museum,gallery,viewpoint,information,aquarium,zoo,theme_park,artwork',
      'nwr/historic',
      'nwr/leisure=park,garden,nature_reserve,marina,playground',
      'nwr/natural=beach,waterfall,peak,spring',
      'nwr/shop',
      'nwr/craft',
      'nwr/man_made=lighthouse',
      'nwr/place=square',
    ]);
    run('osmium', ['export', '--overwrite', '-f', 'geojsonseq', '-o', geojson, filtered]);

    const pois = [];
    for (const line of fs.readFileSync(geojson, 'utf8').split('\n')) {
      try {
        const feature = parseFeature(line);
        if (!feature) continue;
        const poi = normalizeFeature(feature, anchor, radius);
        if (poi) pois.push(poi);
      } catch {}
    }

    const normalized = dedupe(pois);
    const candidates = selectCurationCandidates({ port: { id: port.id }, pois: normalized }, CANDIDATE_COUNT);
    const common = {
      generatedAt: new Date().toISOString(),
      source: 'openstreetmap',
      sourceExtract: path.basename(pbf),
      radiusMeters: radius,
      port: { id: port.id, city: port.city, country: port.country },
      portAnchor: anchor,
      defaultTerminalId: anchor.id,
      terminal: anchor,
      terminals: [anchor],
    };
    const rawCatalog = {
      schemaVersion: 1,
      catalogType: 'raw-pois',
      ...common,
      counts: countByCategory(normalized),
      pois: normalized,
    };
    const candidateCatalog = {
      schemaVersion: POI_CATALOG_SCHEMA_VERSION,
      catalogType: 'curation-candidates',
      ...common,
      counts: countByCategory(candidates),
      gemSuggestions: gemSuggestions(port.id),
      pois: candidates,
    };

    fs.mkdirSync(RAW_OUT_DIR, { recursive: true });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(rawOutput, JSON.stringify(rawCatalog, null, 2));
    fs.writeFileSync(output, JSON.stringify(candidateCatalog, null, 2));
    console.log(`${port.id}: ${normalized.length} raw POIs, ${candidates.length} curation candidates`);
    console.log(`Written to ${path.relative(ROOT, rawOutput)} and ${path.relative(ROOT, output)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) return usage();
  if (!args.pbf || !Number.isFinite(args.radius) || args.radius <= 0) {
    usage();
    process.exit(1);
  }
  const pbf = path.resolve(args.pbf);
  if (!fs.existsSync(pbf)) throw new Error(`PBF file not found: ${pbf}`);
  requireOsmium();
  const ports = JSON.parse(fs.readFileSync(PORTS_FILE, 'utf8'));
  const selected = args.port ? ports.filter(port => port.id === args.port) : ports;
  if (!selected.length) throw new Error(`No port found for ${args.port}`);
  for (const port of selected) await buildForPort(pbf, port, args.radius);
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
