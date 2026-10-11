import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { CITIES_DIR } from '../lib/guides.js';
import { sendAlert } from '../lib/alerts.js';
import { rateLimit } from '../lib/rateLimit.js';
import * as logger from '../lib/logger.js';

const router = Router();
const FEEDBACK_FILE = path.join(CITIES_DIR, '.feedback.jsonl');
const KINDS = { bug: 'Something is wrong', idea: 'An idea', other: 'Something else' };

const clip = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

router.post(
  '/',
  rateLimit({
    limit: 10,
    windowMs: 60 * 60 * 1000,
    key: (req) => req.ip,
    message: 'Too many reports. Try again in a little while.',
  }),
  (req, res) => {
    const kind = Object.hasOwn(KINDS, req.body?.kind) ? req.body.kind : 'bug';
    const message = clip(req.body?.message, 2000);
    if (message.length < 10) return res.status(400).json({ error: 'Please add a little more detail.' });
    const entry = {
      kind,
      message,
      email: clip(req.body?.email, 200),
      port: clip(req.body?.port, 80),
      page: clip(req.body?.page, 300),
      client: clip(req.body?.client, 100),
      createdAt: new Date().toISOString(),
    };
    try {
      fs.appendFileSync(FEEDBACK_FILE, JSON.stringify(entry) + '\n');
    } catch (error) {
      logger.error('Could not save feedback:', error);
    }
    sendAlert('bugs', {
      title: KINDS[kind],
      description: message,
      url: entry.page.startsWith('/') ? `https://portlore.com${entry.page}` : '',
      fields: [
        { name: 'Port', value: entry.port },
        { name: 'Reply to', value: entry.email },
        { name: 'Client', value: entry.client },
      ],
    });
    res.status(201).json({ ok: true });
  },
);

export default router;
