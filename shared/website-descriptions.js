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

async function fetchWebsiteText(url) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Portlore/1.0; +https://portlore.com)' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok || !/html/i.test(response.headers.get('content-type') || '')) return null;
    return websiteText((await response.text()).slice(0, 300000));
  } catch {
    return null;
  }
}

// Restaurants, cafés, and shops the shortlist had no facts about are rewritten from their own website, so details
// like a menu are real. Sights keep their first description, since their sites rarely say what makes them worth a visit.
export async function describeFromWebsites(guide, catalog) {
  const sourced = new Set((catalog.pois || []).filter(poi => poi.intro || poi.description).map(poi => poi.sourceId));
  const stops = [...guide.places, ...guide.hiddenGems]
    .filter(stop => stop.website && ['food_drink', 'shopping'].includes(stop.category) && !sourced.has(stop.sourceId));
  const texts = new Map();
  let parked = 0;
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < stops.length) {
      const stop = stops[next++];
      const text = await fetchWebsiteText(stop.website);
      if (text && isParkedDomain(text)) {
        stop.website = '';
        stop.officialWebsiteUrl = '';
        parked += 1;
      } else if (text && text.length > 80) {
        texts.set(stop.id, text);
      }
    }
  }));
  if (!texts.size) return { checked: stops.length, rewritten: 0, parked, cost: 0 };

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
  return { checked: stops.length, rewritten, parked, cost: result.cost };
}
