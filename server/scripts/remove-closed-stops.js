#!/usr/bin/env node

// Removes stops from existing guides when their own website says they have closed for good, the same check new
// builds run. Without --apply it only lists them. Run on the server:
//   node server/scripts/remove-closed-stops.js [--apply]

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env') });
const { CITIES_DIR, readPorts } = await import('../src/lib/guides.js');
const { removeClosedStops } = await import('../../shared/website-descriptions.js');

const apply = process.argv.includes('--apply');
let removed = 0;
for (const port of readPorts()) {
  const file = path.join(CITIES_DIR, `${port.id}.json`);
  if (!fs.existsSync(file)) continue;
  const modified = fs.statSync(file).mtimeMs;
  const guide = JSON.parse(fs.readFileSync(file, 'utf8'));
  const closed = await removeClosedStops(guide);
  if (!closed.length) continue;
  removed += closed.length;
  console.log(`${port.id}: ${closed.join(', ')}`);
  // A guide the server rebuilt meanwhile has had its own check.
  if (!apply || fs.statSync(file).mtimeMs !== modified) continue;
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(guide, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}
console.log(`${removed} closed stops ${apply ? 'removed' : 'found (run with --apply to remove them)'}.`);
