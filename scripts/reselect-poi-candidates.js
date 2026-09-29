#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { POI_CATALOG_SCHEMA_VERSION } from '../shared/poi-curation.js';
import { gemSuggestions, selectCurationCandidates } from '../shared/poi-selection.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.join(ROOT, 'cities', 'poi-raw');
const OUT_DIR = path.join(ROOT, 'cities', 'poi');
const CANDIDATE_COUNT = 80;
const categories = ['attraction', 'food_drink', 'shopping', 'outdoors', 'essentials'];

function counts(items) {
  return Object.fromEntries(categories.map(category => [category, items.filter(item => item.category === category).length]));
}

const portsArg = process.argv.indexOf('--ports');
const only = portsArg > -1 ? new Set(String(process.argv[portsArg + 1] || '').split(',').filter(Boolean)) : null;

if (!fs.existsSync(RAW_DIR)) throw new Error('cities/poi-raw does not exist. Build the raw catalogs first.');
fs.mkdirSync(OUT_DIR, { recursive: true });

let updated = 0;
for (const file of fs.readdirSync(RAW_DIR).filter(name => name.endsWith('.json'))) {
  if (only && !only.has(path.basename(file, '.json'))) continue;
  const raw = JSON.parse(fs.readFileSync(path.join(RAW_DIR, file), 'utf8'));
  const outPath = path.join(OUT_DIR, file);
  const existing = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {};
  const candidates = selectCurationCandidates(raw, CANDIDATE_COUNT);
  // Terminals come from build-port-list; raw files only carry the port anchor.
  const catalog = {
    defaultTerminalId: raw.defaultTerminalId,
    terminal: raw.terminal,
    terminals: raw.terminals,
    ...existing,
    schemaVersion: POI_CATALOG_SCHEMA_VERSION,
    catalogType: 'curation-candidates',
    source: raw.source,
    sourceExtract: raw.sourceExtract,
    radiusMeters: raw.radiusMeters,
    port: raw.port,
    portAnchor: raw.portAnchor,
    generatedAt: new Date().toISOString(),
    counts: counts(candidates),
    gemSuggestions: gemSuggestions(raw.port?.id),
    pois: candidates,
  };
  fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2));
  updated += 1;
  console.log(`${raw.port?.id || file}: ${candidates.length} candidates ${JSON.stringify(catalog.counts)}`);
}
console.log(`Written ${updated} candidate catalog(s).`);
