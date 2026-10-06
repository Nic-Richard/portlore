const plainText = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export function findPorts(ports, query) {
  const normalized = plainText(query);
  return ports.filter(port => [port.city, port.country, port.terminal].some(value => plainText(value).includes(normalized))).slice(0, 8);
}
