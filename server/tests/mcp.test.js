import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import mcpRoute from '../src/routes/mcp.js';

async function mcp(t) {
  const app = express();
  app.use(express.json());
  app.use('/api/mcp', mcpRoute);
  const server = app.listen(0);
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/api/mcp`;
  return async (method, params, id = 1) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
    });
    return { status: response.status, body: await response.json() };
  };
}

test('the MCP endpoint lists the three read-only tools and finds ports by name', async (t) => {
  const call = await mcp(t);
  const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.status, 200);
  assert.equal(init.body.result.serverInfo.name, 'portlore');

  const tools = await call('tools/list', {}, 2);
  assert.deepEqual(tools.body.result.tools.map(tool => tool.name), ['find_port', 'get_port_guide', 'list_stops']);
  assert.ok(tools.body.result.tools.every(tool => tool.annotations.readOnlyHint));

  const found = await call('tools/call', { name: 'find_port', arguments: { query: 'cozumel' } }, 3);
  const ports = JSON.parse(found.body.result.content[0].text);
  assert.equal(ports[0].id, 'cozumel-mexico');
});

test('the MCP endpoint only takes POST', async (t) => {
  const app = express();
  app.use('/api/mcp', mcpRoute);
  const server = app.listen(0);
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/mcp`);
  assert.equal(response.status, 405);
});
