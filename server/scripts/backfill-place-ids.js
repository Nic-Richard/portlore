#!/usr/bin/env node

// Gives stops in existing guides a Google place ID from the free IDs-only search, without rebuilding them.
// Stops that already have one are skipped, so it can be run again to pick up where it stopped. Run on the server:
//   node server/scripts/backfill-place-ids.js [--max-searches 4000] [--dry-run]

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env') });
const { CITIES_DIR, readPorts } = await import('../src/lib/guides.js');
const { fillPlaceIds, googleIdSearchCount, googleQuotaRefused } = await import('../../shared/google-places.js');

const args = process.argv.slice(2);
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const maxSearches = Number(option('--max-searches') || 4000);
const apiKey = process.env.GOOGLE_MAPS_API_KEY;

const missing = guide => [...(guide.places || []), ...(guide.hiddenGems || [])].filter(stop => !stop.googlePlaceId).length;
const guides = readPorts()
  .map(port => path.join(CITIES_DIR, `${port.id}.json`))
  .filter(file => fs.existsSync(file));

if (args.includes('--dry-run')) {
  const total = guides.reduce((sum, file) => sum + missing(JSON.parse(fs.readFileSync(file, 'utf8'))), 0);
  console.log(`${guides.length} guides, ${total} stops without a place ID.`);
  process.exit(0);
}

let added = 0;
let updated = 0;
for (const file of guides) {
  // Each stop can take two searches (English and local name), so stop while the largest guide still fits.
  if (googleIdSearchCount() + 2 * 60 > maxSearches || googleQuotaRefused()) break;
  const modified = fs.statSync(file).mtimeMs;
  const guide = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!missing(guide)) continue;
  let count = 0;
  try {
    count = await fillPlaceIds(guide, apiKey);
  } catch (error) {
    console.warn(`${path.basename(file)}: ${error.message}`);
  }
  if (!count) continue;
  // A guide the server rebuilt meanwhile already has its own IDs, so it is left alone.
  if (fs.statSync(file).mtimeMs !== modified) continue;
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(guide, null, 2));
  fs.renameSync(`${file}.tmp`, file);
  added += count;
  updated += 1;
  console.log(`${path.basename(file, '.json')}: ${count} place IDs added`);
}
console.log(`Done: ${added} place IDs added to ${updated} guides with ${googleIdSearchCount()} free searches.`);
if (googleQuotaRefused()) console.log('Google refused searches for quota. Run again after it resets.');
