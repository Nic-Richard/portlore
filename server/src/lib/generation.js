import fs from 'fs';
import path from 'path';
import { buildCityCurationPrompt, buildCityData, POI_CATALOG_SCHEMA_VERSION } from '../../../shared/poi-curation.js';
import { curateCity } from '../../../shared/curation-model.js';
import { resolveCatalogGooglePlaces, resolveCurationGooglePlaces } from '../../../shared/google-places.js';
import { describeFromWebsites } from '../../../shared/website-descriptions.js';
import { CITIES_DIR, readPorts } from './guides.js';
import * as logger from './logger.js';

const POI_DIR = path.join(CITIES_DIR, 'poi');
const PORTS_FILE = path.join(CITIES_DIR, 'ports.json');
const USAGE_FILE = path.join(CITIES_DIR, '.generation-usage.json');
const DAY_MS = 24 * 60 * 60 * 1000;

export const inProgress = new Set();
export const failures = new Map();
let lastGenerationStartedAt = 0;

export function getLimit(name, fallback, minimum = 1) {
  return Math.max(minimum, Number.parseInt(process.env[name] || String(fallback), 10));
}

export function readCatalog(id) {
  const catalogPath = path.join(POI_DIR, `${id}.json`);
  if (!fs.existsSync(catalogPath)) return null;
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  if (catalog.schemaVersion !== POI_CATALOG_SCHEMA_VERSION || !Array.isArray(catalog.pois)) return null;
  return catalog;
}

export function getDailyUsage() {
  const date = new Date().toISOString().slice(0, 10);
  try {
    const usage = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
    if (usage.date === date && Number.isInteger(usage.count)) return usage;
  } catch {}
  return { date, count: 0 };
}

export function cooldownRemainingMs() {
  const cooldownMs = getLimit('GENERATION_COOLDOWN_SECONDS', 60, 0) * 1000;
  return cooldownMs - (Date.now() - lastGenerationStartedAt);
}

// Counts the build against the daily limit and marks it running. Callers check the limits first.
export function claimGeneration(id) {
  const usage = getDailyUsage();
  usage.count += 1;
  fs.mkdirSync(CITIES_DIR, { recursive: true });
  fs.writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 2));
  lastGenerationStartedAt = Date.now();
  inProgress.add(id);
  failures.delete(id);
}

export function isStale(guide) {
  const maxAgeMs = getLimit('GUIDE_MAX_AGE_DAYS', 120) * DAY_MS;
  const generatedAt = Date.parse(guide?.generatedAt || '');
  return !Number.isFinite(generatedAt) || Date.now() - generatedAt > maxAgeMs;
}

// Builds a guide and writes it only once it is complete, so a failed rebuild leaves the old guide in place.
export async function buildGuide(id, portInfo, catalog) {
  try {
    const result = await curateCity(buildCityCurationPrompt(portInfo, catalog));
    logger.info(`Generated ${id}: model=${result.model}, stop_reason=${result.stopReason}, attempts=${result.attempts}, input_tokens=${result.inputTokens}, output_tokens=${result.outputTokens}, est_cost=$${result.cost.toFixed(4)}`);

    const curation = result.curation;
    // Google is only searched for the stops the model picked, not the whole shortlist.
    const googleMatches = await resolveCatalogGooglePlaces(portInfo, catalog, {
      apiKey: process.env.GOOGLE_MAPS_API_KEY,
      cachePath: path.join(CITIES_DIR, '.google-place-id-cache.json'),
      onlyIds: (Array.isArray(curation.places) ? curation.places : []).map(item => item?.sourceId).filter(Boolean),
      requireFields: true,
    });
    const resolvedCuration = await resolveCurationGooglePlaces(portInfo, catalog, curation, {
      apiKey: process.env.GOOGLE_MAPS_API_KEY,
      cachePath: path.join(CITIES_DIR, '.google-place-id-cache.json'),
      catalogMatches: googleMatches,
    });
    const data = { ...buildCityData(portInfo, catalog, resolvedCuration, googleMatches), model: result.model };
    try {
      const websites = await describeFromWebsites(data, catalog);
      logger.info(`Described ${id} from websites: checked=${websites.checked}, found=${websites.found}, searches=${websites.searches}, rewritten=${websites.rewritten}, dead=${websites.dead}, est_cost=$${websites.cost.toFixed(4)}`);
    } catch (error) {
      logger.warn(`Website descriptions failed for ${id}: ${error.message}`);
    }
    fs.writeFileSync(path.join(CITIES_DIR, `${id}.json`), JSON.stringify(data, null, 2));

    try {
      const ports = readPorts();
      const port = ports.find(item => item.id === id);
      if (port && !port.generated) {
        port.generated = true;
        fs.writeFileSync(PORTS_FILE, JSON.stringify(ports, null, 2));
      }
    } catch {}
  } catch (error) {
    logger.error(`Generation failed for ${id}:`, error.message);
    failures.set(id, error.overloaded
      ? 'The server is overloaded right now. Please try again in a few minutes.'
      : 'There was a server error building this guide. Please try again in a few minutes.');
  } finally {
    inProgress.delete(id);
  }
}

// Rebuilds an old guide in the background while visitors keep seeing it. Skips quietly when another build
// is running or a limit is reached, so a later visit tries again.
export function refreshIfStale(id, guide) {
  if (!isStale(guide) || inProgress.size > 0 || !process.env.GOOGLE_MAPS_API_KEY) return false;
  if (cooldownRemainingMs() > 0 || getDailyUsage().count >= getLimit('GENERATION_DAILY_LIMIT', 20)) return false;
  let portInfo;
  let catalog;
  try {
    portInfo = readPorts().find(port => port.id === id);
    catalog = readCatalog(id);
  } catch {
    return false;
  }
  if (!portInfo || !catalog) return false;
  claimGeneration(id);
  logger.info(`Refreshing stale guide ${id} (generated ${guide.generatedAt})`);
  buildGuide(id, portInfo, catalog);
  return true;
}
