import { Router } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from '../lib/mcp.js';
import { rateLimit } from '../lib/rateLimit.js';
import * as logger from '../lib/logger.js';

const router = Router();
const limit = rateLimit({ limit: 60, windowMs: 60 * 1000, key: req => req.ip, message: 'Too many requests; try again in a minute.' });

// Stateless: each request gets its own server and transport, so nothing is kept between calls.
router.post('/', limit, async (req, res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    logger.error(`mcp request failed: ${err.message}`);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
  }
});

const notAllowed = (_req, res) => res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
router.get('/', notAllowed);
router.delete('/', notAllowed);

export default router;
