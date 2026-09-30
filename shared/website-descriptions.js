import { curateCity, curationModel } from './curation-model.js';

const FETCH_TIMEOUT_MS = 6000;
const CONCURRENCY = 8;
const MAX_TEXT = 900;
const PARKED = /domain (?:name )?(?:may be |is )?for sale|buy this domain|domain is parked|domain has expired/i;

function decode(text) {
  return text.replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;|&apos;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"');
}

export function websiteText(html) {
  const pick = pattern => (html.match(pattern)?.[1] || '').trim();
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const summary = pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)
    || pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)/i);
  const body = html
    .replace(/<(script|style|noscript|svg|nav|footer)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decode([title, summary, body].filter(Boolean).join(' | ')).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

export function isParkedDomain(text) {
  return PARKED.test(text);
}

// Only failures that mean the site is gone count as dead. Many sites, like Facebook, refuse automated requests
// with 400 or 403 but work in a browser, and a timeout may just be a slow server.
async function fetchWebsite(url) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Portlore/1.0; +https://portlore.com)' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if ([404, 410].includes(response.status)) return { dead: true };
    if (!response.ok || !/html/i.test(response.headers.get('content-type') || '')) return {};
    const text = websiteText((await response.text()).slice(0, 300000));
    return isParkedDomain(text) ? { dead: true } : { text };
  } catch (error) {
    return { dead: error.cause?.code === 'ENOTFOUND' };
  }
}

const SEARCH_SYSTEM = 'You look up official websites with Google Search and answer only with the requested JSON.';

// Restaurants, cafés, and shops without a website get one grounded Gemini search for all of them together. The
// model often answers well-known places without searching, so a site it gives is only kept when it loads and its
// own text turns out to be about this place.
async function findMissingWebsites(stops, place) {
  const missing = stops.filter(stop => ['food_drink', 'shopping'].includes(stop.category) && !stop.website);
  if (!missing.length || curationModel().name !== 'gemini') return { found: new Set(), searches: 0, cost: 0 };
  const result = await curateCity(`Find the official website of each place below, using Google Search.

Only give a URL that appears in your search results and belongs to the place itself: its own site, or its official Facebook or Instagram page if it has no site. Never give review, booking, delivery, map, or directory sites such as Tripadvisor, Yelp, or Google Maps. If you are not sure a result is this exact place in this city, give an empty string.

Return only this JSON:
{"stops":[{"id":"","website":""}]}

Places:
${JSON.stringify(missing.map(stop => ({ id: stop.id, name: stop.name, address: stop.address || '', city: place })))}`, { search: true, lightThinking: true, system: SEARCH_SYSTEM });

  const byId = new Map(missing.map(stop => [stop.id, stop]));
  const found = new Set();
  for (const item of Array.isArray(result.curation.stops) ? result.curation.stops : []) {
    const stop = byId.get(item?.id);
    const url = String(item?.website || '').trim();
    if (!stop || !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(url) || /tripadvisor|yelp|google\.|booking\.com|opentable|thefork|ubereats|deliveroo|doordash/i.test(url)) continue;
    stop.website = url;
    stop.officialWebsiteUrl = url;
    found.add(stop.id);
  }
  return { found, searches: result.searches, cost: result.cost };
}

// Every stop's website is checked, and links to sites that are gone are dropped. Restaurants, cafés, and shops the
// shortlist had no facts about are then rewritten from their own website, so details like a menu are real. Sights
// keep their first description, since their sites rarely say what makes them worth a visit.
export async function describeFromWebsites(guide, catalog) {
  const sourced = new Set((catalog.pois || []).filter(poi => poi.intro || poi.description).map(poi => poi.sourceId));
  const search = await findMissingWebsites([...guide.places, ...guide.hiddenGems], [guide.city, guide.country].filter(Boolean).join(', '));
  const linked = [...guide.places, ...guide.hiddenGems].filter(stop => stop.website);
  const stops = linked.filter(stop => ['food_drink', 'shopping'].includes(stop.category)
    && (!sourced.has(stop.sourceId) || search.found.has(stop.id)));
  const texts = new Map();
  let dead = 0;
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < linked.length) {
      const stop = linked[next++];
      const site = await fetchWebsite(stop.website);
      if (site.dead) {
        stop.website = '';
        stop.officialWebsiteUrl = '';
        dead += 1;
      } else if (site.text && site.text.length > 80 && stops.includes(stop)) {
        texts.set(stop.id, site.text);
      }
    }
  }));
  for (const stop of linked) {
    if (search.found.has(stop.id) && !texts.has(stop.id)) {
      stop.website = '';
      stop.officialWebsiteUrl = '';
    }
  }
  const found = [...search.found].filter(id => texts.has(id)).length;
  const summary = { checked: linked.length, found, searches: search.searches, dead };
  if (!texts.size) return { ...summary, rewritten: 0, cost: search.cost };

  const items = stops.filter(stop => texts.has(stop.id)).map(stop => ({
    id: stop.id,
    name: stop.name,
    subtitle: stop.subtitle,
    description: stop.description,
    website: texts.get(stop.id),
  }));
  const result = await curateCity(`Each cruise-port stop below comes with text from its own website.

Rewrite its subtitle (at most 15 words) and description (one or two sentences) for a cruise passenger, using only facts the website text states. Keep anything in the current wording that the website supports, and remove anything it does not, such as dishes, decor, or history the text never mentions. If the text is not about this place, set "skip": true for it.

Return only this JSON:
{"stops":[{"id":"","subtitle":"","description":""}]}

Stops:
${JSON.stringify(items)}`, { lightThinking: true });

  const byId = new Map(stops.map(stop => [stop.id, stop]));
  let rewritten = 0;
  for (const item of Array.isArray(result.curation.stops) ? result.curation.stops : []) {
    const stop = byId.get(item?.id);
    if (stop && item.skip && search.found.has(stop.id)) {
      stop.website = '';
      stop.officialWebsiteUrl = '';
      summary.found -= 1;
      continue;
    }
    if (!stop || item.skip || !String(item.description || '').trim()) continue;
    stop.subtitle = String(item.subtitle || stop.subtitle).trim();
    stop.description = String(item.description).trim();
    rewritten += 1;
  }
  return { ...summary, rewritten, cost: search.cost + result.cost };
}
