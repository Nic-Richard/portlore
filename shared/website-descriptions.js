import { curateCity } from './curation-model.js';

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

// Every stop's website is checked, and links to sites that are gone are dropped. Restaurants, cafés, and shops the
// shortlist had no facts about are then rewritten from their own website, so details like a menu are real. Sights
// keep their first description, since their sites rarely say what makes them worth a visit.
export async function describeFromWebsites(guide, catalog) {
  const sourced = new Set((catalog.pois || []).filter(poi => poi.intro || poi.description).map(poi => poi.sourceId));
  const linked = [...guide.places, ...guide.hiddenGems].filter(stop => stop.website);
  const stops = linked.filter(stop => ['food_drink', 'shopping'].includes(stop.category) && !sourced.has(stop.sourceId));
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
  if (!texts.size) return { checked: linked.length, rewritten: 0, dead, cost: 0 };

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
    if (!stop || item.skip || !String(item.description || '').trim()) continue;
    stop.subtitle = String(item.subtitle || stop.subtitle).trim();
    stop.description = String(item.description).trim();
    rewritten += 1;
  }
  return { checked: linked.length, rewritten, dead, cost: result.cost };
}
