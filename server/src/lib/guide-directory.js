const SITE = 'https://portlore.com';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderGuideDirectory(ports) {
  const countries = new Map();
  for (const port of [...ports].sort((a, b) => a.country.localeCompare(b.country) || a.city.localeCompare(b.city))) {
    if (!countries.has(port.country)) countries.set(port.country, []);
    countries.get(port.country).push(port);
  }
  const groups = [...countries].map(([country, entries], index) => ({ country, entries, anchor: `country-${index + 1}` }));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cruise port guides by country | Portlore</title>
<meta name="description" content="Browse published Portlore cruise port guides by country. Find where ships dock, nearby sights, local food and a planner for your day ashore.">
<link rel="canonical" href="${SITE}/guides">
<link rel="icon" href="/favicon.ico?v=liner-circle" sizes="16x16 32x32 48x48 64x64">
<meta name="theme-color" content="#0f2340">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Portlore">
<meta property="og:title" content="Cruise port guides by country | Portlore">
<meta property="og:description" content="Find your next port and plan a day ashore with Portlore's published cruise port guides.">
<meta property="og:url" content="${SITE}/guides">
<meta property="og:image" content="${SITE}/og-image.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet">
<style>
* { box-sizing: border-box; }
body { margin: 0; background: #fbf9f4; color: #0f2340; font: 17px/1.5 'DM Sans', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
a { color: inherit; text-underline-offset: 4px; }
a:focus-visible { outline: 2px solid #b8954a; outline-offset: 4px; }
.page { max-width: 1080px; margin: auto; padding: 0 24px; }
header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 16px; padding: 24px 0; }
.brand { font-size: 22px; font-weight: 600; letter-spacing: -.03em; text-decoration: none; }
header > a:last-child { font-size: 15px; }
.intro { max-width: 680px; padding: 36px 0 28px; }
h1 { font-size: clamp(38px, 8vw, 72px); font-weight: 600; line-height: 1.05; letter-spacing: -.04em; margin: 0 0 20px; }
.intro p { color: #5d6b80; margin: 12px 0; }
.count { font-size: 15px; }
nav { display: flex; flex-wrap: wrap; gap: 4px 22px; border-block: 1px solid #e2ddd3; padding: 18px 0; }
nav a { display: inline-block; padding: 9px 0; color: #355b80; }
summary { cursor: pointer; padding: 12px 0; color: #355b80; font-weight: 500; }
section { padding: 32px 0; border-bottom: 1px solid #e2ddd3; scroll-margin-top: 24px; }
h2 { margin: 0 0 16px; font-size: 27px; font-weight: 500; letter-spacing: -.02em; }
ul { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 0 32px; list-style: none; padding: 0; margin: 0; }
li a { display: block; padding: 11px 0; overflow-wrap: anywhere; }
footer { display: flex; flex-wrap: wrap; gap: 12px 24px; padding: 32px 0; font-size: 14px; color: #5d6b80; }
</style>
</head>
<body>
<div class="page">
<header><a class="brand" href="/">Portlore</a><a href="/">Plan my day</a></header>
<main>
<div class="intro"><h1>Cruise port guides</h1><p>Find where your ship docks, what is worth seeing nearby, and how to fit it into your time ashore.</p><p class="count">${ports.length} published ${ports.length === 1 ? 'guide' : 'guides'} across ${groups.length} ${groups.length === 1 ? 'country or territory' : 'countries and territories'}.</p></div>
${groups.length ? `<details><summary>Jump to a country or territory</summary><nav aria-label="Countries and territories">${groups.map(({ country, anchor }) => `<a href="#${anchor}">${esc(country)}</a>`).join('')}</nav></details>` : '<p>No guides are published yet. <a href="/">Choose a port to get started</a>.</p>'}
${groups.map(({ country, entries, anchor }) => `<section id="${anchor}" aria-labelledby="${anchor}-title"><h2 id="${anchor}-title">${esc(country)}</h2><ul>${entries.map(port => `<li><a href="/ports/${esc(port.id)}">${esc(port.city)}${port.guideCentre ? ` <span>— ${esc(port.guideCentre)}</span>` : ''}</a></li>`).join('')}</ul></section>`).join('')}
</main>
<footer><span>Portlore</span><a href="/privacy">Privacy</a><a href="/terms">Terms</a></footer>
</div>
</body>
</html>`;
}
