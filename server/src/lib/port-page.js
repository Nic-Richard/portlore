import { distanceMeters } from '../../../shared/port-resolution.js';

const SITE = 'https://portlore.com';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const metres = (a, b) => distanceMeters(a.lat, a.lng, b.lat, b.lng);

const stopRow = ({ place, minutes }) =>
  `<li>${minutes > 45 ? '<span class="walk ride">Ride</span>' : `<span class="walk">${minutes}<small>min</small></span>`}<div><h3>${esc(place.name)}</h3>${place.subtitle ? `<p>${esc(place.subtitle)}</p>` : ''}</div></li>`;

export function renderPortPage({ port, guide, photo, nearby = [] }) {
  const gateway = Boolean(port.guideCentre);
  const name = port.city.replace(/\s*\([^)]*\)/g, '');
  const kicker = !guide ? 'Cruise port' : gateway ? `Cruise port guide for ${port.guideCentre}` : 'Cruise port guide';
  const url = `${SITE}/ports/${port.id}`;
  const terminals = guide?.terminals?.length ? guide.terminals : [{ name: port.terminal, lat: port.lat, lng: port.lng }];
  const origin = gateway ? { lat: port.lat, lng: port.lng } : (guide?.port || terminals[0]);
  const originName = gateway ? `central ${port.guideCentre}` : terminals[0].name;
  const title = guide ? `${port.city} cruise port guide: what to see near the terminal | Portlore` : `${port.city} cruise port | Portlore`;
  const description = guide
    ? `Where ships dock in ${port.city} and what's worth seeing, sorted by walking time from ${gateway ? originName : 'the terminal'}, with hidden gems and a planner for your day ashore.`
    : `Where cruise ships dock in ${port.city}, ${port.country}, and a planner for your day ashore.`;

  const withWalk = list => list.map(place => ({ place, minutes: Math.max(1, Math.round(metres(origin, place) / 80)) })).sort((a, b) => a.minutes - b.minutes);
  const gemIds = new Set((guide?.hiddenGems || []).map(gem => gem.id));
  const stops = guide ? withWalk(guide.places.filter(p => !gemIds.has(p.id))) : [];
  const walkable = stops.some(s => s.minutes <= 30) ? stops.filter(s => s.minutes <= 30) : stops.slice(0, 8);
  const gems = guide ? withWalk(guide.hiddenGems || []) : [];
  const km = gateway ? Math.round(metres(terminals[0], origin) / 5000) * 5 : 0;
  const lede = gateway
    ? `Ships dock at ${esc(terminals[0].name)}, about ${km} km from ${esc(originName)}.${guide ? ` These are the stops worth the trip, timed on foot from the city centre.` : ''}`
    : `Ships dock at ${esc(terminals[0].name)}.${guide ? ` These are the stops worth your time, timed on foot from the terminal.` : ''}`;

  const walkSection = guide
    ? `<section><h2>Walkable from ${gateway ? 'the centre' : 'the pier'}</h2><p class="note">Walk times from ${esc(originName)}.</p><ol class="stops scroll" tabindex="0" aria-label="Stops by walking time">${walkable.map(stopRow).join('')}</ol>${stops.length ? `<a class="more" href="/?port=${esc(port.id)}">See all ${stops.length + gems.length} stops in the planner</a>` : ''}</section>`
    : `<section><h2>No guide yet</h2><p class="note">Portlore builds one the first time someone plans a day here. It takes about a minute: the sights, local food and a few hidden gems, sorted by how far you'll walk.</p></section>`;
  const gemSection = gems.length
    ? `<section class="gems"><h2><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/></svg>Hidden gems</h2><p class="note">Worth finding if you have an hour spare.</p><ol class="stops">${gems.map(stopRow).join('')}</ol></section>`
    : '';
  const nearbyLinks = nearby.length
    ? `<p class="nearby">More ports nearby: ${nearby.map(p => `<a href="/ports/${p.id}">${esc(p.city)}</a>`).join(', ')}.</p>`
    : '';

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${guide ? `<link rel="canonical" href="${url}">` : '<meta name="robots" content="noindex">'}
<meta property="og:title" content="${esc(`${port.city} cruise port guide`)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${url}">${photo ? `<meta property="og:image" content="${esc(photo.url)}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet">
<style>
:root { --navy: #0f2340; --steel: #4a7299; --brass: #b8954a; --brass-l: #dcc690; --muted: #5d6b80; --faint: #8995a7; --line: #ebe6dc; --page: #fbf9f4; --panel: radial-gradient(80% 110% at 0% 0%, rgba(220,198,144,.34) 0%, transparent 60%), linear-gradient(110deg, var(--steel) 0%, var(--navy) 72%); }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font: 17px/1.5 'DM Sans', system-ui, sans-serif; color: var(--navy); background: var(--page); -webkit-font-smoothing: antialiased; font-feature-settings: 'tnum' 1; }
a { color: inherit; text-underline-offset: 3px; }
a:focus-visible { outline: 2px solid var(--brass); outline-offset: 2px; }
.page { max-width: 1080px; margin: 0 auto; padding: 0 20px; }
.top { display: flex; justify-content: space-between; align-items: center; padding: 22px 0 18px; }
.brand { font-weight: 600; font-size: 22px; letter-spacing: -0.03em; text-decoration: none; }
.top a:last-child { font-size: 14px; font-weight: 500; }
.crumbs { font-size: 13px; color: var(--muted); }
.intro { display: grid; gap: 22px; padding: 22px 0 28px; }
h1 { font-size: clamp(60px, 14vw, 128px); font-weight: 600; letter-spacing: -0.05em; line-height: .88; }
h1.long { font-size: clamp(44px, 11vw, 92px); }
h1 span { display: block; font-size: clamp(22px, 3.4vw, 34px); font-weight: 500; letter-spacing: -0.02em; color: var(--steel); margin-top: 14px; line-height: 1.15; }
.lede { font-size: 19px; line-height: 1.5; max-width: 40ch; }
.cta { display: inline-block; margin-top: 20px; background: linear-gradient(95deg, #d8b861, #ecd79a); color: var(--navy); text-decoration: none; font-weight: 600; font-size: 17px; border-radius: 6px; padding: 15px 24px; box-shadow: 0 10px 24px rgba(184,149,74,.4); }
.cta:hover { filter: brightness(1.04); }
.cta-note { font-size: 14px; color: var(--muted); margin-top: 12px; }
.photo { margin: 0 -20px; }
.photo div { height: clamp(240px, 46vw, 420px); background: var(--navy) center / cover no-repeat; }
.photo figcaption { font-size: 11px; color: var(--faint); text-align: right; padding: 6px 20px 0; }
.photo figcaption a { text-decoration: none; }
.cols { display: grid; gap: 36px; padding: 36px 0 12px; }
h2 { font-size: 27px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.2; display: flex; align-items: center; gap: 10px; }
.note { color: var(--muted); margin-top: 4px; font-size: 16px; }
.docks { list-style: none; margin-top: 18px; display: grid; gap: 14px; }
.docks li { border-left: 4px solid var(--steel); padding: 4px 0 4px 14px; font-weight: 600; }
.stops { list-style: none; margin-top: 16px; border-top: 1px solid var(--line); }
.scroll { max-height: 404px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--line) transparent; -webkit-mask-image: linear-gradient(180deg, #000 85%, transparent); mask-image: linear-gradient(180deg, #000 85%, transparent); padding-bottom: 36px; }
.scroll:focus-visible { outline: 2px solid var(--brass); }
.stops li { display: grid; grid-template-columns: 60px 1fr; gap: 14px; padding: 16px 0; border-bottom: 1px solid var(--line); }
.walk { font-size: 34px; font-weight: 600; letter-spacing: -0.04em; line-height: .95; color: var(--steel); }
.walk.ride { font-size: 17px; letter-spacing: 0; }
.walk small { display: block; font-size: 11px; font-weight: 400; color: var(--faint); letter-spacing: 0; margin-top: 4px; }
.stops h3 { font-size: 17px; font-weight: 600; line-height: 1.3; }
.stops p { font-size: 15px; color: var(--muted); margin-top: 2px; }
.more { display: inline-block; margin-top: 14px; font-size: 15px; font-weight: 500; color: var(--steel); }
.gems { background: var(--panel); color: #fff; border-radius: 8px; padding: 26px 22px 12px; margin: 28px 0 8px; }
.gems svg { width: 20px; height: 20px; fill: none; stroke: var(--brass-l); stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
.gems .note, .gems .stops p, .gems .walk small { color: #cbd6e4; }
.gems .stops, .gems .stops li { border-color: rgba(255,255,255,.14); }
.gems .stops li:last-child { border-bottom: 0; }
.gems .walk { color: var(--brass-l); }
.nearby { padding: 28px 0 44px; }
.nearby a { font-weight: 500; }
footer { border-top: 1px solid var(--line); padding: 22px 20px; font-size: 13px; color: var(--faint); text-align: center; }
@media (min-width: 900px) {
  .page { padding: 0 40px; }
  .intro { grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); column-gap: 56px; align-items: start; padding: 30px 0 40px; }
  .intro > div:last-child { padding-top: 10px; }
  .photo { margin: 0 -20px; }
  .photo div { border-radius: 8px; }
  .photo figcaption { padding-right: 20px; }
  .cols { grid-template-columns: 1fr 1fr; column-gap: 56px; padding-top: 48px; }
  .gems { padding: 30px 26px 14px; }
  .gems .stops { columns: 2; column-gap: 40px; border-top: 0; }
  .gems .stops li { break-inside: avoid; border-top: 1px solid rgba(255,255,255,.14); border-bottom: 0; }
}
</style>
</head>
<body>
<div class="page">
  <header class="top"><a class="brand" href="/">Portlore</a><a href="/">All ports</a></header>
  <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Ports</a> / ${esc(port.country)} / ${esc(name)}</nav>
  <div class="intro">
    <h1${name.length > 10 ? ' class="long"' : ''}>${esc(name)}<span>${esc(kicker)}</span></h1>
    <div>
      <p class="lede">${lede}</p>
      <a class="cta" href="/?port=${esc(port.id)}">${guide ? `Plan my day in ${esc(gateway ? port.guideCentre : name)}` : 'Build the guide'}</a>
      <p class="cta-note">Free. Tell us when all aboard is and get a day that fits.</p>
    </div>
  </div>
  ${photo ? `<figure class="photo"><div style="background-image:url('${esc(photo.url)}')" role="img" aria-label="${esc(name)}"></div><figcaption><a href="${esc(photo.photographer_url)}">Photo: ${esc(photo.photographer)}, Pexels</a></figcaption></figure>` : ''}
  <div class="cols">
    <section><h2>Where ships dock</h2><p class="note">${terminals.length > 1 ? `${terminals.length} cruise terminals` : 'One cruise terminal'}${gateway ? `, about ${km} km from ${esc(originName)}` : ''}.</p><ul class="docks">${terminals.map(t => `<li>${esc(t.name)}</li>`).join('')}</ul></section>
    ${walkSection}
  </div>
  ${gemSection}
  ${nearbyLinks}
</div>
<footer>Portlore. Map data from OpenStreetMap contributors. <a href="/privacy">Privacy</a> and <a href="/terms">terms</a>.</footer>
</body></html>`;
}

export function renderSitemap(entries) {
  const urls = [`  <url><loc>${SITE}/</loc></url>`, ...entries.map(({ id, lastmod }) => `  <url><loc>${SITE}/ports/${id}</loc>${lastmod ? `<lastmod>${lastmod.slice(0, 10)}</lastmod>` : ''}</url>`)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}
