import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const assetsRequire = createRequire(require.resolve('@capacitor/assets'));
const sharp = assetsRequire('sharp');
const root = new URL('../', import.meta.url);
const web = new URL('../../client/public/', import.meta.url);
const full = await fs.readFile(new URL('brand/liner.png', root));
const compact = await fs.readFile(new URL('brand/favicon.png', root));
const navy = '#0f3553';
const png = (source, size) => sharp(source).resize(size, size).png().toBuffer();

for (const size of [16, 32, 48, 64, 192, 512]) {
  await fs.writeFile(new URL(size < 100 ? `favicon-${size}.png` : `icon-${size}.png`, web), await png(size <= 32 ? compact : full, size));
}
await fs.writeFile(new URL('apple-touch-icon.png', web), await png(full, 180));

const entries = await Promise.all([16, 32, 48, 64].map(async size => ({ size, data: await png(size <= 32 ? compact : full, size) })));
const header = Buffer.alloc(6 + entries.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(entries.length, 4);
let offset = header.length;
entries.forEach(({ size, data }, index) => {
  const start = 6 + index * 16;
  header[start] = size; header[start + 1] = size;
  header.writeUInt16LE(1, start + 4); header.writeUInt16LE(32, start + 6);
  header.writeUInt32LE(data.length, start + 8); header.writeUInt32LE(offset, start + 12);
  offset += data.length;
});
await fs.writeFile(new URL('favicon.ico', web), Buffer.concat([header, ...entries.map(entry => entry.data)]));

const fullSvg = (await png(full, 128)).toString('base64');
const compactSvg = (await png(compact, 64)).toString('base64');
await fs.writeFile(new URL('favicon.svg', web), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><style>#compact{display:none}@media(max-width:32px){#full{display:none}#compact{display:block}}</style><image id="full" width="128" height="128" href="data:image/png;base64,${fullSvg}"/><image id="compact" width="128" height="128" href="data:image/png;base64,${compactSvg}"/></svg>\n`);

await fs.writeFile(new URL('assets/icon-only.png', root), await png(full, 1024));
await fs.writeFile(new URL('assets/icon-foreground.png', root), await png(full, 1024));
await fs.writeFile(new URL('assets/icon-background.png', root), await sharp({ create: { width: 1024, height: 1024, channels: 3, background: navy } }).png().toBuffer());
const splashMark = await png(full, 640);
const splash = await sharp({ create: { width: 2732, height: 2732, channels: 3, background: '#0f2340' } }).composite([{ input: splashMark, gravity: 'centre' }]).png().toBuffer();
for (const name of ['splash.png', 'splash-dark.png']) await fs.writeFile(new URL('assets/' + name, root), splash);

execFileSync(process.execPath, [require.resolve('@capacitor/assets/bin/capacitor-assets'), 'generate', '--android'], { cwd: fileURLToPath(root), stdio: 'inherit' });
const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground><inset android:drawable="@mipmap/ic_launcher_foreground" android:inset="16.7%"/></foreground>
</adaptive-icon>
`;
for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) await fs.writeFile(new URL('android/app/src/main/res/mipmap-anydpi-v26/' + name, root), adaptive);
console.log('Generated Portlore branding: solid through 32px, line art above 32px.');
