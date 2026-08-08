#!/usr/bin/env node

import assert from 'assert';
import { fallbackTerminal, distanceMeters } from '../shared/port-resolution.js';

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test('distanceMeters returns 0 for identical coordinates', () => {
  assert.strictEqual(distanceMeters(43.6532, -79.3832, 43.6532, -79.3832), 0);
});

test('distanceMeters matches earthRadius * (1 degree in radians) along the equator', () => {
  const meters = distanceMeters(0, 0, 0, 1);
  const expected = 6371000 * (Math.PI / 180);
  assert.ok(Math.abs(meters - expected) < 1, `expected ${expected.toFixed(1)}m, got ${meters.toFixed(1)}m`);
});

test('distanceMeters matches earthRadius * (pi/2) from the equator to the pole', () => {
  const meters = distanceMeters(0, 0, 90, 0);
  const expected = 6371000 * (Math.PI / 2);
  assert.ok(Math.abs(meters - expected) < 1, `expected ${expected.toFixed(1)}m, got ${meters.toFixed(1)}m`);
});

test('fallbackTerminal builds an anchor point from valid port coordinates', () => {
  const terminal = fallbackTerminal({ lat: 43.6532, lng: -79.3832, city: 'Toronto', terminal: 'Toronto Cruise Terminal' });

  assert.strictEqual(terminal.lat, 43.6532);
  assert.strictEqual(terminal.lng, -79.3832);
  assert.strictEqual(terminal.name, 'Toronto Cruise Terminal');
  assert.strictEqual(terminal.slug, 'toronto-cruise-terminal');
  assert.strictEqual(terminal.source, 'ports.json');
});

test('fallbackTerminal falls back to "<city> port" when no terminal name is given', () => {
  const terminal = fallbackTerminal({ lat: 41.3, lng: 2.2, city: 'Barcelona' });
  assert.strictEqual(terminal.name, 'Barcelona port');
});

test('fallbackTerminal returns null when coordinates are missing or invalid', () => {
  assert.strictEqual(fallbackTerminal({ city: 'Nowhere' }), null);
  assert.strictEqual(fallbackTerminal({ lat: 'not-a-number', lng: -79.38 }), null);
});

(async () => {
  let passed = 0;

  for (const { name, fn } of tests) {
    try {
      await fn();
      passed += 1;
      console.log(`✓ ${name}`);
    } catch (err) {
      console.error(`✗ ${name}`);
      console.error(err.stack || err);
      process.exit(1);
    }
  }

  console.log(`\n${passed}/${tests.length} shared-logic smoke tests passed.`);
})().catch(err => {
  console.error(err.stack || err);
  process.exit(1);
});
