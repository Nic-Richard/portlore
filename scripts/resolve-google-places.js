#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { discoverGoogleCruiseTerminals, resolveCatalogGooglePlaces } from '../shared/google-places.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CITIES_DIR = path.join(ROOT, 'cities');
const POI_DIR = path.join(CITIES_DIR, 'poi');
const CACHE_PATH = path.join(CITIES_DIR, '.google-place-id-cache.json');
config({ path: path.join(ROOT, '.env') });

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const all = args.includes('--all');
  const limitArg = args.find(arg => arg.startsWith('--limit='));
  const limit = limitArg ? Math.max(1, Number.parseInt(limitArg.split('=')[1], 10)) : Infinity;
  const id = args.find(arg => !arg.startsWith('--')) || '';
  return { force, all, limit, id };
}

async function main() {
  if (!process.env.GOOGLE_MAPS_API_KEY) throw new Error('GOOGLE_MAPS_API_KEY is not set in .env');
  const { force, all, limit, id } = parseArgs();
  if (!all && !id) {
    throw new Error('Usage: node scripts/resolve-google-places.js <port-id> [--force]\n       node scripts/resolve-google-places.js --all [--limit=10] [--force]');
  }

  const ports = readJson(path.join(CITIES_DIR, 'ports.json'));
  let selected = all ? ports : ports.filter(port => port.id === id);
  selected = selected.slice(0, limit);
  if (!selected.length) throw new Error(`No matching port found for ${id || '--all'}`);

  let poiMatches = 0;
  let terminalMatches = 0;
  for (let index = 0; index < selected.length; index += 1) {
    const port = selected[index];
    const catalogPath = path.join(POI_DIR, `${port.id}.json`);
    if (!fs.existsSync(catalogPath)) {
      console.log(`[${index + 1}/${selected.length}] ${port.id}: no catalog`);
      continue;
    }
    const catalog = readJson(catalogPath);
    console.log(`[${index + 1}/${selected.length}] Resolving ${port.city}, ${port.country}...`);
    const matches = await resolveCatalogGooglePlaces(port, catalog, {
      apiKey: process.env.GOOGLE_MAPS_API_KEY,
      cachePath: CACHE_PATH,
      force,
      concurrency: 3,
    });
    const pois = Object.keys(matches.pois).length;
    const discoveredTerminals = await discoverGoogleCruiseTerminals(port, catalog, {
      apiKey: process.env.GOOGLE_MAPS_API_KEY,
      cachePath: CACHE_PATH,
      force,
    });
    const terminals = discoveredTerminals.length;
    poiMatches += pois;
    terminalMatches += terminals;
    console.log(`  matched ${pois}/${catalog.pois.length} POIs and discovered ${terminals} cruise terminal(s)`);
  }

  console.log(`Done. Matched ${poiMatches} POIs and discovered ${terminalMatches} cruise terminals.`);
  console.log(`Place IDs cached in cities/.google-place-id-cache.json`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
