#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import https from 'https';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { POI_CATALOG_SCHEMA_VERSION, selectCurationCandidates } from '../shared/poi-curation.js';
import { distanceMeters, fallbackTerminal } from '../shared/port-resolution.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORTS_FILE = path.join(ROOT, 'cities', 'ports.json');
const RAW_OUT_DIR = path.join(ROOT, 'cities', 'poi-raw');
const OUT_DIR = path.join(ROOT, 'cities', 'poi');
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_RATE_FILE = path.join(os.tmpdir(), 'portlore-nominatim-last-request');
const NOMINATIM_USER_AGENT = 'Portlore-POI-Catalog-Builder/1.0 (terminal candidate collection)';

function usage() {
  console.log('Usage: node scripts/build-poi-catalog.js --pbf <extract.osm.pbf> [--port <id>] [--radius 10000] [--terminal-candidate-radius 5000]');
}

function parseArgs(argv) {
  const args = { radius: 10000, terminalCandidateRadius: 5000 };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--pbf') args.pbf = argv[++i];
    else if (key === '--port') args.port = argv[++i];
    else if (key === '--radius') args.radius = Number(argv[++i]);
    else if (key === '--terminal-candidate-radius') args.terminalCandidateRadius = Number(argv[++i]);
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

function terminalCandidateMatches(tags, name) {
  const text = normalizedName([
    name,
    tags['name:en'],
    tags.official_name,
    tags.alt_name,
    tags.description,
    tags.operator,
  ].filter(Boolean).join(' '));
  const terminalLikeName = /cruise|crucero|cruceros|croisiere|cruzeiro|cruzeiros|kreuzfahrt|crociere|passenger terminal|passenger port|ocean terminal|maritime terminal|gare maritime|estacion maritima|terminal maritimo|terminal maritima|terminal de pasajeros|terminal passagers|旅客ターミナル|국제여객터미널|国际客运码头/.test(text);
  const matches = [];
  if (tags.cruise === 'yes') matches.push('cruise=yes');
  if (tags['terminal:cruise'] === 'yes') matches.push('terminal:cruise=yes');
  if (tags.amenity === 'ferry_terminal') matches.push('amenity=ferry_terminal');
  if (terminalLikeName) matches.push('terminal-like name');
  if (tags.passenger === 'yes' && ['pier', 'quay'].includes(tags.man_made)) matches.push(`man_made=${tags.man_made} + passenger=yes`);
  if (tags.passenger === 'yes' && (tags.harbour === 'yes' || tags['seamark:type'] === 'harbour')) matches.push('passenger harbour');
  return matches;
}

function mergeTerminalCandidates(candidates) {
  const output = [];
  for (const candidate of candidates.sort((a, b) => a.distanceFromPortMeters - b.distanceFromPortMeters || a.name.localeCompare(b.name))) {
    const duplicate = output.find(existing => {
      const sameName = normalizedName(existing.name) === normalizedName(candidate.name);
      const sameObject = candidate.osmType && candidate.osmId && existing.osmType === candidate.osmType && existing.osmId === candidate.osmId;
      return sameObject || (sameName && distanceMeters(existing.lat, existing.lng, candidate.lat, candidate.lng) < 100);
    });
    if (!duplicate) {
      output.push({
        ...candidate,
        sources: [candidate.source],
        sourceIds: [candidate.sourceId],
      });
      continue;
    }
    if (!duplicate.sources.includes(candidate.source)) duplicate.sources.push(candidate.source);
    if (!duplicate.sourceIds.includes(candidate.sourceId)) duplicate.sourceIds.push(candidate.sourceId);
    duplicate.source = duplicate.sources.join('+');
    duplicate.matchedBy = [...new Set([...duplicate.matchedBy, ...candidate.matchedBy])];
    duplicate.osmTags = { ...duplicate.osmTags, ...candidate.osmTags };
    if (!duplicate.nameEnglish && candidate.nameEnglish) duplicate.nameEnglish = candidate.nameEnglish;
    if (!duplicate.address && candidate.address) duplicate.address = candidate.address;
    if (!duplicate.displayName && candidate.displayName) duplicate.displayName = candidate.displayName;
    if (!duplicate.query && candidate.query) duplicate.query = candidate.query;
  }
  return output;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForNominatimSlot() {
  let previous = 0;
  try {
    previous = Number(fs.readFileSync(NOMINATIM_RATE_FILE, 'utf8')) || 0;
  } catch {}
  const waitMs = Math.max(0, 1100 - (Date.now() - previous));
  if (waitMs) await sleep(waitMs);
  fs.writeFileSync(NOMINATIM_RATE_FILE, String(Date.now()));
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        'User-Agent': NOMINATIM_USER_AGENT,
        Accept: 'application/json',
      },
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`invalid JSON: ${error.message}`));
        }
      });
    });
    request.setTimeout(20000, () => request.destroy(new Error('request timed out')));
    request.on('error', reject);
  });
}

async function collectNominatimCandidates(port, radius) {
  const bounds = boundsFor(Number(port.lat), Number(port.lng), radius);
  const queries = [...new Set([
    `${port.terminal || `${port.city} Port`}, ${port.city}, ${port.country}`,
    `${port.city} cruise terminal, ${port.country}`,
  ].filter(Boolean))];
  const candidates = [];

  for (const query of queries) {
    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      limit: '8',
      addressdetails: '1',
      extratags: '1',
      namedetails: '1',
      bounded: '1',
      viewbox: `${bounds.west},${bounds.north},${bounds.east},${bounds.south}`,
    });
    try {
      await waitForNominatimSlot();
      const results = await requestJson(`${NOMINATIM_URL}?${params}`);
      for (const result of Array.isArray(results) ? results : []) {
        const lat = Number(result.lat);
        const lng = Number(result.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const distance = Math.round(distanceMeters(Number(port.lat), Number(port.lng), lat, lng));
        if (distance > radius) continue;
        const details = result.namedetails || {};
        const tags = result.extratags || {};
        const name = details.name || details['name:en'] || String(result.display_name || '').split(',')[0].trim() || '(unnamed Nominatim result)';
        candidates.push({
          source: 'nominatim',
          sourceId: result.osm_type && result.osm_id ? `osm/${result.osm_type}/${result.osm_id}` : `nominatim/${result.place_id}`,
          osmType: result.osm_type || '',
          osmId: result.osm_id ? String(result.osm_id) : '',
          name,
          nameEnglish: details['name:en'] || '',
          lat: Number(lat.toFixed(7)),
          lng: Number(lng.toFixed(7)),
          distanceFromPortMeters: distance,
          address: result.display_name || '',
          displayName: result.display_name || '',
          query,
          matchedBy: [`Nominatim query: ${query}`],
          osmTags: Object.fromEntries(Object.entries(tags).filter(([key]) => [
            'amenity', 'man_made', 'harbour', 'seamark:type', 'cruise', 'terminal:cruise',
            'passenger', 'ferry', 'route', 'public_transport', 'building', 'operator', 'description',
            'official_name', 'alt_name', 'industrial', 'cargo',
          ].includes(key))),
        });
      }
    } catch (error) {
      console.warn(`${port.id}: Nominatim candidate search failed for "${query}": ${error.message}`);
    }
  }
  return candidates;
}

function collectTerminalCandidates(pbf, port, radius, tmp) {
  const bounds = boundsFor(Number(port.lat), Number(port.lng), radius);
  const extract = path.join(tmp, 'terminal-candidate-area.osm.pbf');
  const filtered = path.join(tmp, 'terminal-candidates.osm.pbf');
  const geojson = path.join(tmp, 'terminal-candidates.geojsonseq');
  const bbox = `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`;

  run('osmium', ['extract', '--bbox', bbox, '--overwrite', '-o', extract, pbf]);
  run('osmium', ['tags-filter', '--overwrite', '-o', filtered, extract,
    'nwr/cruise=yes',
    'nwr/terminal:cruise=yes',
    'nwr/amenity=ferry_terminal',
    'nwr/man_made=pier,quay',
    'nwr/harbour=yes',
    'nwr/seamark:type=harbour',
    'nwr/name~cruise|crucero|cruceros|croisiere|cruzeiro|cruzeiros|kreuzfahrt|crociere|passenger terminal|passenger port|ocean terminal|maritime terminal|gare maritime|estacion maritima|terminal maritimo|terminal maritima|terminal de pasajeros|terminal passagers|旅客ターミナル|국제여객터미널|国际客运码头,i',
  ]);
  run('osmium', ['export', '--overwrite', '-f', 'geojsonseq', '-o', geojson, filtered]);

  const candidates = [];
  for (const line of fs.readFileSync(geojson, 'utf8').split('\n')) {
    try {
      const feature = parseFeature(line);
      if (!feature) continue;
      const tags = feature.properties || {};
      const point = featurePoint(feature);
      if (!point) continue;
      const name = tags.name || tags['name:en'] || tags.official_name || '(unnamed maritime feature)';
      const distance = Math.round(distanceMeters(Number(port.lat), Number(port.lng), point.lat, point.lng));
      if (distance > radius) continue;
      const matchedBy = terminalCandidateMatches(tags, name);
      if (!matchedBy.length) continue;
      candidates.push({
        source: 'openstreetmap',
        sourceId: sourceIdFor(feature, tags, name),
        name,
        nameEnglish: tags['name:en'] || '',
        lat: Number(point.lat.toFixed(7)),
        lng: Number(point.lng.toFixed(7)),
        distanceFromPortMeters: distance,
        address: addressFor(tags),
        matchedBy,
        osmTags: Object.fromEntries(Object.entries(tags).filter(([key]) => [
          'amenity', 'man_made', 'harbour', 'seamark:type', 'cruise', 'terminal:cruise',
          'passenger', 'ferry', 'route', 'public_transport', 'building', 'operator', 'description',
          'official_name', 'alt_name', 'name:en', 'industrial', 'cargo',
        ].includes(key))),
      });
    } catch {}
  }
  return mergeTerminalCandidates(candidates);
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

async function buildForPort(pbf, port, radius, terminalCandidateRadius) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `portlore-${port.id}-`));
  const rawOutput = path.join(RAW_OUT_DIR, `${port.id}.json`);
  const output = path.join(OUT_DIR, `${port.id}.json`);
  try {
    const anchor = fallbackTerminal(port);
    if (!anchor) throw new Error(`${port.id}: invalid ports.json coordinates`);
    const localTerminalCandidates = collectTerminalCandidates(pbf, port, terminalCandidateRadius, tmp);
    const nominatimTerminalCandidates = await collectNominatimCandidates(port, terminalCandidateRadius);
    const terminalCandidates = mergeTerminalCandidates([...localTerminalCandidates, ...nominatimTerminalCandidates]);

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
    const candidates = selectCurationCandidates({ pois: normalized }, 220);
    const common = {
      generatedAt: new Date().toISOString(),
      source: 'openstreetmap',
      sourceExtract: path.basename(pbf),
      radiusMeters: radius,
      port: { id: port.id, city: port.city, country: port.country },
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
      terminalCandidateRadiusMeters: terminalCandidateRadius,
      terminalCandidates,
      counts: countByCategory(candidates),
      pois: candidates,
    };

    fs.mkdirSync(RAW_OUT_DIR, { recursive: true });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(rawOutput, JSON.stringify(rawCatalog, null, 2));
    fs.writeFileSync(output, JSON.stringify(candidateCatalog, null, 2));
    console.log(`${port.id}: ${normalized.length} raw POIs, ${candidates.length} curation candidates, ${terminalCandidates.length} terminal candidates`);
    console.log(`Written to ${path.relative(ROOT, rawOutput)} and ${path.relative(ROOT, output)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) return usage();
  if (!args.pbf || !Number.isFinite(args.radius) || args.radius <= 0 || !Number.isFinite(args.terminalCandidateRadius) || args.terminalCandidateRadius <= 0) {
    usage();
    process.exit(1);
  }
  const pbf = path.resolve(args.pbf);
  if (!fs.existsSync(pbf)) throw new Error(`PBF file not found: ${pbf}`);
  requireOsmium();
  const ports = JSON.parse(fs.readFileSync(PORTS_FILE, 'utf8'));
  const selected = args.port ? ports.filter(port => port.id === args.port) : ports;
  if (!selected.length) throw new Error(`No port found for ${args.port}`);
  for (const port of selected) await buildForPort(pbf, port, args.radius, args.terminalCandidateRadius);
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
