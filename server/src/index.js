import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import photoRoute from './routes/photo.js';
import generateRoute from './routes/generate.js';
import cityRoute from './routes/city.js';
import nearbyRoute from './routes/nearby.js';
import routeRoute from './routes/route.js';
import pagesRoute from './routes/pages.js';
import * as logger from './lib/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '..', '.env') });

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3002;

app.use(cors({ origin: ['https://portlore.com', 'http://localhost:8080'] }));
app.use(express.json());

app.use('/api/photo', photoRoute);
app.use('/api/generate', generateRoute);
app.use('/api/city', cityRoute);
app.use('/api/nearby', nearbyRoute);
app.use('/api/route', routeRoute);
app.use(pagesRoute);

app.get('/api/health', (_, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  logger.info(`Portlore server running on port ${PORT}`);
});
