import { Router } from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CITIES_DIR, readPorts } from '../lib/guides.js';
import { portPhotoQuery } from '../../../shared/photo-query.js';

const router = Router();

const cache = new Map();

export async function findPhotos(query, { timeoutMs, port } = {}) {
  if (port) {
    let anchor;
    try { anchor = JSON.parse(readFileSync(path.join(CITIES_DIR, 'poi', `${port.id}.json`), 'utf8')).portAnchor; } catch {}
    query = portPhotoQuery(port, anchor);
  }
  const cacheKey = `${port?.id || ''}|${query}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const key = process.env.PEXELS_API_KEY;
  if (!key) throw new Error('Pexels API key not configured');

  const r = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=landscape&per_page=15`,
    { headers: { Authorization: key }, signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined }
  );
  if (!r.ok) throw new Error(`Pexels error ${r.status}`);
  const data = await r.json();
  const photos = (data.photos || []).map(p => ({
    url: p.src?.large2x || p.src?.large,
    photographer: p.photographer,
    photographer_url: p.photographer_url,
  })).filter(p => p.url);

  const result = { photos };
  cache.set(cacheKey, result);
  return result;
}

router.get('/', async (req, res) => {
  const port = typeof req.query.port === 'string' ? readPorts().find(p => p.id === req.query.port) : null;
  if (req.query.port !== undefined && !port) return res.status(400).json({ error: 'Unknown port' });
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!port && !query) return res.status(400).json({ error: 'Provide a port or query parameter q' });

  try {
    res.json(await findPhotos(query, { port }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
