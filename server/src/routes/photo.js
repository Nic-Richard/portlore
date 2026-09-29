import { Router } from 'express';

const router = Router();

const cache = {};

export async function findPhotos(query, { timeoutMs } = {}) {
  if (cache[query]) return cache[query];

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

  cache[query] = { photos };
  return cache[query];
}

router.get('/', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Missing query parameter q' });

  try {
    res.json(await findPhotos(query));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
