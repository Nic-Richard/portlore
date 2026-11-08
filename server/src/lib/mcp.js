import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { listGuideIds, readGuide, readPorts } from './guides.js';
import { walkSeconds } from './walks.js';

const SITE = 'https://portlore.com';
const RIDE_MINUTES = 45;
const CATEGORIES = { sights: 'attraction', food: 'food_drink', shops: 'shopping', outdoors: 'outdoors', essentials: 'essentials' };
const CATEGORY_NAMES = Object.fromEntries(Object.entries(CATEGORIES).map(([name, value]) => [value, name]));

let guideIds = { at: 0, ids: new Set() };
function hasGuide(id) {
  if (Date.now() - guideIds.at > 5 * 60 * 1000) guideIds = { at: Date.now(), ids: new Set(listGuideIds()) };
  return guideIds.ids.has(id);
}

const fold = text => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function findPorts(query, limit = 10) {
  const q = fold(query);
  if (!q) return [];
  const ports = readPorts();
  const score = port => {
    const city = fold(port.city), country = fold(port.country), id = fold(port.id);
    if (city === q || id === q) return 0;
    if (city.startsWith(q)) return 1;
    if (`${city} ${country}`.includes(q) || id.includes(q.replace(/\s+/g, '-'))) return 2;
    if (fold(port.terminal).includes(q)) return 3;
    return null;
  };
  return ports.map(port => ({ port, rank: score(port) })).filter(p => p.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.port.city.localeCompare(b.port.city)).slice(0, limit).map(p => p.port);
}

// A port can be named by its id ("cozumel-mexico") or a plain name ("Cozumel").
function resolvePort(name) {
  const id = String(name || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  return readPorts().find(p => p.id === id) || findPorts(name, 1)[0] || null;
}

function straightWalkSeconds(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return (2 * R * Math.asin(Math.sqrt(h)) * 1.25) / 1.3;
}

const mapsLink = stop => stop.googlePlaceId
  ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.name)}&query_place_id=${stop.googlePlaceId}`
  : `https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`;

const json = data => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const noGuide = port => json({
  port: `${port.city}, ${port.country}`,
  guide: false,
  note: `Portlore hasn't built a guide for this port yet. Opening ${SITE}/ports/${port.id} and planning a day there builds one.`
});

export function createMcpServer() {
  const server = new McpServer(
    { name: 'portlore', version: '1.0.0' },
    { instructions: 'Cruise port guides from Portlore: find a port, read its guide, and list stops with walking times from the cruise pier. Use these facts to help plan a day ashore; leave a margin before all-aboard time.' }
  );

  server.registerTool('find_port', {
    title: 'Find a cruise port',
    description: 'Search Portlore\'s cruise ports by city, country or terminal name. Says whether each port has a guide yet.',
    inputSchema: { query: z.string().min(1).max(80).describe('City, country or terminal, e.g. "Cozumel" or "Norway"') },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ query }) => json(findPorts(query).map(port => ({
    id: port.id, city: port.city, country: port.country, terminal: port.terminal, guide: hasGuide(port.id)
  }))));

  server.registerTool('get_port_guide', {
    title: 'Read a port guide',
    description: 'A port\'s overview, its cruise piers and how many stops of each kind the guide has.',
    inputSchema: { port: z.string().min(1).max(80).describe('Port id from find_port, or a port name') },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ port: name }) => {
    const port = resolvePort(name);
    if (!port) return json({ error: `No port matches "${name}". Try find_port.` });
    const guide = readGuide(port.id);
    if (!guide) return noGuide(port);
    const stops = [...guide.places, ...guide.hiddenGems];
    const counts = {};
    for (const stop of stops) counts[CATEGORY_NAMES[stop.category] || stop.category] = (counts[CATEGORY_NAMES[stop.category] || stop.category] || 0) + 1;
    return json({
      id: guide.id,
      port: `${guide.city}, ${guide.country}`,
      timezone: guide.timezone,
      overview: guide.overview?.summary || '',
      arrival: guide.overview?.arrivalContext || '',
      piers: (guide.terminals || [guide.terminal]).map(t => ({ id: t.id, name: t.name })),
      stops: counts,
      hidden_gems: guide.hiddenGems.map(g => g.name),
      guide_page: `${SITE}/ports/${guide.id}`
    });
  });

  server.registerTool('list_stops', {
    title: 'List stops near the pier',
    description: 'Stops in a port guide sorted by walking time from a cruise pier, with suggested visit length, hidden-gem flag, hours and a map link. Stops over a 45-minute walk are marked as needing a ride.',
    inputSchema: {
      port: z.string().min(1).max(80).describe('Port id from find_port, or a port name'),
      pier: z.string().max(200).optional().describe('Pier id or name from get_port_guide; defaults to the main cruise pier'),
      category: z.enum(Object.keys(CATEGORIES)).optional(),
      max_walk_minutes: z.number().int().min(1).max(180).optional(),
      hidden_gems_only: z.boolean().optional(),
      limit: z.number().int().min(1).max(50).optional()
    },
    annotations: { readOnlyHint: true, openWorldHint: true }
  }, async ({ port: name, pier, category, max_walk_minutes, hidden_gems_only, limit = 20 }) => {
    const port = resolvePort(name);
    if (!port) return json({ error: `No port matches "${name}". Try find_port.` });
    const guide = readGuide(port.id);
    if (!guide) return noGuide(port);
    const piers = guide.terminals?.length ? guide.terminals : [guide.terminal];
    const wanted = fold(pier);
    const from = (wanted && piers.find(t => fold(t.id) === wanted || fold(t.name).includes(wanted))) || guide.terminal || piers[0];

    const gems = new Set(guide.hiddenGems.map(g => g.id));
    let stops = [...guide.places, ...guide.hiddenGems].filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng));
    if (category) stops = stops.filter(s => s.category === CATEGORIES[category]);
    if (hidden_gems_only) stops = stops.filter(s => gems.has(s.id));

    const routed = stops.length ? await walkSeconds(from, stops) : [];
    const rows = stops.map((stop, i) => {
      const seconds = routed?.[i] ?? straightWalkSeconds(from, stop);
      const minutes = Math.max(1, Math.round(seconds / 60));
      return {
        name: stop.name,
        about: stop.subtitle || '',
        category: CATEGORY_NAMES[stop.category] || stop.category,
        hidden_gem: gems.has(stop.id),
        walk_minutes: minutes,
        needs_ride: minutes > RIDE_MINUTES,
        walk_time_estimated: routed?.[i] == null,
        visit_minutes: stop.suggestedVisitMinutes || null,
        hours: stop.hours || null,
        map: mapsLink(stop)
      };
    }).filter(row => !max_walk_minutes || row.walk_minutes <= max_walk_minutes)
      .sort((a, b) => a.walk_minutes - b.walk_minutes);

    return json({ port: `${guide.city}, ${guide.country}`, from_pier: from.name, count: rows.length, stops: rows.slice(0, limit) });
  });

  return server;
}

export { findPorts, resolvePort };
