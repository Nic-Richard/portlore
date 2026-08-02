#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORTS_FILE = path.join(ROOT, 'cities', 'ports.json');
const DEFAULT_MANIFEST = path.join(ROOT, 'cities', 'osm-extracts.json');
const DEFAULT_INDEX_URL = 'https://download.geofabrik.de/index-v1.json';
const MAX_REDIRECTS = 8;

function parseArgs(argv) {
  const args = { output: DEFAULT_MANIFEST, indexUrl: DEFAULT_INDEX_URL };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--output') args.output = path.resolve(argv[++i]);
    else if (key === '--index-url') args.indexUrl = argv[++i];
    else if (key === '--help' || key === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${key}`);
  }
  return args;
}

function usage() {
  console.log('Usage: node scripts/sync-osm-extracts.js [--output cities/osm-extracts.json] [--index-url URL]');
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${label} could not be read: ${error.message}`);
  }
}

function getJson(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) {
      reject(new Error(`Too many redirects while downloading ${url}`));
      return;
    }
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, { headers: { 'User-Agent': 'Portlore-POI-Catalog-Builder/1.0' } }, response => {
      const status = response.statusCode || 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        getJson(new URL(location, url).toString(), redirectCount + 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`Geofabrik index returned HTTP ${status}`));
        return;
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          reject(new Error(`Geofabrik index is not valid JSON: ${error.message}`));
        }
      });
    });
    request.setTimeout(120000, () => request.destroy(new Error('Geofabrik index download timed out.')));
    request.on('error', reject);
  });
}

function pointOnSegment(x, y, x1, y1, x2, y2) {
  const lengthSquared = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (lengthSquared <= 1e-20) {
    return Math.abs(x - x1) <= 1e-10 && Math.abs(y - y1) <= 1e-10;
  }

  const cross = (y - y1) * (x2 - x1) - (x - x1) * (y2 - y1);
  if (Math.abs(cross) > 1e-10) return false;
  const dot = (x - x1) * (x2 - x1) + (y - y1) * (y2 - y1);
  if (dot < 0) return false;
  return dot <= lengthSquared;
}

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (pointOnSegment(lng, lat, xi, yi, xj, yj)) return true;
    const crosses = ((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lng, lat, polygon) {
  if (!polygon.length || !pointInRing(lng, lat, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i += 1) {
    if (pointInRing(lng, lat, polygon[i])) return false;
  }
  return true;
}

function geometryContains(geometry, lng, lat) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return pointInPolygon(lng, lat, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some(polygon => pointInPolygon(lng, lat, polygon));
  return false;
}

function geometryBoundsArea(geometry) {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  const visit = value => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      minLng = Math.min(minLng, value[0]);
      maxLng = Math.max(maxLng, value[0]);
      minLat = Math.min(minLat, value[1]);
      maxLat = Math.max(maxLat, value[1]);
      return;
    }
    for (const child of value) visit(child);
  };
  visit(geometry?.coordinates);
  if (![minLng, maxLng, minLat, maxLat].every(Number.isFinite)) return Infinity;
  return Math.max(0, maxLng - minLng) * Math.max(0, maxLat - minLat);
}

function computeDepth(feature, byId, memo, active = new Set()) {
  const id = feature.properties?.id;
  if (memo.has(id)) return memo.get(id);
  if (active.has(id)) return 0;
  active.add(id);
  const parentId = feature.properties?.parent;
  const depth = parentId && byId.has(parentId) ? computeDepth(byId.get(parentId), byId, memo, active) + 1 : 0;
  active.delete(id);
  memo.set(id, depth);
  return depth;
}

function localPbfPath(feature) {
  const id = String(feature.properties.id).replace(/^\/+|\/+$/g, '');
  return `data/osm/${id}-latest.osm.pbf`;
}

function selectExtract(port, features, depthById) {
  const matches = features.filter(feature => geometryContains(feature.geometry, port.lng, port.lat));
  matches.sort((a, b) => {
    const depthDifference = depthById.get(b.properties.id) - depthById.get(a.properties.id);
    if (depthDifference) return depthDifference;
    return geometryBoundsArea(a.geometry) - geometryBoundsArea(b.geometry);
  });
  return matches[0] || null;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) return usage();

  const ports = readJson(PORTS_FILE, 'ports.json');
  if (!Array.isArray(ports)) throw new Error('ports.json must contain an array.');
  for (const port of ports) {
    if (!port?.id || !Number.isFinite(port.lat) || !Number.isFinite(port.lng)) {
      throw new Error(`Port ${port?.id || '(unknown)'} is missing valid coordinates.`);
    }
  }

  console.log(`Downloading Geofabrik extract index from ${args.indexUrl}`);
  const index = await getJson(args.indexUrl);
  if (index?.type !== 'FeatureCollection' || !Array.isArray(index.features)) {
    throw new Error('Geofabrik index must be a GeoJSON FeatureCollection.');
  }

  const features = index.features.filter(feature =>
    feature?.properties?.id &&
    feature?.properties?.urls?.pbf &&
    ['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type)
  );
  const byId = new Map(features.map(feature => [feature.properties.id, feature]));
  const depthById = new Map();
  for (const feature of features) computeDepth(feature, byId, depthById);

  const grouped = new Map();
  const unresolved = [];
  for (const port of ports) {
    const feature = selectExtract(port, features, depthById);
    if (!feature) {
      unresolved.push(port.id);
      continue;
    }
    const id = feature.properties.id;
    if (!grouped.has(id)) {
      grouped.set(id, {
        id,
        pbf: localPbfPath(feature),
        url: feature.properties.urls.pbf,
        countries: new Set(),
        ports: [],
      });
    }
    const extract = grouped.get(id);
    extract.countries.add(port.country);
    extract.ports.push(port.id);
  }

  if (ports.length > 10 && grouped.size === 1) {
    const onlyExtract = [...grouped.keys()][0];
    throw new Error(`Sanity check failed: all ${ports.length} ports matched one extract (${onlyExtract}). No manifest was written.`);
  }

  const extracts = [...grouped.values()]
    .map(extract => ({
      id: extract.id,
      pbf: extract.pbf,
      url: extract.url,
      countries: [...extract.countries].sort(),
      ports: extract.ports.sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const manifest = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    sourceIndex: args.indexUrl,
    extracts,
    unresolvedPorts: unresolved.sort(),
  };

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  const temp = `${args.output}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.rmSync(args.output, { force: true });
  fs.renameSync(temp, args.output);

  console.log(`Mapped ${ports.length - unresolved.length} port(s) to ${extracts.length} Geofabrik extract(s).`);
  console.log(`Unresolved ports: ${unresolved.length}`);
  for (const portId of unresolved.slice(0, 20)) console.log(`  - ${portId}`);
  if (unresolved.length > 20) console.log(`  ...and ${unresolved.length - 20} more`);
  console.log(`Wrote ${path.relative(ROOT, args.output)}`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
