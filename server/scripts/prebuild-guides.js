#!/usr/bin/env node

// Builds guides for ports that have none, best-known ports first, and stops before a month's Google search
// budget runs out. Run on the server:
//   node server/scripts/prebuild-guides.js --budget 4500 [--limit 20] [--dry-run]

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env') });
const { CITIES_DIR, readPorts } = await import('../src/lib/guides.js');
const { buildGuide, readCatalog } = await import('../src/lib/generation.js');
const { googleQuotaRefused, googleSearchCount } = await import('../../shared/google-places.js');

const args = process.argv.slice(2);
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const budget = Number(option('--budget'));
const limit = Number(option('--limit') || Infinity);
if (!(budget > 0)) {
  console.error('Usage: node server/scripts/prebuild-guides.js --budget <Google searches this month> [--limit <guides>] [--dry-run]');
  process.exit(1);
}

// The most a guide has needed is under 20 searches, so a new one is only started with this much budget left.
const SEARCHES_PER_GUIDE_MAX = 25;
const usagePath = path.join(CITIES_DIR, '.prebuild-usage.json');
const month = new Date().toISOString().slice(0, 7);
let used = 0;
try {
  const usage = JSON.parse(fs.readFileSync(usagePath, 'utf8'));
  if (usage.month === month) used = usage.searches;
} catch {}

const guidePath = id => path.join(CITIES_DIR, `${id}.json`);
const fame = catalog => (catalog.pois || []).reduce((sum, poi) => sum + (Number(poi.fame) || 0), 0);
const queue = readPorts()
  .filter(port => !fs.existsSync(guidePath(port.id)))
  .map(port => ({ port, catalog: readCatalog(port.id) }))
  .filter(item => item.catalog)
  .sort((a, b) => fame(b.catalog) - fame(a.catalog));

console.log(`${queue.length} ports without a guide. ${used} of ${budget} Google searches used this month.`);
if (args.includes('--dry-run')) {
  queue.slice(0, 25).forEach(({ port, catalog }, index) => console.log(`${index + 1}. ${port.id} (fame ${fame(catalog)})`));
  process.exit(0);
}

let built = 0;
for (const { port, catalog } of queue) {
  if (built >= limit || used + SEARCHES_PER_GUIDE_MAX > budget) break;
  const before = googleSearchCount();
  await buildGuide(port.id, port, catalog);
  used += googleSearchCount() - before;
  fs.writeFileSync(usagePath, JSON.stringify({ month, searches: used }, null, 2));

  if (googleQuotaRefused()) {
    // The guide is missing Google checks, so it is removed to be built again once the quota resets.
    fs.rmSync(guidePath(port.id), { force: true });
    const ports = readPorts();
    const entry = ports.find(item => item.id === port.id);
    if (entry?.generated) {
      entry.generated = false;
      fs.writeFileSync(path.join(CITIES_DIR, 'ports.json'), JSON.stringify(ports, null, 2));
    }
    console.log(`Google refused searches for quota while building ${port.id}. Stopped; run again after the quota resets.`);
    break;
  }
  if (fs.existsSync(guidePath(port.id))) built += 1;
  console.log(`${fs.existsSync(guidePath(port.id)) ? 'Built' : 'Failed'} ${port.id}: ${googleSearchCount() - before} searches, ${used} this month.`);
}
console.log(`Done: ${built} guides built, ${used} of ${budget} Google searches used this month.`);
