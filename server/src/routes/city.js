import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CURRENT_CITY_SCHEMA_VERSION } from '../../../shared/poi-curation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CITIES_DIR = path.join(__dirname, '..', '..', '..', 'cities');

const router = Router();

function readCurrentCity(filePath, id) {
  if (!fs.existsSync(filePath)) return null;

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return data.schemaVersion === CURRENT_CITY_SCHEMA_VERSION ? data : null;
  } catch {
    return null;
  }
}

router.get('/', (_req, res) => {
  try {
    const generatedIds = fs.readdirSync(CITIES_DIR)
      .filter(name => name.endsWith('.json') && name !== 'ports.json' && !name.startsWith('.'))
      .filter(name => readCurrentCity(path.join(CITIES_DIR, name), name.slice(0, -5)))
      .map(name => name.slice(0, -5));
    res.json({ generatedIds });
  } catch {
    res.status(500).json({ error: 'Failed to read generated cities' });
  }
});

router.get('/:id', (req, res) => {
  const id = req.params.id.replace(/[^a-z0-9-]/g, '');
  const filePath = path.join(CITIES_DIR, `${id}.json`);
  const data = readCurrentCity(filePath, id);

  if (!data) {
    return res.status(404).json({ error: 'City not yet generated', generated: false });
  }

  res.json(data);
});

export default router;
