#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REVIEW_FILE = path.join(ROOT, 'data', 'terminal-review.json');
const PORTS_FILE = path.join(ROOT, 'cities', 'ports.json');
const POI_DIR = path.join(ROOT, 'cities', 'poi');
const REBUILD_THRESHOLD_METERS = 3000;

function usage() {
  console.log(`Usage: node scripts/apply-terminal-review.js [options]

Applies data/terminal-review.json to cities/ports.json and cities/poi/.

Options:
  --with-new-ports   Add new ports to ports.json even before their catalogs exist
  --dry-run          Report what would change without writing files
  -h, --help         Show this help`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value, trailingNewline = true) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}${trailingNewline ? '\n' : ''}`);
}

function haversineMeters(a, b) {
  const toRadians = value => (value * Math.PI) / 180;
  const lat1 = toRadians(Number(a.lat));
  const lat2 = toRadians(Number(b.lat));
  const deltaLat = lat2 - lat1;
  const deltaLng = toRadians(Number(b.lng) - Number(a.lng));
  const value = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value)));
}

function anchorFor(review, current) {
  const anchor = review.anchor || { basis: 'terminal' };
  if (anchor.basis === 'terminal') return { lat: review.terminals[0].lat, lng: review.terminals[0].lng };
  if (Number.isFinite(anchor.lat) && Number.isFinite(anchor.lng)) return { lat: anchor.lat, lng: anchor.lng };
  return { lat: current.lat, lng: current.lng };
}

function applyToCatalog(catalog, id, review, reviewedAt) {
  const terminals = review.terminals.map(terminal => ({ ...terminal, sourceId: terminal.id }));
  catalog.terminals = terminals;
  catalog.terminal = terminals[0];
  catalog.defaultTerminalId = terminals[0].id;
  catalog.terminalResolution = {
    status: 'resolved',
    method: 'terminal_review',
    verified: true,
    reviewedAt,
    notes: review.reviewNote || '',
  };
  if (catalog.port) catalog.port = { ...catalog.port, id, city: review.city || catalog.port.city };
  return catalog;
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('-h') || args.has('--help')) return usage();
  const dryRun = args.has('--dry-run');
  const withNewPorts = args.has('--with-new-ports');

  const review = readJson(REVIEW_FILE);
  let ports = readJson(PORTS_FILE);
  const removed = new Set(review.removedPorts || []);
  const needsRebuild = [];
  const log = { removed: 0, updated: 0, added: 0, pendingNew: [] };

  const beforeCount = ports.length;
  ports = ports.filter(port => !removed.has(port.id));
  log.removed = beforeCount - ports.length;
  for (const id of removed) {
    const file = path.join(POI_DIR, `${id}.json`);
    if (fs.existsSync(file) && !dryRun) fs.rmSync(file);
  }

  const byId = new Map(ports.map(port => [port.id, port]));
  const updatePort = (id, entry) => {
    const port = byId.get(id);
    const anchor = anchorFor(entry, port);
    if (entry.city) port.city = entry.city;
    port.terminal = entry.terminals[0].name;
    port.lat = anchor.lat;
    port.lng = anchor.lng;

    const file = path.join(POI_DIR, `${id}.json`);
    if (!fs.existsSync(file)) {
      needsRebuild.push({ id, reason: 'no catalog' });
      return;
    }
    const catalog = readJson(file);
    const builtFrom = catalog.portAnchor || anchor;
    const moved = haversineMeters(builtFrom, anchor);
    if (moved > REBUILD_THRESHOLD_METERS) needsRebuild.push({ id, reason: `anchor moved ${(moved / 1000).toFixed(1)} km` });
    if (!dryRun) writeJson(file, applyToCatalog(catalog, id, entry, review.reviewedAt), false);
    log.updated += 1;
  };

  for (const [id, entry] of Object.entries(review.ports)) {
    if (!byId.has(id)) throw new Error(`${id} is in the review but not in ports.json`);
    updatePort(id, entry);
  }

  for (const entry of review.newPorts || []) {
    const hasCatalog = fs.existsSync(path.join(POI_DIR, `${entry.id}.json`));
    if (!byId.has(entry.id)) {
      if (!hasCatalog && !withNewPorts) {
        log.pendingNew.push(entry.id);
        continue;
      }
      const anchor = anchorFor(entry, {});
      const port = {
        id: entry.id,
        city: entry.city,
        country: entry.country,
        terminal: entry.terminals[0].name,
        address: `${entry.city}, ${entry.country}`,
        lat: anchor.lat,
        lng: anchor.lng,
        region: entry.region,
        generated: false,
      };
      ports.push(port);
      byId.set(entry.id, port);
      log.added += 1;
    }
    updatePort(entry.id, entry);
  }

  ports.sort((a, b) => a.id.localeCompare(b.id));
  if (!dryRun) writeJson(PORTS_FILE, ports);

  console.log(`${dryRun ? 'Would apply' : 'Applied'} terminal review: ${ports.length} ports, ${log.updated} catalogs updated, ${log.removed} ports removed, ${log.added} ports added.`);
  if (log.pendingNew.length) console.log(`New ports waiting for catalogs (rerun with --with-new-ports to add them): ${log.pendingNew.join(', ')}`);
  if (needsRebuild.length) {
    console.log(`Catalogs to rebuild around the new anchor (${needsRebuild.length}):`);
    for (const item of needsRebuild) console.log(`  ${item.id}: ${item.reason}`);
  }
}

main();
