#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DEFAULT_MANIFEST = path.join(ROOT, 'cities', 'osm-extracts.json');
const PORTS_FILE = path.join(ROOT, 'cities', 'ports.json');
const RAW_OUT_DIR = path.join(ROOT, 'cities', 'poi-raw');
const OUT_DIR = path.join(ROOT, 'cities', 'poi');
const SINGLE_BUILDER = path.join(__dirname, 'build-poi-catalog.js');
const MANIFEST_SYNC = path.join(__dirname, 'sync-osm-extracts.js');
const MAX_REDIRECTS = 8;

function usage() {
  console.log(`Usage: node scripts/build-all-poi-catalogs.js [options]

Options:
  --manifest <file>                  Extract manifest (default: cities/osm-extracts.json)
  --ports <id,id,...>                Only rebuild these ports and keep every other catalog
  --batch-extracts <n>               Download n extracts at a time and delete them after use (for small disks)
  --dry-run                          Validate and show planned downloads/builds
  --strict                           Fail when any port is not assigned to an extract
  --download-only                    Download required extracts without building catalogs
  --no-sync-manifest                 Use the existing manifest instead of refreshing it
  --refresh-extracts                 Redownload extracts even when they already exist
  --no-download                      Never download; fail when a required PBF is missing
  --radius <metres>                  POI radius from ports.json coordinates (default: 10000)
  -h, --help                         Show this help`);
}

function parseArgs(argv) {
  const args = {
    manifest: DEFAULT_MANIFEST,
    dryRun: false,
    strict: false,
    downloadOnly: false,
    syncManifest: true,
    refreshExtracts: false,
    noDownload: false,
    radius: 10000,
    ports: null,
    batchExtracts: 0,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--manifest') args.manifest = path.resolve(argv[++i]);
    else if (key === '--ports') args.ports = new Set(String(argv[++i] || '').split(',').map(id => id.trim()).filter(Boolean));
    else if (key === '--batch-extracts') args.batchExtracts = Number(argv[++i]);
    else if (key === '--dry-run') args.dryRun = true;
    else if (key === '--strict') args.strict = true;
    else if (key === '--download-only') args.downloadOnly = true;
    else if (key === '--no-sync-manifest') args.syncManifest = false;
    else if (key === '--refresh-extracts') args.refreshExtracts = true;
    else if (key === '--no-download') args.noDownload = true;
    else if (key === '--radius') args.radius = Number(argv[++i]);
    else if (key === '--help' || key === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${key}`);
  }

  if (args.noDownload && args.refreshExtracts) throw new Error('--no-download cannot be combined with --refresh-extracts.');
  return args;
}

function readJson(file, label) {
  if (!fs.existsSync(file)) throw new Error(`${label} not found: ${file}`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function resolveProjectPath(manifestFile, value) {
  if (!value || typeof value !== 'string') return '';
  if (path.isAbsolute(value)) return value;
  if (value.startsWith('./') || value.startsWith('../')) return path.resolve(path.dirname(manifestFile), value);
  return path.resolve(ROOT, value);
}

function validateManifest(manifest, ports, manifestFile) {
  if (manifest?.schemaVersion !== 2 || !Array.isArray(manifest.extracts)) {
    throw new Error('OSM extract manifest must use schemaVersion 2 and contain an extracts array.');
  }

  const portById = new Map();
  for (const port of ports) {
    if (!port?.id) throw new Error('Every ports.json entry must have an id.');
    if (portById.has(port.id)) throw new Error(`Duplicate port id in ports.json: ${port.id}`);
    portById.set(port.id, port);
  }

  const extractIds = new Set();
  const assignments = new Map();
  const extracts = [];
  const jobs = [];
  const errors = [];

  for (const source of manifest.extracts) {
    if (!source?.id || typeof source.id !== 'string') {
      errors.push('Every extract must have a string id.');
      continue;
    }
    if (extractIds.has(source.id)) errors.push(`Duplicate extract id: ${source.id}`);
    extractIds.add(source.id);

    const pbf = resolveProjectPath(manifestFile, source.pbf);
    const url = typeof source.url === 'string' ? source.url.trim() : '';
    if (!pbf) errors.push(`${source.id}: missing pbf path.`);
    if (!url) errors.push(`${source.id}: missing download URL.`);
    else {
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) errors.push(`${source.id}: URL must use HTTP or HTTPS.`);
      } catch {
        errors.push(`${source.id}: invalid download URL.`);
      }
    }
    if (!Array.isArray(source.ports) || !source.ports.length) errors.push(`${source.id}: ports must be a non-empty array.`);
    if (source.countries !== undefined && (!Array.isArray(source.countries) || !source.countries.length)) {
      errors.push(`${source.id}: countries must be a non-empty array when provided.`);
    }

    const extract = { ...source, pbf, url };
    extracts.push(extract);

    for (const portId of source.ports || []) {
      const port = portById.get(portId);
      if (!port) {
        errors.push(`${source.id}: unknown port id ${portId}.`);
        continue;
      }
      if (assignments.has(portId)) {
        errors.push(`${portId} is assigned to both ${assignments.get(portId)} and ${source.id}.`);
        continue;
      }
      if (Array.isArray(source.countries) && !source.countries.includes(port.country)) {
        errors.push(`${source.id}: ${portId} is in ${port.country}, which is not listed in countries.`);
        continue;
      }
      assignments.set(portId, source.id);
      jobs.push({ extractId: source.id, pbf, port });
    }
  }

  if (errors.length) throw new Error(`Manifest validation failed:\n- ${errors.join('\n- ')}`);
  const unassigned = ports.filter(port => !assignments.has(port.id));
  return { extracts, jobs, unassigned };
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function downloadFile(url, destination, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) {
      reject(new Error(`Too many redirects while downloading ${url}`));
      return;
    }

    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, { headers: { 'User-Agent': 'Portlore-POI-Catalog-Builder/1.0' } }, response => {
      const status = response.statusCode || 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        const redirected = new URL(location, url).toString();
        downloadFile(redirected, destination, redirectCount + 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${status}: ${url}`));
        return;
      }

      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const temp = `${destination}.part`;
      const output = fs.createWriteStream(temp);
      const total = Number(response.headers['content-length'] || 0);
      let received = 0;
      let lastPercent = -1;

      response.on('data', chunk => {
        received += chunk.length;
        if (total > 0) {
          const percent = Math.floor((received / total) * 100);
          if (percent >= lastPercent + 10 || percent === 100) {
            process.stdout.write(`  ${percent}% (${formatBytes(received)} of ${formatBytes(total)})\n`);
            lastPercent = percent;
          }
        }
      });

      response.pipe(output);
      output.on('finish', () => {
        output.close(() => {
          try {
            if (!fs.existsSync(temp) || fs.statSync(temp).size === 0) throw new Error('Downloaded file is empty.');
            fs.rmSync(destination, { force: true });
            fs.renameSync(temp, destination);
            resolve({ bytes: fs.statSync(destination).size, finalUrl: url });
          } catch (error) {
            fs.rmSync(temp, { force: true });
            reject(error);
          }
        });
      });
      output.on('error', error => {
        response.destroy();
        fs.rmSync(temp, { force: true });
        reject(error);
      });
    });

    request.setTimeout(120000, () => request.destroy(new Error(`Download timed out: ${url}`)));
    request.on('error', error => {
      fs.rmSync(`${destination}.part`, { force: true });
      reject(error);
    });
  });
}



async function confirmPoiDeletion() {
  if (!fs.existsSync(OUT_DIR) && !fs.existsSync(RAW_OUT_DIR)) return true;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('cities/poi or cities/poi-raw already exists. Run this command in an interactive terminal and confirm deletion.');
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question('Existing cities/poi and cities/poi-raw folders will be deleted before rebuilding. Continue? [y/N] ')).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

function extractNeedsBuild() {
  return true;
}

async function prepareExtracts(extracts, jobs, args) {
  const results = new Map();

  for (let index = 0; index < extracts.length; index += 1) {
    const extract = extracts[index];
    const needed = extractNeedsBuild();
    if (!needed) {
      results.set(extract.id, { status: 'not-needed' });
      continue;
    }

    const exists = fs.existsSync(extract.pbf);
    const shouldDownload = args.refreshExtracts || !exists;
    console.log(`\nExtract [${index + 1}/${extracts.length}] ${extract.id}`);

    if (!shouldDownload) {
      console.log(`Using cached ${path.relative(ROOT, extract.pbf)} (${formatBytes(fs.statSync(extract.pbf).size)})`);
      results.set(extract.id, { status: 'cached' });
      continue;
    }

    if (args.noDownload) {
      const error = `PBF is missing and downloads are disabled: ${extract.pbf}`;
      console.error(error);
      results.set(extract.id, { status: 'failed', error });
      continue;
    }

    if (args.dryRun) {
      console.log(`${exists ? 'Would refresh' : 'Would download'} ${extract.url}`);
      console.log(`Destination: ${path.relative(ROOT, extract.pbf)}`);
      results.set(extract.id, { status: 'planned' });
      continue;
    }

    console.log(`${exists ? 'Refreshing' : 'Downloading'} ${extract.url}`);
    console.log(`Destination: ${path.relative(ROOT, extract.pbf)}`);
    try {
      const downloaded = await downloadFile(extract.url, extract.pbf);
      console.log(`Saved ${formatBytes(downloaded.bytes)}`);
      results.set(extract.id, { status: 'downloaded' });
    } catch (error) {
      console.error(`${extract.id}: ${error.message}`);
      results.set(extract.id, { status: 'failed', error: error.message });
    }
  }

  return results;
}

function runJob(job, args, extractStatus) {
  const output = path.join(OUT_DIR, `${job.port.id}.json`);
  if (extractStatus?.status === 'failed') return { status: 'failed', error: `extract unavailable: ${extractStatus.error}` };
  if (args.dryRun) return { status: 'planned', output };
  if (!fs.existsSync(job.pbf)) return { status: 'failed', error: `PBF not found: ${job.pbf}` };

  const childArgs = [
    SINGLE_BUILDER,
    '--pbf', job.pbf,
    '--port', job.port.id,
    '--radius', String(args.radius),
  ];
  const result = spawnSync(process.execPath, childArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) return { status: 'failed', error: `builder exited with code ${result.status}` };

  try {
    const catalog = JSON.parse(fs.readFileSync(output, 'utf8'));
    if (catalog.port?.id !== job.port.id) return { status: 'failed', error: 'generated catalog port id does not match the assigned port' };
    if (catalog.sourceExtract !== path.basename(job.pbf)) return { status: 'failed', error: 'generated catalog sourceExtract does not match the assigned PBF' };
  } catch (error) {
    return { status: 'failed', error: `generated catalog validation failed: ${error.message}` };
  }
  return { status: 'completed', output };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) return usage();
  if (!Number.isFinite(args.radius) || args.radius <= 0) {
    throw new Error('Radius must be a positive number.');
  }

  if (args.syncManifest) {
    console.log('Refreshing OSM extract assignments from the Geofabrik index.');
    const syncResult = spawnSync(process.execPath, [MANIFEST_SYNC, '--output', args.manifest], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (syncResult.stdout) process.stdout.write(syncResult.stdout);
    if (syncResult.stderr) process.stderr.write(syncResult.stderr);
    if (syncResult.status !== 0) throw new Error(`Manifest sync exited with code ${syncResult.status}.`);
  }

  const ports = readJson(PORTS_FILE, 'ports.json');
  if (!Array.isArray(ports)) throw new Error('ports.json must contain an array.');
  const manifest = readJson(args.manifest, 'OSM extract manifest');
  const validated = validateManifest(manifest, ports, args.manifest);
  let { extracts, jobs, unassigned } = validated;
  if (args.ports) {
    const unknown = [...args.ports].filter(id => !ports.some(port => port.id === id));
    if (unknown.length) throw new Error(`Unknown port id(s): ${unknown.join(', ')}`);
    jobs = jobs.filter(job => args.ports.has(job.port.id));
    const needed = new Set(jobs.map(job => job.extractId));
    extracts = extracts.filter(extract => needed.has(extract.id));
    unassigned = unassigned.filter(port => args.ports.has(port.id));
  }

  console.log(`Validated ${jobs.length} port assignment(s) across ${extracts.length} extract(s).`);
  if (unassigned.length) {
    console.warn(`${unassigned.length} port(s) are not assigned to an OSM extract.`);
    for (const port of unassigned.slice(0, 20)) console.warn(`  - ${port.id}`);
    if (unassigned.length > 20) console.warn(`  ...and ${unassigned.length - 20} more`);
    if (args.strict) throw new Error('Strict mode requires every port in ports.json to be assigned.');
  }

  if (!args.downloadOnly && !args.dryRun && !args.ports) {
    const confirmed = await confirmPoiDeletion();
    if (!confirmed) {
      console.log('Cancelled. Existing POI catalogs were not changed.');
      return;
    }
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
    fs.rmSync(RAW_OUT_DIR, { recursive: true, force: true });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.mkdirSync(RAW_OUT_DIR, { recursive: true });
    console.log('Cleared previous raw and candidate POI catalogs. Building a fresh source-of-truth set.');
  }

  const extractCounts = { downloaded: 0, cached: 0, planned: 0, failed: 0, notNeeded: 0 };
  const batchSize = args.batchExtracts > 0 && !args.downloadOnly && !args.dryRun ? args.batchExtracts : extracts.length;
  const counts = { completed: 0, skipped: 0, planned: 0, failed: 0 };
  const failures = [];
  let jobNumber = 0;
  for (let start = 0; start < extracts.length; start += batchSize) {
    const batch = extracts.slice(start, start + batchSize);
    if (batchSize < extracts.length) console.log(`\nBatch ${start / batchSize + 1} of ${Math.ceil(extracts.length / batchSize)}`);
    const extractResults = await prepareExtracts(batch, jobs, args);
    for (const result of extractResults.values()) {
      if (result.status === 'not-needed') extractCounts.notNeeded += 1;
      else extractCounts[result.status] += 1;
    }
    if (args.downloadOnly) continue;

    const batchIds = new Set(batch.map(extract => extract.id));
    for (const job of jobs.filter(item => batchIds.has(item.extractId))) {
      jobNumber += 1;
      console.log(`\nPort [${jobNumber}/${jobs.length}] ${job.port.id} using ${job.extractId}`);
      const result = runJob(job, args, extractResults.get(job.extractId));
      counts[result.status] += 1;
      if (result.status === 'failed') {
        failures.push({ portId: job.port.id, error: result.error });
        console.error(`${job.port.id}: ${result.error}`);
      } else if (result.status === 'planned') {
        console.log(`${job.port.id}: would build from ${path.relative(ROOT, job.pbf)}`);
      }
    }
    // Small disks: drop this batch's extracts before downloading the next.
    if (batchSize < extracts.length) {
      for (const extract of batch) fs.rmSync(extract.pbf, { force: true });
    }
  }

  if (args.downloadOnly) {
    console.log('\nDownload summary');
    console.log(`Downloaded: ${extractCounts.downloaded}`);
    console.log(`Cached: ${extractCounts.cached}`);
    if (args.dryRun) console.log(`Planned: ${extractCounts.planned}`);
    console.log(`Failed: ${extractCounts.failed}`);
    if (extractCounts.failed) process.exitCode = 1;
    return;
  }

  console.log('\nBatch summary');
  console.log(`Extracts downloaded: ${extractCounts.downloaded}`);
  console.log(`Extracts cached: ${extractCounts.cached}`);
  console.log(`Extract failures: ${extractCounts.failed}`);
  console.log(`Catalogs completed: ${counts.completed}`);
  console.log(`Catalogs skipped: ${counts.skipped}`);
  if (args.dryRun) console.log(`Catalogs planned: ${counts.planned}`);
  console.log(`Catalogs failed: ${counts.failed}`);
  console.log(`Unassigned ports: ${unassigned.length}`);

  if (failures.length) {
    console.log('\nFailures');
    for (const failure of failures) console.log(`- ${failure.portId}: ${failure.error}`);
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
