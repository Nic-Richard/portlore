#!/usr/bin/env node

// Gives stops in existing guides a Google place ID from the free IDs-only search, without rebuilding them.
// Stops that already have a checked one are skipped, so it can be run again to pick up where it stopped. IDs from the
// first, unchecked backfill ("nearby") are looked up again with the check. Run on the server:
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

const unchecked = stop => !stop.googlePlaceId || stop.googlePlaceMatchConfidence === 'nearby';
const missing = guide => [...(guide.places || []), ...(guide.hiddenGems || [])].filter(unchecked).length;
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
  // A stop can take up to six searches (three for each of its English and local names).
  if (googleIdSearchCount() + 6 * 60 > maxSearches || googleQuotaRefused()) break;
  const modified = fs.statSync(file).mtimeMs;
  const guide = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!missing(guide)) continue;
  let cleared = 0;
  for (const stop of [...(guide.places || []), ...(guide.hiddenGems || [])]) {
    if (stop.googlePlaceMatchConfidence !== 'nearby') continue;
    stop.googlePlaceId = '';
    stop.googlePlaceMatchConfidence = '';
    cleared += 1;
  }
  let count = 0;
  try {
    count = await fillPlaceIds(guide, apiKey);
  } catch (error) {
    console.warn(`${path.basename(file)}: ${error.message}`);
  }
  if (!count && !cleared) continue;
  // A guide the server rebuilt meanwhile already has its own IDs, so it is left alone.
  if (fs.statSync(file).mtimeMs !== modified) continue;
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(guide, null, 2));
  fs.renameSync(`${file}.tmp`, file);
  added += count;
  updated += 1;
  console.log(`${path.basename(file, '.json')}: ${count} place IDs added${cleared ? `, ${cleared} unchecked ones redone` : ''}`);
}
console.log(`Done: ${added} place IDs added to ${updated} guides with ${googleIdSearchCount()} free searches.`);
if (googleQuotaRefused()) console.log('Google refused searches for quota. Run again after it resets.');
