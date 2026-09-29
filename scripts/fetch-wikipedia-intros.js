#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POI_DIR = path.join(ROOT, 'cities', 'poi');
const OUT_FILE = path.join(ROOT, 'data', 'wikipedia-intros.json');
const ENTITY_BATCH = 50;
const EXTRACT_BATCH = 20;
const MAX_LENGTH = 400;
const USER_AGENT = 'Portlore/1.0 (https://portlore.com; support@portlore.com)';
// English first, then widely written editions, so places without an English article still get an intro.
const LANGUAGES = ['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'sv', 'no', 'da', 'fi', 'pl', 'ru', 'ja', 'zh', 'ko', 'el', 'tr', 'hr', 'is', 'et', 'lv', 'lt', 'ca'];

function usage() {
  console.log(`Usage: node scripts/fetch-wikipedia-intros.js [--refresh]

Fetches the opening sentences of the Wikipedia article for every Wikidata item in cities/poi and saves
them to data/wikipedia-intros.json. Guides pass them to the model so it describes places from real facts.

Options:
  --refresh   Refetch intros that are already saved`);
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': USER_AGENT } }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error(`${new URL(url).host} returned ${response.statusCode}`));
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function pickArticle(sitelinks) {
  for (const lang of LANGUAGES) {
    const link = sitelinks[`${lang}wiki`];
    if (link?.title) return { lang, title: link.title };
  }
  return null;
}

function trimIntro(text) {
  let clean = String(text || '').replace(/\s+/g, ' ');
  // Asides like pronunciations nest, so strip the innermost brackets until none are left.
  while (/\([^()]*\)/.test(clean)) clean = clean.replace(/\s*\([^()]*\)/g, '');
  clean = clean.trim();
  if (clean.length <= MAX_LENGTH) return clean;
  const cut = clean.slice(0, MAX_LENGTH);
  const lastStop = cut.lastIndexOf('. ');
  return lastStop > 80 ? cut.slice(0, lastStop + 1) : `${cut.trim()}...`;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('-h') || args.has('--help')) return usage();

  const saved = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')) : { intros: {} };
  const intros = args.has('--refresh') ? {} : saved.intros;
  const referenced = new Set();
  for (const file of fs.readdirSync(POI_DIR).filter(name => name.endsWith('.json'))) {
    const catalog = JSON.parse(fs.readFileSync(path.join(POI_DIR, file), 'utf8'));
    for (const poi of catalog.pois || []) {
      const id = String(poi.wikidata || '').split(';')[0].trim();
      if (/^Q\d+$/.test(id)) referenced.add(id);
    }
  }

  const ids = [...referenced].filter(id => !(id in intros));
  console.log(`${ids.length} Wikidata items to look up (${Object.keys(intros).length} already saved)`);

  const articles = new Map();
  for (let start = 0; start < ids.length; start += ENTITY_BATCH) {
    const batch = ids.slice(start, start + ENTITY_BATCH);
    const data = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks&ids=${batch.join('|')}`);
    for (const id of batch) {
      const article = pickArticle(data.entities?.[id]?.sitelinks || {});
      if (article) articles.set(id, article);
      else intros[id] = '';
    }
    if ((start / ENTITY_BATCH) % 40 === 0) console.log(`  articles: ${Math.min(start + ENTITY_BATCH, ids.length)} of ${ids.length}`);
    await pause(200);
  }

  const byLanguage = new Map();
  for (const [id, { lang, title }] of articles) {
    if (!byLanguage.has(lang)) byLanguage.set(lang, []);
    byLanguage.get(lang).push({ id, title });
  }
  let done = 0;
  for (const [lang, items] of byLanguage) {
    for (let start = 0; start < items.length; start += EXTRACT_BATCH) {
      const batch = items.slice(start, start + EXTRACT_BATCH);
      const titles = batch.map(item => item.title).join('|');
      const data = await getJson(`https://${lang}.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&exintro=1&explaintext=1&exsentences=2&exlimit=${EXTRACT_BATCH}&redirects=1&titles=${encodeURIComponent(titles)}`);
      // Titles come back normalised and redirected, so follow both maps to the page each item asked for.
      const renamed = new Map();
      for (const step of [...(data.query?.normalized || []), ...(data.query?.redirects || [])]) renamed.set(step.from, step.to);
      const extracts = new Map(Object.values(data.query?.pages || {}).map(page => [page.title, page.extract]));
      for (const { id, title } of batch) {
        let final = title;
        for (let hop = 0; hop < 3 && renamed.has(final); hop += 1) final = renamed.get(final);
        intros[id] = trimIntro(extracts.get(final));
      }
      done += batch.length;
      if ((start / EXTRACT_BATCH) % 50 === 0) console.log(`  intros: ${done} of ${articles.size} (${lang})`);
      await pause(200);
    }
  }

  const sorted = Object.fromEntries(Object.entries(intros).filter(([id]) => referenced.has(id)).sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1))));
  fs.writeFileSync(OUT_FILE, `${JSON.stringify({ fetchedAt: new Date().toISOString().slice(0, 10), intros: sorted }, null, 1)}\n`);
  console.log(`Saved ${Object.values(sorted).filter(Boolean).length} intros for ${Object.keys(sorted).length} items to data/wikipedia-intros.json`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
