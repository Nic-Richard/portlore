#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { POI_CATALOG_SCHEMA_VERSION, selectCurationCandidates } from '../shared/poi-curation.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.join(ROOT, 'cities', 'poi-raw');
const OUT_DIR = path.join(ROOT, 'cities', 'poi');
const categories = ['attraction', 'food_drink', 'shopping', 'outdoors', 'essentials'];

function counts(items) {
  return Object.fromEntries(categories.map(category => [category, items.filter(item => item.category === category).length]));
}

if (!fs.existsSync(RAW_DIR)) throw new Error('cities/poi-raw does not exist. Build the raw catalogs first.');
const existingTerminalData = new Map();
if (fs.existsSync(OUT_DIR)) {
  for (const name of fs.readdirSync(OUT_DIR).filter(name => name.endsWith('.json'))) {
    try {
      const catalog = JSON.parse(fs.readFileSync(path.join(OUT_DIR, name), 'utf8'));
      existingTerminalData.set(name, {
        terminalCandidateRadiusMeters: catalog.terminalCandidateRadiusMeters,
        terminalCandidates: Array.isArray(catalog.terminalCandidates) ? catalog.terminalCandidates : [],
      });
    } catch {}
  }
}

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const files = fs.readdirSync(RAW_DIR).filter(name => name.endsWith('.json'));
let updated = 0;
for (const file of files) {
  const raw = JSON.parse(fs.readFileSync(path.join(RAW_DIR, file), 'utf8'));
  const candidates = selectCurationCandidates(raw, 220);
  const terminalData = existingTerminalData.get(file) || {};
  const catalog = {
    schemaVersion: POI_CATALOG_SCHEMA_VERSION,
    catalogType: 'curation-candidates',
    generatedAt: new Date().toISOString(),
    source: raw.source,
    sourceExtract: raw.sourceExtract,
    radiusMeters: raw.radiusMeters,
    port: raw.port,
    defaultTerminalId: raw.defaultTerminalId,
    terminal: raw.terminal,
    terminals: raw.terminals,
    terminalCandidateRadiusMeters: terminalData.terminalCandidateRadiusMeters,
    terminalCandidates: terminalData.terminalCandidates || [],
    counts: counts(candidates),
    pois: candidates,
  };
  fs.writeFileSync(path.join(OUT_DIR, file), JSON.stringify(catalog, null, 2));
  updated += 1;
  console.log(`${raw.port?.id || file}: ${candidates.length} candidates ${JSON.stringify(catalog.counts)}`);
}
console.log(`Written ${updated} candidate catalog(s).`);
