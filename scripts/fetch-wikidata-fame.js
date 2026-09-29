#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.join(ROOT, 'cities', 'poi-raw');
const OUT_FILE = path.join(ROOT, 'data', 'wikidata-fame.json');
const BATCH = 50;
const USER_AGENT = 'Portlore/1.0 (https://portlore.com; support@portlore.com)';

function usage() {
  console.log(`Usage: node scripts/fetch-wikidata-fame.js [--refresh]

Counts the Wikipedia language editions for every Wikidata item in cities/poi-raw and saves them to
data/wikidata-fame.json. The shortlist rules use the count to rank famous places first.

Options:
  --refresh   Refetch counts that are already saved`);
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': USER_AGENT } }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error(`Wikidata returned ${response.statusCode}`));
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('-h') || args.has('--help')) return usage();

  const saved = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')) : { counts: {} };
  const counts = args.has('--refresh') ? {} : saved.counts;
  const referenced = new Set();
  for (const file of fs.readdirSync(RAW_DIR).filter(name => name.endsWith('.json'))) {
    const catalog = JSON.parse(fs.readFileSync(path.join(RAW_DIR, file), 'utf8'));
    for (const poi of catalog.pois || []) {
      const id = String(poi.wikidata || '').split(';')[0].trim();
      if (/^Q\d+$/.test(id)) referenced.add(id);
    }
  }

  const ids = [...referenced].filter(id => !(id in counts));
  console.log(`${ids.length} Wikidata items to fetch (${Object.keys(counts).length} already saved)`);
  for (let start = 0; start < ids.length; start += BATCH) {
    const batch = ids.slice(start, start + BATCH);
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks&ids=${batch.join('|')}`;
    const data = await getJson(url);
    for (const id of batch) {
      const sitelinks = data.entities?.[id]?.sitelinks || {};
      // Count Wikipedia editions only, not Commons, Wikivoyage or other projects.
      counts[id] = Object.keys(sitelinks).filter(site => site.endsWith('wiki') && site !== 'commonswiki' && site !== 'specieswiki').length;
    }
    if ((start / BATCH) % 20 === 0) console.log(`  ${Math.min(start + BATCH, ids.length)} of ${ids.length}`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  const sorted = Object.fromEntries(Object.entries(counts).filter(([id]) => referenced.has(id)).sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1))));
  fs.writeFileSync(OUT_FILE, `${JSON.stringify({ fetchedAt: new Date().toISOString().slice(0, 10), counts: sorted })}\n`);
  console.log(`Saved ${Object.keys(sorted).length} counts to data/wikidata-fame.json`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
