import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderGuideDirectory } from '../server/src/lib/guide-directory.js';
import { renderPortPage, renderSitemap } from '../server/src/lib/port-page.js';

const port = {
  id: 'halifax-canada', city: 'Halifax', country: 'Canada', terminal: 'Pier 21', lat: 44.64, lng: -63.56,
};

test('guide directory groups and sorts its published ports without changing the input', () => {
  const ports = [
    { ...port, id: 'victoria-canada', city: 'Victoria' },
    { ...port, id: 'aarhus-denmark', city: 'Aarhus', country: 'Denmark' },
    port,
  ];
  const html = renderGuideDirectory(ports);
  assert.ok(html.indexOf('>Canada</h2>') < html.indexOf('>Denmark</h2>'));
  assert.ok(html.indexOf('href="/ports/halifax-canada"') < html.indexOf('href="/ports/victoria-canada"'));
  assert.equal((html.match(/href="\/ports\//g) || []).length, 3);
  assert.match(html, /3 published guides across 2 countries and territories/);
  assert.match(html, /rel="canonical" href="https:\/\/portlore.com\/guides"/);
  assert.equal(ports[0].city, 'Victoria');
});

test('directory escapes port and country names and uses safe section anchors', () => {
  const html = renderGuideDirectory([{ ...port, city: '<script>alert(1)</script>', country: '" onmouseover="alert(1)', guideCentre: 'A & B' }]);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&quot; onmouseover=&quot;alert\(1\)/);
  assert.match(html, /A &amp; B/);
  assert.match(html, /id="country-1"/);
});

test('an empty directory offers the planner without advertising nonexistent guides', () => {
  const html = renderGuideDirectory([]);
  assert.match(html, /No guides are published yet/);
  assert.doesNotMatch(html, /href="\/ports\//);
});

test('guide pages and the sitemap expose the directory without losing planner links', () => {
  const html = renderPortPage({ port, guide: null, photo: null });
  assert.match(html, /href="\/guides"/);
  assert.match(html, /href="\/\?port=halifax-canada"/);
  const xml = renderSitemap([{ id: port.id, lastmod: '2026-10-19T00:00:00Z' }]);
  assert.match(xml, /<loc>https:\/\/portlore.com\/guides<\/loc>/);
  assert.match(xml, /<loc>https:\/\/portlore.com\/ports\/halifax-canada<\/loc>/);
});
