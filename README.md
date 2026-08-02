# Portlore

Portlore is a cruise-port day-planning guide for passengers who want practical stops near their terminal. It combines a curated OpenStreetMap point-of-interest catalog with Google Places matching, route calculations, and a small Anthropic enrichment step that produces visitor-facing descriptions and tips.

**Live site:** https://portlore.com

## Features

- Search and browse 310 cruise destinations
- Port and terminal-aware maps
- Curated attractions, food, shopping, and practical stops
- Walking and driving estimates from the selected terminal
- Custom itinerary planning with visit and travel time
- Google Maps links backed by resolved Place IDs
- On-demand generation for ports that do not yet have a published guide

## Repository structure

```text
client/                  Static single-page frontend
server/                  Express API and generation routes
shared/                  POI curation, geocoding, and terminal logic
scripts/                 Offline catalog and guide-generation tools
cities/ports.json        Port index and fallback anchors
cities/poi/              Final curated POI catalogs for all ports
```

The frontend intentionally lives in `client/src/index.html`. It is a dependency-free static application rather than a Vite or React project.

## Data pipeline

The repository contains the final curated POI catalogs used by the application. It does not include the large raw `.osm.pbf` extracts or earlier intermediate catalogs.

The current flow is:

1. `scripts/generate-ports.js` can produce a broad WIP candidate list from the World Port Index dataset.
2. Candidate ports are reviewed and filtered before selected records are added to `cities/ports.json`.
3. `cities/ports.json` defines the supported ports and fallback anchors.
4. `scripts/build-all-poi-catalogs.js` refreshes the temporary Geofabrik extract manifest and downloads the required source extracts.
5. `scripts/build-poi-catalog.js` extracts local POI candidates.
6. The resulting catalogs are curated and stored in `cities/poi/`.
7. Google Places matching resolves stable Place IDs and passenger terminal candidates.
8. The Anthropic API adds concise visitor descriptions and practical tips.
9. The server calculates terminal distance, access, and route information in code.

Generated user-facing guides are runtime data stored as `cities/<port-id>.json`. They are intentionally ignored by Git. The live server currently contains only the guides that have been generated or uploaded there.


## Port discovery status

Port discovery, passenger-cruise filtering, and the current manually curated port catalog are still works in progress.

The committed `cities/ports.json` is the best current working set for the live product, but it has not yet received a final verification pass. It may still include non-passenger ports, miss legitimate cruise destinations, or group nearby terminals too broadly.

Run the broad candidate generator with:

```bash
node scripts/generate-ports.js
```

It writes `cities/port-candidates.json`, which is ignored by Git. The script uses physical port characteristics as a first-pass filter and does not confirm that a port is an active passenger cruise destination.

The generated candidates must be reviewed before records are added to `cities/ports.json`. That catalog is manually curated but remains provisional. The script never overwrites the production port catalog.
## Rebuild POI candidates

The batch builder regenerates `cities/osm-extracts.json` automatically before downloading extracts and building catalogs:

```bash
node scripts/build-all-poi-catalogs.js
```

The manifest, raw PBF files, and `cities/poi-raw/` output are generated locally and ignored by Git. Use `--no-sync-manifest` only when deliberately reusing an existing local manifest.

Validate the committed port and catalog data with:

```bash
node scripts/validate-data.js
```

Review nearby-port candidates and ID anomalies with:

```bash
node scripts/audit-ports.js
```

## Local setup

Requirements:

- Node.js 20 or newer
- Anthropic API key
- Google Maps Platform key with Places and Routes access
- Pexels API key for destination imagery

Copy the environment template:

```bash
cp .env.example .env
```

Install server and script dependencies. Commit the generated lockfiles before publishing the repository so installs remain repeatable:

```bash
cd server && npm install
cd ../scripts && npm install
```

Start the API:

```bash
cd server
npm start
```

Serve `client/src/` with any static web server on port `8080` for local development.

## Generate a guide

Generate one port locally:

```bash
node scripts/generate-city.js saint-john-canada
```

Resolve Google Places data without generating the full guide:

```bash
node scripts/resolve-google-places.js saint-john-canada
```

Batch example:

```bash
node scripts/resolve-google-places.js --all --limit=10
```

Generated guides are written to `cities/<port-id>.json`. Source POI catalogs are never rewritten by the guide-generation step.

## Deployment

Copy `.env.deploy.example` to `.env.deploy` and configure the SSH target. The real deployment file is ignored by Git.

```bash
bash scripts/deploy.sh
```

The script can be run from any directory. It uploads the application, merges the port index without discarding generated-state flags, installs dependencies, validates the health endpoint, and reloads Nginx.

## Data limitations

Portlore is a planning guide, not a source of truth for opening hours, accessibility, transportation availability, or cruise schedules. POIs and terminal records retain source metadata where available, but travelers should confirm time-sensitive details with official sources.

## Data reproducibility

The included extraction pipeline can rebuild raw and preselected POI candidates from current OpenStreetMap data. It cannot deterministically recreate the exact committed final catalogs.

The final catalogs in `cities/poi/` reflect several stages of work, including automated OSM extraction, candidate reselection, manual review, assisted curation, targeted attraction recovery, and later cleanup passes. The repository does not include every intermediate catalog, prompt, result, or historical OSM snapshot used during that process.

This means the scripts can produce a new candidate dataset from current source data, while the committed curated catalogs remain the source of truth for the current product.

## Trimming the port catalog

The master catalog is `cities/ports.json`. To remove ports later:

1. Remove the unwanted entries from `cities/ports.json`.
2. Remove their matching files from `cities/poi/`.
3. Run `node scripts/validate-data.js` to verify the remaining catalog.
4. Remove any stale generated guide files from the server as a separate explicit maintenance step.

Generated city guides are intentionally preserved during normal deployment because they are runtime output and are not committed to this repository. Normal deployment therefore does not automatically delete guides for ports removed from `ports.json`.
