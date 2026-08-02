#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function slugify(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function inferRegion(country, lat, lng) {
  const c = (country || '').toLowerCase();

  if (/canada/.test(c)) {
    if (lng < -141) return 'alaska';
    if (lng < -100) return 'pacific-northwest';
    if (lng > -95 && lng < -75 && lat < 50) return 'other';
    return 'atlantic-canada';
  }

  if (/united states/.test(c)) {
    if (lat < 25 && lng < -140) return 'asia-pacific'; // Hawaii.
    if (lng < -130 && lat > 54) return 'alaska';
    if (lng < -115) return 'pacific-northwest';
    if (lng > -95 && lng < -75 && lat > 40) return 'other'; // Great Lakes.
    if (lat < 31 && lng > -98) return 'caribbean'; // Gulf Coast.
    return 'us-east-coast';
  }

  if (/norway|sweden|denmark|finland|estonia|latvia|lithuania|poland|germany|netherlands|belgium|united kingdom|ireland|iceland|faroe/.test(c)) return 'northern-europe';
  if (/russia/.test(c)) return lng > 100 ? 'asia-pacific' : 'northern-europe';
  if (/spain|france|italy|greece|turkey|croatia|montenegro|malta|cyprus|israel|egypt|tunisia|algeria|morocco|portugal|slovenia|albania|libya|ukraine|georgia|romania|bulgaria|lebanon|syria|gibraltar/.test(c)) return 'mediterranean';
  if (/bahamas|jamaica|cuba|haiti|dominican|puerto rico|trinidad|barbados|antigua|grenada|lucia|kitts|aruba|cura[çc]ao|cayman|belize|honduras|costa rica|panama|guatemala|nicaragua|el salvador|bonaire|sint eustatius|virgin|turks|martinique|guadeloupe|bermuda/.test(c)) return 'caribbean';
  if (/mexico/.test(c)) return lng > -92 ? 'caribbean' : 'pacific-northwest';
  if (/brazil|argentina|uruguay|chile|peru|ecuador|guyana|suriname|colombia|venezuela/.test(c)) return 'south-america';
  if (/japan|china|korea|taiwan|philippines|indonesia|malaysia|singapore|thailand|vietnam|australia|new zealand|fiji|vanuatu|polynesia|papua|myanmar|cambodia|brunei|hong kong|macau|india|pakistan|sri lanka/.test(c)) return 'asia-pacific';
  if (/united arab|oman|qatar|bahrain|kuwait|saudi|iran|iraq|jordan|yemen|djibouti|eritrea/.test(c)) return 'middle-east';
  return 'other';
}

function isCruiseCapable(p) {
  const size = (p.port_size || '').toLowerCase();
  const maxVessel = (p.max_vessel_size || '').toLowerCase();
  const channelDepth = p.channel_depth_min_m;

  if (size === 'very small' || size === 'small') return false;

  const hasOilTerminal = p.oil_terminal_depth_min_m !== null || p.oil_terminal_depth_max_m !== null;
  const hasCargoOrPassengerPier = p.cargo_pier_depth_min_m !== null || p.cargo_pier_depth_max_m !== null;
  if (hasOilTerminal && !hasCargoOrPassengerPier) return false;

  const canFitLargeVessel = maxVessel === 'large vessels' || size === 'major';
  if (!canFitLargeVessel) return false;

  if (channelDepth !== null && channelDepth < 8) return false;

  return true;
}

async function main() {
  console.log('Downloading World Port Index...');

  const r = await fetch('https://raw.githubusercontent.com/tayljordan/ports/main/ports.json');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const raw = await r.json();
  const all = raw.ports || raw;
  console.log(`${all.length} ports downloaded`);

  const cruise = all.filter(isCruiseCapable);
  console.log(`${cruise.length} cruise-capable ports after filtering`);

  const ports = cruise.map(p => {
    const city = (p.point_of_interest || p.wpi_port_name || '').trim();
    const country = (p.country || '').trim();
    return {
      id: slugify(`${city}-${country}`),
      city,
      country,
      terminal: (p.wpi_port_name || city) + ' Port',
      address: `${city}${p.state ? ', ' + p.state : ''}, ${country}`,
      lat: p.latitude,
      lng: p.longitude,
      region: inferRegion(country, p.latitude, p.longitude),
      generated: city === 'Saint John' && country === 'Canada',
    };
  }).filter(p => p.id && p.city && p.lat && p.lng);

  const seen = new Set();
  const unique = ports.filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id); return true;
  });

  const outputPath = path.join(__dirname, '..', 'cities', 'port-candidates.json');
  fs.writeFileSync(outputPath, JSON.stringify(unique, null, 2));
  console.log(`${unique.length} candidate ports written to ${outputPath}`);

  const byRegion = {};
  unique.forEach(p => { byRegion[p.region] = (byRegion[p.region] || 0) + 1; });
  Object.entries(byRegion).sort((a,b) => b[1]-a[1]).forEach(([r,n]) => console.log(`  ${r}: ${n}`));
}

main().catch(err => { console.error(err.message); process.exit(1); });
