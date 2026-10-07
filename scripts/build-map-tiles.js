import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAP_TIERS } from '../client/src/basemap.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const maxBytes = 15 * 1024 ** 3;

export function mapRegion(anchors, radiusKm) {
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) throw Error('Invalid coverage radius');
  const polygon = (west, south, east, north) => [[[west, south], [east, south], [east, north], [west, north], [west, south]]];
  return { type: 'MultiPolygon', coordinates: anchors.flatMap(({ lat, lng }) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) throw Error('Invalid map anchor');
    // 110.5 km per degree keeps rectangles outside the radius even near the equator.
    const dy = radiusKm / 110.5;
    const south = Math.max(-85.05112878, lat - dy), north = Math.min(85.05112878, lat + dy);
    const dx = Math.min(180, radiusKm / (110.5 * Math.cos(Math.max(Math.abs(south), Math.abs(north)) * Math.PI / 180)));
    const west = lng - dx, east = lng + dx;
    if (west < -180) return [polygon(-180, south, east, north), polygon(west + 360, south, 180, north)];
    if (east > 180) return [polygon(west, south, 180, north), polygon(-180, south, east - 360, north)];
    return [polygon(west, south, east, north)];
  }) };
}

function run(cli, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, args, { windowsHide: true });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(Error(`${args[0]} failed (${code}): ${output}`)));
  });
}

async function hash(file) {
  const digest = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

async function main(argv) {
  const options = { cli: 'pmtiles', download: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--download') options.download = true;
    else if (['--build', '--output', '--cli'].includes(key)) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw Error(`Missing value for ${key}`);
      options[key.slice(2)] = argv[++i];
    } else if (key === '--help') {
      console.log('Usage: node scripts/build-map-tiles.js --build YYYYMMDD [--cli path] [--output directory] [--download]\nDefaults to index-only sizing. --download extracts and verifies all five tiers, up to 15 GiB.');
      return;
    } else throw Error(`Unknown option: ${key}`);
  }
  const build = options.build;
  if (!/^\d{8}$/.test(build || '')) throw Error('Choose a valid build date with --build YYYYMMDD');
  const date = new Date(`${build.slice(0, 4)}-${build.slice(4, 6)}-${build.slice(6, 8)}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10).replaceAll('-', '') !== build) throw Error('Choose a valid build date with --build YYYYMMDD');
  const output = path.resolve(options.output || path.join(root, 'data/map-tiles', build));
  if (options.download && fs.existsSync(output)) throw Error('Choose a new output directory; existing map files will not be overwritten');
  const source = `https://build.protomaps.com/${build}.pmtiles`;
  const portsFile = path.join(root, 'data/cruise-ports.json');
  const ports = JSON.parse(fs.readFileSync(portsFile, 'utf8')).ports;
  const anchors = ports.flatMap(port => [...port.terminals, ...(port.guideCentre ? [port.guideCentre] : [])]);
  const temporary = fs.mkdtempSync(path.join(tmpdir(), 'portlore-map-regions-'));
  try {
    const metadata = JSON.parse(await run(options.cli, ['show', source, '--metadata']));
    if (!/^4\./.test(metadata.version || '')) throw Error('This renderer requires a version-4 Protomaps basemap');
    const plan = [];
    for (const tier of MAP_TIERS) {
      const args = [`--minzoom=${tier.minZoom}`, `--maxzoom=${tier.maxZoom}`, '--overfetch=0.05'];
      if (tier.radiusKm) {
        const region = path.join(temporary, `${tier.radiusKm}.geojson`);
        fs.writeFileSync(region, JSON.stringify(mapRegion(anchors, tier.radiusKm)));
        args.push(`--region=${region}`);
      }
      console.log(`Sizing ${tier.file}...`);
      const report = await run(options.cli, ['extract', source, path.join(temporary, tier.file), '--dry-run', ...args]);
      const match = report.match(/archive size of ([\d.]+) (B|kB|MB|GB|TB)/);
      if (!match) throw Error(`Could not read size estimate for ${tier.file}: ${report}`);
      const bytes = Number(match[1]) * { B: 1, kB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 }[match[2]];
      plan.push({ ...tier, bytes, args });
      console.log(`${tier.file}: ${(bytes / 1024 ** 3).toFixed(2)} GiB`);
    }
    const estimated = plan.reduce((sum, tier) => sum + tier.bytes, 0);
    if (estimated * 1.03 > maxBytes) throw Error('Estimated tiles exceed the 15 GiB budget with rounding/metadata allowance');
    console.log(`Total estimate: ${(estimated / 1024 ** 3).toFixed(2)} GiB. No tile payload downloaded during sizing.`);
    if (!options.download) return;
    const existingParent = path.dirname(output);
    fs.mkdirSync(existingParent, { recursive: true });
    const disk = fs.statfsSync(existingParent);
    if (disk.bavail * disk.bsize < estimated * 1.1) throw Error('Not enough free disk space for extraction');
    fs.mkdirSync(output);
    const files = [];
    for (const tier of plan) {
      const partial = path.join(output, `${tier.file}.partial`);
      console.log(`Extracting ${tier.file}...`);
      await run(options.cli, ['extract', source, partial, '--quiet', ...tier.args]);
      await run(options.cli, ['verify', partial, '--quiet']);
      const bytes = fs.statSync(partial).size;
      if (files.reduce((sum, file) => sum + file.bytes, bytes) > maxBytes) throw Error('Extracted tiles exceed 15 GiB; do not upload this dataset');
      const sha256 = await hash(partial);
      fs.renameSync(partial, path.join(output, tier.file));
      files.push({ file: tier.file, bytes, sha256, minZoom: tier.minZoom, maxZoom: tier.maxZoom, radiusKm: tier.radiusKm });
    }
    fs.writeFileSync(path.join(output, 'build.json'), JSON.stringify({ source, tilesetVersion: metadata.version, portsSha256: await hash(portsFile), anchors: anchors.length, created: new Date().toISOString(), files }, null, 2) + '\n');
    console.log(`Verified ${(files.reduce((sum, file) => sum + file.bytes, 0) / 1024 ** 3).toFixed(2)} GiB in ${output}. No server files changed.`);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
