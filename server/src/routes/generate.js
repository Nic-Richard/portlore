import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { CURRENT_CITY_SCHEMA_VERSION } from '../../../shared/poi-curation.js';
import { CITIES_DIR, readPorts } from '../lib/guides.js';
import {
  buildGuide,
  claimGeneration,
  cooldownRemainingMs,
  failures,
  getDailyUsage,
  getLimit,
  inProgress,
  readCatalog,
} from '../lib/generation.js';

const router = Router();
const requestsByIp = new Map();
const IP_WINDOW_MS = 60 * 60 * 1000;

function cleanId(value) {
  return typeof value === 'string' && /^[a-z0-9-]+$/.test(value) ? value : null;
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

  const cooldownRemaining = cooldownRemainingMs();
  if (cooldownRemaining > 0) {
    const retryAfter = Math.max(1, Math.ceil(cooldownRemaining / 1000));
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Generation is cooling down. Try again shortly.', retryAfter });
  }

  if (getDailyUsage().count >= getLimit('GENERATION_DAILY_LIMIT', 20)) {
    return res.status(429).json({ error: 'The daily generation limit has been reached.' });
  }

  ipState.count += 1;
  claimGeneration(id);
  res.status(202).json({ status: 'started', estimatedSeconds: 75 });
  await buildGuide(id, portInfo, catalog);
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
