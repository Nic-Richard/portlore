#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_FILE = path.join(ROOT, 'data', 'cruise-ports.json');
const PORTS_FILE = path.join(ROOT, 'cities', 'ports.json');
const POI_DIR = path.join(ROOT, 'cities', 'poi');
const REBUILD_THRESHOLD_METERS = 3000;

function usage() {
  console.log(`Usage: node scripts/build-port-list.js [options]

Builds cities/ports.json from data/cruise-ports.json and attaches each port's terminals to its POI catalog.

Options:
  --prune     Delete catalogs for ports that are no longer in the list
  --dry-run   Report what would change without writing files
  -h, --help  Show this help`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function haversineMeters(a, b) {
  const toRadians = value => (value * Math.PI) / 180;
  const lat1 = toRadians(Number(a.lat));
  const lat2 = toRadians(Number(b.lat));
  const deltaLat = lat2 - lat1;
  const deltaLng = toRadians(Number(b.lng) - Number(a.lng));
  const value = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value)));
}

// Guides centre on the main terminal, or on the city for gateway ports where ships dock far from town.
function centreFor(port) {
  const centre = port.guideCentre || port.terminals[0];
  return { lat: centre.lat, lng: centre.lng };
}

function portListEntry(port) {
  const centre = centreFor(port);
  return {
    id: port.id,
    city: port.city,
    country: port.country,
    terminal: port.terminals[0].name,
    address: `${port.city}, ${port.country}`,
    lat: centre.lat,
    lng: centre.lng,
    region: port.region,
    generated: false,
  };
}

function withTerminals(catalog, port) {
  const terminals = port.terminals.map(terminal => ({ ...terminal, sourceId: terminal.id, verified: true }));
  return {
    ...catalog,
    port: { ...(catalog.port || {}), id: port.id, city: port.city, country: port.country },
    terminals,
    terminal: terminals[0],
    defaultTerminalId: terminals[0].id,
    terminalResolution: { status: 'resolved', method: 'cruise-ports', verified: true, notes: port.note || '' },
  };
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('-h') || args.has('--help')) return usage();
  const dryRun = args.has('--dry-run');

  const { ports } = readJson(SOURCE_FILE);
  const ids = new Set();
  for (const port of ports) {
    if (!port.id || ids.has(port.id)) throw new Error(`Missing or duplicate port id: ${port.id}`);
    if (!Array.isArray(port.terminals) || !port.terminals.length) throw new Error(`${port.id} has no terminals`);
    ids.add(port.id);
  }

  const missing = [];
  const rebuild = [];
  let updated = 0;
  for (const port of ports) {
    const file = path.join(POI_DIR, `${port.id}.json`);
    if (!fs.existsSync(file)) {
      missing.push(port.id);
      continue;
    }
    const catalog = readJson(file);
    const moved = catalog.portAnchor ? haversineMeters(catalog.portAnchor, centreFor(port)) : 0;
    if (moved > REBUILD_THRESHOLD_METERS) rebuild.push(`${port.id} (${(moved / 1000).toFixed(1)} km)`);
    if (!dryRun) fs.writeFileSync(file, JSON.stringify(withTerminals(catalog, port), null, 2));
    updated += 1;
  }

  const orphans = fs.readdirSync(POI_DIR).filter(name => name.endsWith('.json') && !ids.has(path.basename(name, '.json')));
  if (args.has('--prune') && !dryRun) for (const name of orphans) fs.rmSync(path.join(POI_DIR, name));

  if (!dryRun) fs.writeFileSync(PORTS_FILE, `${JSON.stringify(ports.map(portListEntry), null, 2)}\n`);

  console.log(`${dryRun ? 'Would write' : 'Wrote'} ${ports.length} ports and attached terminals to ${updated} catalogs.`);
  if (missing.length) console.log(`Ports without a catalog yet (build them with build-all-poi-catalogs.js --ports): ${missing.join(', ')}`);
  if (rebuild.length) console.log(`Catalogs built around an old centre, worth rebuilding: ${rebuild.join(', ')}`);
  if (orphans.length) console.log(`${args.has('--prune') ? 'Deleted' : 'Catalogs for ports no longer listed (use --prune to delete)'}: ${orphans.join(', ')}`);
}

main();
