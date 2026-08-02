function finiteCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function slugify(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function fallbackTerminal(port) {
  const lat = finiteCoordinate(port?.lat);
  const lng = finiteCoordinate(port?.lng);
  if (lat === null || lng === null) return null;
  const name = port.terminal || `${port.city || 'Cruise'} port`;
  return {
    id: 'ports-json-anchor',
    name,
    lat,
    lng,
    address: port.address || '',
    source: 'ports.json',
    sourceId: '',
    score: 0,
    slug: slugify(name),
  };
}

export function distanceMeters(aLat, aLng, bLat, bLng) {
  const radius = 6371000;
  const toRad = value => value * Math.PI / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}
