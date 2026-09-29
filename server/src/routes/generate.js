import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildCityCurationPrompt,
  buildCityData,
  CURRENT_CITY_SCHEMA_VERSION,
  POI_CATALOG_SCHEMA_VERSION,
} from '../../../shared/poi-curation.js';
import { curateCity } from '../../../shared/curation-model.js';
import { resolveCatalogGooglePlaces, resolveCurationGooglePlaces } from '../../../shared/google-places.js';
import { describeFromWebsites } from '../../../shared/website-descriptions.js';
import * as logger from '../lib/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CITIES_DIR = path.join(__dirname, '..', '..', '..', 'cities');
const POI_DIR = path.join(CITIES_DIR, 'poi');
const PORTS_FILE = path.join(CITIES_DIR, 'ports.json');
const USAGE_FILE = path.join(CITIES_DIR, '.generation-usage.json');

const router = Router();
const inProgress = new Set();
const failures = new Map();
const requestsByIp = new Map();
const IP_WINDOW_MS = 60 * 60 * 1000;
let lastGenerationStartedAt = 0;

function getLimit(name, fallback, minimum = 1) {
  return Math.max(minimum, Number.parseInt(process.env[name] || String(fallback), 10));
}

function cleanId(value) {
  return typeof value === 'string' && /^[a-z0-9-]+$/.test(value) ? value : null;
}

function readPorts() {
  return JSON.parse(fs.readFileSync(PORTS_FILE, 'utf8'));
}

function readCatalog(id) {
  const catalogPath = path.join(POI_DIR, `${id}.json`);
  if (!fs.existsSync(catalogPath)) return null;
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  if (catalog.schemaVersion !== POI_CATALOG_SCHEMA_VERSION || !Array.isArray(catalog.pois)) return null;
  return catalog;
}

function getIpState(ip) {
  const now = Date.now();
  const existing = requestsByIp.get(ip);
  if (!existing || now >= existing.resetAt) {
    const state = { count: 0, resetAt: now + IP_WINDOW_MS };
    requestsByIp.set(ip, state);
    return state;
  }
  return existing;
}

function getDailyUsage() {
  const date = new Date().toISOString().slice(0, 10);
  try {
    const usage = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
    if (usage.date === date && Number.isInteger(usage.count)) return usage;
  } catch {}
  return { date, count: 0 };
}

function saveDailyUsage(usage) {
  fs.mkdirSync(CITIES_DIR, { recursive: true });
  fs.writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 2));
}

router.post('/:id', async (req, res) => {
  const id = cleanId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid port ID' });

  const outPath = path.join(CITIES_DIR, `${id}.json`);
  if (inProgress.has(id)) return res.json({ status: 'generating' });

  let portInfo;
  try {
    portInfo = readPorts().find(port => port.id === id);
  } catch {
    return res.status(500).json({ error: 'Could not read ports.json' });
  }
  if (!portInfo) return res.status(404).json({ error: 'Port not found' });
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return res.status(503).json({ error: 'Google Places is not configured.' });
  }

  let catalog;
  try {
    catalog = readCatalog(id);
  } catch {
    return res.status(500).json({ error: 'Could not read the local POI catalog' });
  }
  if (fs.existsSync(outPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      if (existing.schemaVersion === CURRENT_CITY_SCHEMA_VERSION) return res.json({ status: 'exists' });
    } catch {}
    fs.rmSync(outPath, { force: true });
  }

  if (!catalog) {
    return res.status(409).json({
      error: 'This port does not have a usable local POI catalog yet.',
      code: 'POI_CATALOG_REQUIRED',
    });
  }

  const ipState = getIpState(req.ip);
  const ipLimit = getLimit('GENERATION_IP_LIMIT', 3);
  if (ipState.count >= ipLimit) {
    const retryAfter = Math.max(1, Math.ceil((ipState.resetAt - Date.now()) / 1000));
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Generation limit reached. Try again later.', retryAfter });
  }
  if (inProgress.size > 0) return res.status(409).json({ error: 'Another city is currently being generated. Try again shortly.' });

  const cooldownMs = getLimit('GENERATION_COOLDOWN_SECONDS', 60, 0) * 1000;
  const cooldownRemaining = cooldownMs - (Date.now() - lastGenerationStartedAt);
  if (cooldownRemaining > 0) {
    const retryAfter = Math.max(1, Math.ceil(cooldownRemaining / 1000));
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Generation is cooling down. Try again shortly.', retryAfter });
  }

  const usage = getDailyUsage();
  const dailyLimit = getLimit('GENERATION_DAILY_LIMIT', 20);
  if (usage.count >= dailyLimit) return res.status(429).json({ error: 'The daily generation limit has been reached.' });

  ipState.count += 1;
  usage.count += 1;
  saveDailyUsage(usage);
  lastGenerationStartedAt = Date.now();
  inProgress.add(id);

  const cityInput = `${portInfo.city}, ${portInfo.country}`;
  failures.delete(id);
  res.status(202).json({ status: 'started', estimatedSeconds: 75 });

  try {
    const result = await curateCity(buildCityCurationPrompt(portInfo, catalog));
    logger.info(`Generated ${id}: model=${result.model}, stop_reason=${result.stopReason}, attempts=${result.attempts}, input_tokens=${result.inputTokens}, output_tokens=${result.outputTokens}, est_cost=$${result.cost.toFixed(4)}`);

    const curation = result.curation;
    // Google is only searched for the stops the model picked, not the whole shortlist.
    const googleMatches = await resolveCatalogGooglePlaces(portInfo, catalog, {
      apiKey: process.env.GOOGLE_MAPS_API_KEY,
      cachePath: path.join(CITIES_DIR, '.google-place-id-cache.json'),
      onlyIds: (Array.isArray(curation.places) ? curation.places : []).map(item => item?.sourceId).filter(Boolean),
    });
    const resolvedCuration = await resolveCurationGooglePlaces(portInfo, catalog, curation, {
      apiKey: process.env.GOOGLE_MAPS_API_KEY,
      cachePath: path.join(CITIES_DIR, '.google-place-id-cache.json'),
      catalogMatches: googleMatches,
    });
    const data = { ...buildCityData(portInfo, catalog, resolvedCuration, googleMatches), model: result.model };
    try {
      const websites = await describeFromWebsites(data, catalog);
      logger.info(`Described ${id} from websites: checked=${websites.checked}, rewritten=${websites.rewritten}, parked=${websites.parked}, est_cost=$${websites.cost.toFixed(4)}`);
    } catch (error) {
      logger.warn(`Website descriptions failed for ${id}: ${error.message}`);
    }
    fs.mkdirSync(CITIES_DIR, { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));

    try {
      const ports = readPorts();
      const port = ports.find(item => item.id === id);
      if (port) {
        port.generated = true;
        fs.writeFileSync(PORTS_FILE, JSON.stringify(ports, null, 2));
      }
    } catch {}

    logger.debug(`Enriched from curated POI catalog: ${cityInput}`);
  } catch (error) {
    logger.error(`Generation failed for ${id}:`, error.message);
    failures.set(id, error.overloaded
      ? 'The server is overloaded right now. Please try again in a few minutes.'
      : 'There was a server error building this guide. Please try again in a few minutes.');
  } finally {
    inProgress.delete(id);
  }
});

router.get('/:id/status', (req, res) => {
  const id = cleanId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid port ID' });

  const outPath = path.join(CITIES_DIR, `${id}.json`);
  if (fs.existsSync(outPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      if (data.schemaVersion === CURRENT_CITY_SCHEMA_VERSION) return res.json({ status: 'ready' });
    } catch {}
  }
  if (inProgress.has(id)) return res.json({ status: 'generating' });
  if (failures.has(id)) return res.json({ status: 'failed', error: failures.get(id) });
  try {
    return res.json({ status: readCatalog(id) ? 'not_started' : 'catalog_required' });
  } catch {
    return res.json({ status: 'catalog_required' });
  }
});

export default router;
