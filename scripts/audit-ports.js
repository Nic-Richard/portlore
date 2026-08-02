import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const portsPath = path.join(root, 'cities', 'ports.json');
const ports = JSON.parse(fs.readFileSync(portsPath, 'utf8'));

const normalize = (value) => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const distanceKm = (a, b) => {
  const toRad = (value) => value * Math.PI / 180;
  const earthKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthKm * Math.asin(Math.sqrt(value));
};

const duplicateCandidates = [];
for (let i = 0; i < ports.length; i += 1) {
  for (let j = i + 1; j < ports.length; j += 1) {
    const km = distanceKm(ports[i], ports[j]);
    if (km <= 8) {
      duplicateCandidates.push({
        first: ports[i].id,
        second: ports[j].id,
        distanceKm: Number(km.toFixed(2))
      });
    }
  }
}

const malformedIds = ports
  .map((port) => ({
    id: port.id,
    expected: `${normalize(port.city)}-${normalize(port.country)}`
  }))
  .filter((entry) => entry.id !== entry.expected);

const countries = [...new Set(ports.map((port) => port.country))].sort();
console.log(JSON.stringify({
  ports: ports.length,
  countries: countries.length,
  duplicateCandidates,
  malformedIds
}, null, 2));
