import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CURRENT_CITY_SCHEMA_VERSION } from '../../../shared/poi-curation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CITIES_DIR = path.join(__dirname, '..', '..', '..', 'cities');

export function readPorts() {
  return JSON.parse(fs.readFileSync(path.join(CITIES_DIR, 'ports.json'), 'utf8'));
}

// Guides from an older schema are regenerated on the next visit, so they don't count as a guide yet.
export function readGuide(id) {
  const filePath = path.join(CITIES_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return data.schemaVersion === CURRENT_CITY_SCHEMA_VERSION ? data : null;
  } catch {
    return null;
  }
}

export function listGuideIds() {
  return fs.readdirSync(CITIES_DIR)
    .filter(name => name.endsWith('.json') && name !== 'ports.json' && !name.startsWith('.'))
    .map(name => name.slice(0, -5))
    .filter(id => readGuide(id));
}
