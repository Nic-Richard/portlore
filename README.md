# Portlore

Portlore is a cruise port guide that helps passengers find worthwhile places near where they disembark and plan what they can realistically fit into a day ashore.

The project is built around turning messy geographic data into useful destination guides. It starts with ports from around the world, resolves practical passenger terminal locations, gathers large sets of nearby POIs, and filters them through several rounds of cleanup and review. The finished guide presents the strongest options in a visual map and itinerary interface, with travel estimates and practical port information to help passengers plan their time ashore.

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
shared/                  Shared POI, geocoding, and terminal logic
scripts/                 Catalog and guide generation tools
cities/ports.json        Current port catalog
cities/poi/              Curated POI catalogs
```

The frontend is currently contained in `client/src/index.html` and can be reworked into a more structured client later.

## Current data flow

1. `scripts/generate-ports.js` creates a broad candidate list from the World Port Index dataset.
2. Candidates are reviewed before being added to `cities/ports.json`.
3. `scripts/build-all-poi-catalogs.js` downloads the required OpenStreetMap extracts.
4. `scripts/build-poi-catalog.js` extracts nearby POI candidates for each port.
5. POIs are reviewed and saved in `cities/poi/`.
6. Google Places matching adds Place IDs and terminal candidates.
7. Anthropic is used for short destination descriptions and practical tips.
8. The server calculates route, distance, and terminal access information.

Generated guides are stored as `cities/<port-id>.json`. They are runtime files and are not committed to Git.

## Work in progress

The port list, cruise-port filtering, terminal records, and POI catalogs are still being refined.

The current `cities/ports.json` contains a manually reviewed working catalog, but it may still include unsuitable ports, miss valid cruise destinations, or combine terminals that should be treated separately.

Run the initial port candidate generator with:

```bash
node scripts/generate-ports.js
```

It writes `cities/port-candidates.json`. This file is ignored by Git and does not replace `cities/ports.json`.

The generator only applies a broad physical-port filter. It does not confirm that a port currently receives passenger cruises.

## Rebuild POI candidates

Run the batch builder with:

```bash
node scripts/build-all-poi-catalogs.js
```

It creates `cities/osm-extracts.json`, downloads the required `.osm.pbf` files, and builds local POI data. The manifest, raw extracts, and `cities/poi-raw/` output are ignored by Git.

Validate the committed port and POI data with:

```bash
node scripts/validate-data.js
```

Audit nearby ports and possible ID issues with:

```bash
node scripts/audit-ports.js
```

## Local setup

Requirements:

- Node.js 20 or newer
- Anthropic API key
- Google Maps Platform key with Places and Routes access
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

Resolve Google Places data without generating the full guide:

```bash
node scripts/resolve-google-places.js saint-john-canada
```

Process a small batch:

```bash
node scripts/resolve-google-places.js --all --limit=10
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

The scripts can rebuild new POI candidates from current OpenStreetMap data, but they cannot reproduce the committed catalogs exactly. The current catalogs include automated extraction, manual review, assisted curation, and later cleanup.

## Removing ports

To remove a port from the project:

1. Delete its entry from `cities/ports.json`.
2. Delete its matching file from `cities/poi/`.
3. Run `node scripts/validate-data.js`.
4. Delete any old generated guide for that port from the server when appropriate.

Normal deployment preserves generated guides, so removed ports are not deleted from the server automatically.
