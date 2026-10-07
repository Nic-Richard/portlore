import { Router } from 'express';
import { distanceMeters } from '../../../shared/port-resolution.js';
import { listGuideIds, readGuide, readPorts } from '../lib/guides.js';
import { renderPortPage, renderSitemap } from '../lib/port-page.js';
import { findPhotos } from './photo.js';

const router = Router();

async function heroPhoto(port) {
  try {
    return (await findPhotos('', { port, timeoutMs: 2500 })).photos[0] || null;
  } catch {
    return null;
  }
}

router.get('/ports/:id', async (req, res) => {
  const id = req.params.id.replace(/[^a-z0-9-]/g, '');
  const ports = readPorts();
  const port = ports.find(p => p.id === id);
  if (!port) {
    return res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><title>Port not found | Portlore</title><p>There is no port at this address. <a href="/">See all ports</a>.</p>');
  }

  const guide = readGuide(id);
  const photo = await heroPhoto(port);
  const nearby = ports
    .filter(p => p.id !== id)
    .map(p => ({ p, d: distanceMeters(port.lat, port.lng, p.lat, p.lng) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 5)
    .map(({ p }) => p);

  res.set('Cache-Control', 'public, max-age=600').type('html').send(renderPortPage({ port, guide, photo, nearby }));
});

router.get('/sitemap.xml', (_req, res) => {
  const portIds = new Set(readPorts().map(p => p.id));
  const entries = listGuideIds().filter(id => portIds.has(id)).map(id => ({ id, lastmod: readGuide(id)?.generatedAt }));
  res.set('Cache-Control', 'public, max-age=3600').type('application/xml').send(renderSitemap(entries));
});

export default router;
