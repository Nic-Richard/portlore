// In-memory and per process, which is enough for the single pm2 instance this runs as.
export function rateLimit({ limit, windowMs, key, message }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const id = key(req);
    const recent = (hits.get(id) || []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) return res.status(429).json({ error: message });
    recent.push(now);
    hits.set(id, recent);
    if (hits.size > 10000) {
      for (const [k, times] of hits) if (now - times.at(-1) >= windowMs) hits.delete(k);
    }
    next();
  };
}
