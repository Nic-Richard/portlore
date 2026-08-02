#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const portsPath = path.join(root, 'cities', 'ports.json');
const poiDir = path.join(root, 'cities', 'poi');

const ports = JSON.parse(fs.readFileSync(portsPath, 'utf8'));
if (!Array.isArray(ports) || ports.length === 0) throw new Error('cities/ports.json must contain a non-empty array.');

const ids = new Set();
for (const port of ports) {
  if (!port?.id || !Number.isFinite(port.lat) || !Number.isFinite(port.lng)) {
    throw new Error(`Invalid port entry: ${port?.id || '(missing id)'}`);
  }
  if (ids.has(port.id)) throw new Error(`Duplicate port id: ${port.id}`);
  ids.add(port.id);
}

const catalogFiles = fs.readdirSync(poiDir).filter(name => name.endsWith('.json')).sort();
const catalogIds = new Set(catalogFiles.map(name => path.basename(name, '.json')));

const missing = [...ids].filter(id => !catalogIds.has(id));
const orphaned = [...catalogIds].filter(id => !ids.has(id));
if (missing.length || orphaned.length) {
  const details = [];
  if (missing.length) details.push(`Missing catalogs: ${missing.join(', ')}`);
  if (orphaned.length) details.push(`Orphaned catalogs: ${orphaned.join(', ')}`);
  throw new Error(details.join('\n'));
}

for (const file of catalogFiles) {
  const catalog = JSON.parse(fs.readFileSync(path.join(poiDir, file), 'utf8'));
  if (!Array.isArray(catalog.pois)) throw new Error(`${file} does not contain a POI array.`);
}

console.log(`Validated ${ports.length} ports and ${catalogFiles.length} POI catalogs.`);
