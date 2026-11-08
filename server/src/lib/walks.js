import fetch from 'node-fetch';

const cache = new Map();
const DAY_MS = 24 * 60 * 60 * 1000;

// Walking seconds from origin to each point via the public OSM foot router, cached a day. Null when the
// router fails, so callers fall back to their own estimates.
export async function walkSeconds(origin, points) {
  const coordinates = [origin, ...points].map(p => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  const cached = cache.get(coordinates);
  if (cached && Date.now() - cached.at < DAY_MS) return cached.seconds;

  const url = `https://routing.openstreetmap.de/routed-foot/table/v1/driving/${coordinates}?sources=0&annotations=duration`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Portlore/1.0 (https://portlore.com)' } });
    if (!response.ok) throw new Error(`Routing service failed (${response.status})`);
    const data = await response.json();
    const row = data.durations?.[0];
    if (data.code !== 'Ok' || !Array.isArray(row)) throw new Error('No walking times found.');
    const seconds = row.slice(1).map(s => (Number.isFinite(s) && s > 0 ? Math.round(s) : null));
    cache.set(coordinates, { at: Date.now(), seconds });
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
    return seconds;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
