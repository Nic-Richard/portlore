import { Router } from 'express';
import { listGuideIds, readGuide } from '../lib/guides.js';

const router = Router();

router.get('/', (_req, res) => {
  try {
    res.json({ generatedIds: listGuideIds() });
  } catch {
    res.status(500).json({ error: 'Failed to read generated cities' });
  }
});

router.get('/:id', (req, res) => {
  const id = req.params.id.replace(/[^a-z0-9-]/g, '');
  const data = readGuide(id);

  if (!data) {
    return res.status(404).json({ error: 'City not yet generated', generated: false });
  }

  res.json(data);
});

export default router;
