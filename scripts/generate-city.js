#!/usr/bin/env node

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import {
  buildCityCurationPrompt,
  buildCityData,
  CITY_MAX_TOKENS,
  CITY_MODEL,
  CITY_SYSTEM_PROMPT,
  CITY_TOOLS,
  POI_CATALOG_SCHEMA_VERSION,
} from '../shared/poi-curation.js';
import { discoverGoogleCruiseTerminals, resolveCatalogGooglePlaces, resolveCurationGooglePlaces } from '../shared/google-places.js';

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

function parseJsonText(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON found in model output');
  return JSON.parse(text.slice(start, end + 1));
}

async function main() {
  const cityInput = process.argv[2];
  if (!cityInput) {
    console.error('Usage: node scripts/generate-city.js <port-id or city>');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set in .env');
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

  console.log(`Enriching ${portInfo.city}, ${portInfo.country} from ${catalog.pois.length} curated POIs...`);
  const googleMatches = await resolveCatalogGooglePlaces(portInfo, catalog, {
    apiKey: process.env.GOOGLE_MAPS_API_KEY,
    cachePath: path.join(ROOT, 'cities', '.google-place-id-cache.json'),
  });

  const discoveredTerminals = await discoverGoogleCruiseTerminals(portInfo, catalog, {
    apiKey: process.env.GOOGLE_MAPS_API_KEY,
    cachePath: path.join(ROOT, 'cities', '.google-place-id-cache.json'),
  });
  console.log(`Google terminal discovery for ${portInfo.id}: ${discoveredTerminals.length} terminal(s)`);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: CITY_MODEL,
    max_tokens: CITY_MAX_TOKENS,
    system: CITY_SYSTEM_PROMPT,
    tools: CITY_TOOLS,
    messages: [{ role: 'user', content: buildCityCurationPrompt(portInfo, catalog, googleMatches) }],
  });
  const usage = response.usage || {};
  console.log(`Claude response: stop_reason=${response.stop_reason || 'unknown'}, input_tokens=${usage.input_tokens || 0}, output_tokens=${usage.output_tokens || 0}, max_tokens=${CITY_MAX_TOKENS}`);

  const text = response.content.filter(block => block.type === 'text').map(block => block.text).join('');
  const curation = parseJsonText(text);
  const resolvedCuration = await resolveCurationGooglePlaces(portInfo, catalog, curation, {
    apiKey: process.env.GOOGLE_MAPS_API_KEY,
    cachePath: path.join(ROOT, 'cities', '.google-place-id-cache.json'),
    catalogMatches: googleMatches,
  });
  const data = buildCityData(portInfo, catalog, resolvedCuration, googleMatches, discoveredTerminals);

  const outPath = path.join(ROOT, 'cities', `${portInfo.id}.json`);
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));

  const cost = (((usage.input_tokens || 0) / 1e6) * 1 + ((usage.output_tokens || 0) / 1e6) * 5).toFixed(4);
  console.log(`Written to cities/${portInfo.id}.json`);
  console.log(`Selected ${data.places.length} stops and ${data.hiddenGems.length} hidden gems.`);
  console.log(`Estimated model cost: $${cost}`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
