import { distanceMeters } from './port-resolution.js';

function photoText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/['\u2019]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function portPhotoQuery(port, anchor) {
  const city = port.guideCentre || port.city;
  if (port.guideCentre) return `${city} ${port.country}`;
  const address = ` ${photoText(anchor?.address)} `;
  if (anchor && distanceMeters(port.lat, port.lng, anchor.lat, anchor.lng) < 3000
      && address.includes(` ${photoText(city)} `) && address.includes(` ${photoText(port.country)} `)) {
    return anchor.address;
  }
  return `${city} ${port.country}`;
}
