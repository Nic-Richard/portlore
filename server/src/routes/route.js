import { Router } from 'express';
import fetch from 'node-fetch';

const router = Router();
const cache = new Map();

function fallback(points) {
  const legs = [];
  let durationSeconds = 0;
  let distanceMeters = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const R = 6371000;
    const p1 = a.lat * Math.PI / 180;
    const p2 = b.lat * Math.PI / 180;
    const dp = (b.lat - a.lat) * Math.PI / 180;
    const dl = (b.lng - a.lng) * Math.PI / 180;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    const straight = 2 * R * Math.asin(Math.sqrt(h));
    const distance = straight * 1.25;
    const duration = distance / 1.3;
    legs.push({ distanceMeters: Math.round(distance), durationSeconds: Math.round(duration), approximate: true });
    distanceMeters += distance;
    durationSeconds += duration;
  }
  return { legs, distanceMeters: Math.round(distanceMeters), durationSeconds: Math.round(durationSeconds), approximate: true };
}

// Walking time from the pier to every stop in one request, for the stop list. Failure returns no times and
// the client keeps its straight-line estimates.
router.post('/walks', async (req, res) => {
  const valid = p => Number.isFinite(p.lat) && Number.isFinite(p.lng);
  const origin = { lat: Number(req.body?.origin?.lat), lng: Number(req.body?.origin?.lng) };
  const points = Array.isArray(req.body?.points) ? req.body.points.map(p => ({ lat: Number(p.lat), lng: Number(p.lng) })) : [];
  if (!valid(origin) || points.length < 1 || points.length > 150 || !points.every(valid)) {
    return res.status(400).json({ error: 'Provide an origin and between 1 and 150 valid points.' });
  }
  const coordinates = [origin, ...points].map(p => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  const cached = cache.get(`walks:${coordinates}`);
  if (cached && Date.now() - cached.at < 24 * 60 * 60 * 1000) return res.json(cached.data);

  const url = `https://routing.openstreetmap.de/routed-foot/table/v1/driving/${coordinates}?sources=0&annotations=duration`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Portlore/1.0 (https://portlore.com)' } });
    if (!response.ok) throw new Error(`Routing service failed (${response.status})`);
    const data = await response.json();
    const row = data.durations?.[0];
    if (data.code !== 'Ok' || !Array.isArray(row)) throw new Error('No walking times found.');
    const result = { seconds: row.slice(1).map(s => (Number.isFinite(s) && s > 0 ? Math.round(s) : null)) };
    cache.set(`walks:${coordinates}`, { at: Date.now(), data: result });
    res.json(result);
  } catch {
    res.json({ seconds: null });
  } finally {
    clearTimeout(timeout);
  }
});

router.post('/', async (req, res) => {
  const points = Array.isArray(req.body?.points) ? req.body.points.map(p => ({ lat: Number(p.lat), lng: Number(p.lng) })) : [];
  if (points.length < 2 || points.length > 14 || points.some(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lng))) {
    return res.status(400).json({ error: 'Provide between 2 and 14 valid route points.' });
  }
  const key = points.map(p => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return res.json({ ...cached.data, cached: true });

  const coordinates = points.map(p => `${p.lng},${p.lat}`).join(';');
  const url = `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false&annotations=false`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Portlore/1.0 (https://portlore.com)' } });
    if (!response.ok) throw new Error(`Routing service failed (${response.status})`);
    const data = await response.json();
    const route = data.routes?.[0];
    if (!route?.legs?.length) throw new Error('No walking route found.');
    const result = {
      legs: route.legs.map(leg => ({ distanceMeters: Math.round(leg.distance), durationSeconds: Math.round(leg.duration), approximate: false })),
      distanceMeters: Math.round(route.distance),
      durationSeconds: Math.round(route.duration),
      path: route.geometry.coordinates.map(([lng, lat]) => [Number(lat.toFixed(5)), Number(lng.toFixed(5))]),
      approximate: false,
    };
    cache.set(key, { at: Date.now(), data: result });
    res.json(result);
  } catch {
    res.json(fallback(points));
  } finally {
    clearTimeout(timeout);
  }
});

export default router;
