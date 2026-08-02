import { Router } from 'express';
import fetch from 'node-fetch';

const router = Router();
const cache = new Map();
const USER_AGENT = 'Portlore/1.0 (https://portlore.com)';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (q.length < 2 || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'Search term and terminal coordinates are required.' });
  }

  const radiusKm = clamp(Number(req.query.radius) || 5, 1, 12);
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.max(Math.cos(lat * Math.PI / 180), 0.25));
  const west = lng - lngDelta;
  const east = lng + lngDelta;
  const north = lat + latDelta;
  const south = lat - latDelta;
  const key = `${q.toLowerCase()}|${lat.toFixed(3)}|${lng.toFixed(3)}|${radiusKm}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return res.json({ results: cached.results, cached: true });

  const params = new URLSearchParams({
    q,
    format: 'jsonv2',
    addressdetails: '1',
    namedetails: '1',
    extratags: '1',
    limit: '20',
    bounded: '1',
    viewbox: `${west},${north},${east},${south}`,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Nearby search failed (${response.status})`);
    const data = await response.json();
    const results = data.map(item => {
      const name = item.namedetails?.name || item.name || String(item.display_name || '').split(',')[0];
      const category = item.type || item.category || 'place';
      return {
        id: `search:${item.osm_type}:${item.osm_id}`,
        name,
        lat: Number(item.lat),
        lng: Number(item.lon),
        address: item.display_name || '',
        category,
        source: 'search',
        sourceProvider: 'openstreetmap',
        osmType: item.osm_type,
        osmId: item.osm_id,
      };
    }).filter(item => item.name && Number.isFinite(item.lat) && Number.isFinite(item.lng));
    cache.set(key, { at: Date.now(), results });
    res.json({ results, cached: false });
  } catch (error) {
    res.status(error.name === 'AbortError' ? 504 : 502).json({ error: error.name === 'AbortError' ? 'Nearby search timed out.' : error.message });
  } finally {
    clearTimeout(timeout);
  }
});

export default router;
