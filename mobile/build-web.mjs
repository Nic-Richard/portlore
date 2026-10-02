// Copies the web client into www/, the folder Capacitor bundles into the app.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const client = path.join(here, '..', 'client');
const www = path.join(here, 'www');

fs.rmSync(www, { recursive: true, force: true });
fs.cpSync(path.join(client, 'public'), www, { recursive: true });
// The app draws edge to edge, under the status bar; the website keeps its normal viewport.
const html = fs.readFileSync(path.join(client, 'src', 'index.html'), 'utf8')
  .replace('maximum-scale=1.0"', 'maximum-scale=1.0, viewport-fit=cover"');
if (!html.includes('viewport-fit=cover')) throw new Error('The viewport meta tag changed; update build-web.mjs.');
fs.writeFileSync(path.join(www, 'index.html'), html);
console.log(`Copied the client into ${path.relative(process.cwd(), www) || 'www'}`);
