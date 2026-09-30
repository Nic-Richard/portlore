# Portlore

Portlore is a cruise port guide that helps passengers find worthwhile places near where they disembark and plan what they can realistically fit into a day ashore.

It covers 631 cruise ports. For each one it finds the real passenger terminals, gathers the notable places nearby, and has a language model curate them into a guide with the must-see sights, local favourites, and a few hidden gems, presented on a map and itinerary with travel estimates from the passenger's terminal.

**Live site:** https://portlore.com

## Features

- Search and browse port destinations
- View port and terminal locations on a map
- Explore attractions, food, shopping, and practical stops
- Compare walking and driving estimates
- Build an itinerary with visit and travel time
- Open matched locations in Google Maps
- Generate guides for ports that do not have one yet

## Project structure

```text
client/                  Static frontend
server/                  Express API and generation routes
shared/                  Shared POI selection, curation, and Google Places logic
scripts/                 Port list, catalog, and guide generation tools
data/cruise-ports.json   The port list: ports, cruise terminals, and gateway city centres
cities/ports.json        Generated from data/cruise-ports.json
cities/poi/              Generated POI shortlists, one per port
```

The frontend is currently contained in `client/src/index.html` and can be reworked into a more structured client later.

## How the data is made

**Ports and terminals.** `data/cruise-ports.json` is the only hand-maintained data. The list was assembled with an assisted review and checked against CruiseMapper's published cruise schedules: a port belongs on it when cruise or passenger ships call there and passengers step ashore into a town. A few ports with paused or occasional calls are kept on purpose. Terminals were located with Google Places and OpenStreetMap, then reviewed port by port. Pins that mark the harbour rather than a confirmed berth are flagged `approximate`. Ports whose ships dock far from the city visitors come for, such as Civitavecchia for Rome, carry a `guideCentre`.

**Shortlists.** Every catalog in `cities/poi/` is generated from the port list and OpenStreetMap. For each port, the builder gathers places within 10 km and keeps up to 80. Fame comes from how many Wikipedia editions cover a place (`data/wikidata-fame.json`, fetched from Wikidata by `scripts/fetch-wikidata-fame.js`): each port's best-known landmarks go in first, then each category is filled with a mix of types, favouring well-known and well-documented places near the terminal. Chains never count as famous, and entries with no useful details are skipped, so small ports get shorter lists. Places with a Wikipedia article carry its opening sentences (`data/wikipedia-intros.json`, fetched by `scripts/fetch-wikipedia-intros.js`), so guides describe them from real facts.

**Editor's picks and hidden gems.** `data/curated-picks.json` lists hand-picked places that always make a port's shortlist, matched by name and location. A pick that isn't in OpenStreetMap is built from its own entry. Picks marked `gem` (about five per port, mostly sights and food) are hidden-gem candidates: the model keeps the ones that hold up for the guide's Hidden gems section and can add its own. Gems given by name only are passed to the model as suggestions and located with Google Places if kept.

**Guides.** On a port's first visit, or with `scripts/generate-city.js`, Gemini curates the shortlist into the guide, planning around the terminals (set `CITY_MODEL_PROVIDER=anthropic` to use Claude instead). Google Places then confirms the chosen stops, drops any that have closed, and fills in each stop's category, hours, and website. Restaurants, cafés, and shops with no Wikipedia or OpenStreetMap description are rewritten from the text of their own website, so details like a menu are real, and links to parked domains are dropped.

**Port pages.** Every port has a page at `/ports/<id>`, rendered by the server from the port list and the port's guide: where ships dock, the stops within walking distance, and the hidden gems. Only ports with a current guide are indexed and listed in `/sitemap.xml`; the rest are marked `noindex` until someone plans a day there. `/?port=<id>` opens the planner with that port selected.

## Rebuilding the data

After editing `data/cruise-ports.json`, regenerate the port list and attach terminals to the catalogs:

```bash
node scripts/build-port-list.js
```

Build or rebuild catalogs for specific ports, keeping every other catalog:

```bash
node scripts/build-all-poi-catalogs.js --ports saint-john-canada,halifax-canada
node scripts/build-port-list.js
```

Rebuild everything, with 8 OpenStreetMap extracts on disk at a time:

```bash
cd scripts
npm run catalogs
```

Building needs [osmium-tool](https://osmcode.org/osmium-tool/). Each catalog records the extract it was built from (`sourceExtract`). Rebuilds always use the latest OpenStreetMap data, so shortlists pick up new and closed places.

After new catalogs are built, refresh the fame counts, then the Wikipedia intros for the shortlisted places:

```bash
node scripts/fetch-wikidata-fame.js
node scripts/reselect-poi-candidates.js
node scripts/fetch-wikipedia-intros.js
node scripts/reselect-poi-candidates.js
```

To rerun the shortlist rules on catalogs that are already built, for example after editing `data/curated-picks.json`:

```bash
node scripts/reselect-poi-candidates.js --ports saint-john-canada
```

Check that ports and catalogs line up, and run the shortlist and guide-building tests:

```bash
node scripts/validate-data.js
node scripts/smoke-shared.js
```

GitHub Actions runs both on every push, along with a syntax check and a check that `cities/ports.json` and the catalogs match `data/cruise-ports.json`.

## Local setup

Requirements:

- Node.js 20 or newer
- Gemini API key (or an Anthropic API key, with `CITY_MODEL_PROVIDER=anthropic`)
- Google Maps Platform key with Places access
- Pexels API key

Create the local environment file:

```bash
cp .env.example .env
```

Install dependencies:

```bash
cd server
npm install

cd ../scripts
npm install
```

Start the API:

```bash
cd server
npm start
```

Serve `client/src/` with a static web server on port `8080` to run the frontend locally.

## Generate a guide

Generate one guide:

```bash
node scripts/generate-city.js saint-john-canada
```

Generated guides are written to `cities/<port-id>.json`. The source files in `cities/poi/` are not changed.

## Deployment

Copy `.env.deploy.example` to `.env.deploy` and add the SSH target and remote directory.

Deploy with:

```bash
bash scripts/deploy.sh
```

The script uploads the release, installs server dependencies, preserves existing generated guides, restarts Portlore with PM2, checks the health endpoint, and reloads Nginx.

## Data notes

Portlore is a planning tool. Opening hours, accessibility, transportation, terminal use, and cruise schedules can change. Travelers should confirm important details with official sources.

Map data comes from OpenStreetMap contributors. Place descriptions draw on Wikipedia (CC BY-SA). Line icons are from [Lucide](https://lucide.dev) (ISC licence), plus a few drawn for Portlore in the same style.

## Adding or removing ports

1. Add or delete the port's entry in `data/cruise-ports.json`.
2. Run `node scripts/build-port-list.js --prune`, which also deletes catalogs for removed ports.
3. For a new port, build its catalog with `node scripts/build-all-poi-catalogs.js --ports <id>`, then run `build-port-list.js` again.
4. Run `node scripts/validate-data.js`.

Normal deployment preserves generated guides, so a removed port's old guide stays on the server until it is deleted there.
