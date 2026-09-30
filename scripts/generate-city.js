#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import {
  buildCityCurationPrompt,
  buildCityData,
  POI_CATALOG_SCHEMA_VERSION,
} from '../shared/poi-curation.js';
import { curateCity, curationModel } from '../shared/curation-model.js';
import { resolveCatalogGooglePlaces, resolveCurationGooglePlaces } from '../shared/google-places.js';
import { describeFromWebsites } from '../shared/website-descriptions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
config({ path: path.join(ROOT, '.env') });

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function findPort(input) {
  const ports = JSON.parse(fs.readFileSync(path.join(ROOT, 'cities', 'ports.json'), 'utf8'));
  const wanted = normalize(input);
  const exact = ports.find(port => [port.id, `${port.city}, ${port.country}`, port.address]
    .some(value => normalize(value) === wanted));
  if (exact) return exact;
  const matches = ports.filter(port => normalize(`${port.city} ${port.country} ${port.address}`).includes(wanted));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    console.error(`Multiple ports matched "${input}". Use a port ID:`);
    matches.slice(0, 10).forEach(port => console.error(`  ${port.id} | ${port.city}, ${port.country}`));
  } else {
    console.error(`No port matched "${input}" in cities/ports.json.`);
  }
  process.exit(1);
}

async function main() {
  const cityInput = process.argv[2];
  if (!cityInput) {
    console.error('Usage: node scripts/generate-city.js <port-id or city>');
    process.exit(1);
  }
  if (!process.env.GOOGLE_MAPS_API_KEY) throw new Error('GOOGLE_MAPS_API_KEY is not set in .env');

  const portInfo = findPort(cityInput);
  const catalogPath = path.join(ROOT, 'cities', 'poi', `${portInfo.id}.json`);
  if (!fs.existsSync(catalogPath)) {
    throw new Error(`Missing POI catalog: cities/poi/${portInfo.id}.json. Run build-poi-catalog.js first.`);
  }
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  if (catalog.schemaVersion !== POI_CATALOG_SCHEMA_VERSION || !Array.isArray(catalog.pois)) {
    throw new Error(`POI catalog for ${portInfo.id} is missing, outdated, or too small.`);
  }

  console.log(`Curating ${portInfo.city}, ${portInfo.country} from ${catalog.pois.length} POIs with ${curationModel().model}...`);
  const result = await curateCity(buildCityCurationPrompt(portInfo, catalog));
  console.log(`Model response: stop_reason=${result.stopReason}, attempts=${result.attempts}, input_tokens=${result.inputTokens}, output_tokens=${result.outputTokens}`);
  const curation = result.curation;
  const googleMatches = await resolveCatalogGooglePlaces(portInfo, catalog, {
    apiKey: process.env.GOOGLE_MAPS_API_KEY,
    cachePath: path.join(ROOT, 'cities', '.google-place-id-cache.json'),
    onlyIds: (Array.isArray(curation.places) ? curation.places : []).map(item => item?.sourceId).filter(Boolean),
  });
  const resolvedCuration = await resolveCurationGooglePlaces(portInfo, catalog, curation, {
    apiKey: process.env.GOOGLE_MAPS_API_KEY,
    cachePath: path.join(ROOT, 'cities', '.google-place-id-cache.json'),
    catalogMatches: googleMatches,
  });
  const data = { ...buildCityData(portInfo, catalog, resolvedCuration, googleMatches), model: result.model };
  let websites = { checked: 0, rewritten: 0, dead: 0, cost: 0 };
  try {
    websites = await describeFromWebsites(data, catalog);
  } catch (error) {
    console.warn(`Website descriptions failed: ${error.message}`);
  }
  console.log(`Websites: checked ${websites.checked}, rewrote ${websites.rewritten}, dropped ${websites.dead} dead links.`);

  const outPath = path.join(ROOT, 'cities', `${portInfo.id}.json`);
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));

  console.log(`Written to cities/${portInfo.id}.json`);
  console.log(`Selected ${data.places.length} stops and ${data.hiddenGems.length} hidden gems.`);
  console.log(`Estimated model cost: $${(result.cost + websites.cost).toFixed(4)}`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
