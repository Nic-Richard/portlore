import fs from 'fs';
import path from 'path';
import { POI_CATALOG_SCHEMA_VERSION } from '../../../shared/poi-curation.js';
import { buildGuideData } from '../../../shared/build-guide.js';
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

// New guides can be paused until a date (GENERATION_PAUSED_UNTIL=2026-11-01), e.g. once the month's free
// Google searches are used.
export function generationPausedUntil() {
  const until = Date.parse(process.env.GENERATION_PAUSED_UNTIL || '');
  return Number.isFinite(until) && Date.now() < until ? new Date(until) : null;
}

export function generationAvailability() {
  const pausedUntil = generationPausedUntil();
  if (pausedUntil) return { available: false, reason: 'paused', until: pausedUntil.toISOString().slice(0, 10) };
  if (getDailyUsage().count >= getLimit('GENERATION_DAILY_LIMIT', 20)) return { available: false, reason: 'daily_limit' };
  return { available: true };
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
  const maxAgeMs = getLimit('GUIDE_MAX_AGE_DAYS', 182) * DAY_MS;
  const generatedAt = Date.parse(guide?.generatedAt || '');
  return !Number.isFinite(generatedAt) || Date.now() - generatedAt > maxAgeMs;
}

// Builds a guide and writes it only once it is complete, so a failed rebuild leaves the old guide in place.
export async function buildGuide(id, portInfo, catalog, { patient = false } = {}) {
  try {
    const { data, model, websites, googleSearches } = await buildGuideData(portInfo, catalog, {
      apiKey: process.env.GOOGLE_MAPS_API_KEY,
      cachePath: path.join(CITIES_DIR, '.google-place-id-cache.json'),
      patient,
    });
    logger.info(`Generated ${id}: model=${model.model}, stop_reason=${model.stopReason}, attempts=${model.attempts}, input_tokens=${model.inputTokens}, output_tokens=${model.outputTokens}, google_searches=${googleSearches}, est_cost=$${model.cost.toFixed(4)}`);
    if (websites.error) logger.warn(`Website descriptions failed for ${id}: ${websites.error}`);
    else logger.info(`Described ${id} from websites: checked=${websites.checked}, found=${websites.found}, searches=${websites.searches}, rewritten=${websites.rewritten}, dead=${websites.dead}, est_cost=$${websites.cost.toFixed(4)}`);
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
  if (cooldownRemainingMs() > 0 || !generationAvailability().available) return false;
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
