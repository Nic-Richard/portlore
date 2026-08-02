import fs from 'fs';

const [releasePath, serverPath] = process.argv.slice(2);

if (!releasePath || !serverPath) {
  console.error('Usage: node merge-ports.js <release-ports> <server-ports>');
  process.exit(1);
}

const releasePorts = JSON.parse(fs.readFileSync(releasePath, 'utf8'));
let serverPorts = [];

if (fs.existsSync(serverPath)) {
  serverPorts = JSON.parse(fs.readFileSync(serverPath, 'utf8'));
}

const serverById = new Map(serverPorts.map(port => [port.id, port]));
const mergedPorts = releasePorts.map(port => ({
  ...serverById.get(port.id),
  ...port,
  generated: false,
}));

fs.writeFileSync(serverPath, `${JSON.stringify(mergedPorts, null, 2)}\n`);
console.log(`Merged ${mergedPorts.length} ports. Generated state will be synced from current guide files.`);
