#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { CURRENT_CITY_SCHEMA_VERSION } from '../shared/poi-curation.js';

const citiesDir = path.resolve(process.argv[2] || './cities');
const portsPath = path.join(citiesDir, 'ports.json');
if (!fs.existsSync(portsPath)) process.exit(0);

const ports = JSON.parse(fs.readFileSync(portsPath, 'utf8'));
let generatedCount = 0;

for (const port of ports) {
  const filePath = path.join(citiesDir, `${port.id}.json`);
  let generated = false;
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      generated = data.schemaVersion === CURRENT_CITY_SCHEMA_VERSION;
    } catch {}
  }
  port.generated = generated;
  if (generated) generatedCount += 1;
}

fs.writeFileSync(portsPath, `${JSON.stringify(ports, null, 2)}\n`);
console.log(`Synced generated state: ${generatedCount} current guide${generatedCount === 1 ? '' : 's'}.`);
