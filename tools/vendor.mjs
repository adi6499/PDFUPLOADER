// Copies the outside libraries the site needs from node_modules into public/vendor,
// so the finished site never depends on anyone else's server.
// Run after `npm install`:  npm run vendor
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, 'public', 'vendor');
const kitDir = join(root, '..'); // the Jinharsh UI kit lives in Downloads, next to this project

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'pdfjs'), { recursive: true });
mkdirSync(join(out, 'fonts'), { recursive: true });

// 1. PDF.js (Mozilla) - reads PDFs in the browser: covers, page counts, the reader on the scan page
const pdf = join(nm, 'pdfjs-dist');
cpSync(join(pdf, 'build', 'pdf.min.mjs'), join(out, 'pdfjs', 'pdf.min.mjs'));
cpSync(join(pdf, 'build', 'pdf.worker.min.mjs'), join(out, 'pdfjs', 'pdf.worker.min.mjs'));
for (const d of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  if (existsSync(join(pdf, d))) cpSync(join(pdf, d), join(out, 'pdfjs', d), { recursive: true });
}
cpSync(join(pdf, 'LICENSE'), join(out, 'pdfjs', 'LICENSE'));

// 2. QR code maker (MIT)
cpSync(join(nm, 'qrcode-generator', 'dist', 'qrcode.mjs'), join(out, 'qrcode.mjs'));
writeFileSync(join(out, 'qrcode.LICENSE'), 'qrcode-generator by Kazuhiko Arase - MIT licence (see the header of qrcode.mjs).\n');

// 3. Geist font (SIL Open Font License)
cpSync(join(nm, 'geist', 'dist', 'fonts', 'geist-sans', 'Geist-Variable.woff2'), join(out, 'fonts', 'Geist-Variable.woff2'));
cpSync(join(nm, 'geist', 'dist', 'fonts', 'geist-mono', 'GeistMono-Variable.woff2'), join(out, 'fonts', 'GeistMono-Variable.woff2'));
cpSync(join(nm, 'geist', 'LICENSE.txt'), join(out, 'fonts', 'LICENSE.txt'));

// 4. The Jinharsh UI kit - copied exactly as it is (the brief says: do not rewrite it)
for (const f of ['jinharsh-ui.css', 'jinharsh-ui.js']) {
  const src = existsSync(join(kitDir, f)) ? join(kitDir, f) : join(root, 'kit', f);
  cpSync(src, join(out, f));
}

// 5. Lucide icons (ISC) -> one small JS file with only the icons we use
const ICONS = ['upload', 'qr-code', 'link', 'download', 'share-2', 'external-link', 'refresh-cw', 'archive',
  'archive-restore', 'trash-2', 'sun', 'moon', 'settings', 'search', 'chevron-down', 'check', 'phone', 'mail',
  'globe', 'message-circle', 'file-text', 'lock', 'printer', 'copy', 'x', 'plus', 'eye', 'scan-line', 'history',
  'book-open', 'arrow-down-to-line', 'monitor', 'smartphone', 'sliders-horizontal', 'circle-alert', 'image',
  'pencil', 'arrow-left', 'arrow-up', 'maximize-2', 'zoom-in', 'zoom-out', 'circle-check', 'id-card'];
const map = {};
for (const name of ICONS) {
  const svg = readFileSync(join(nm, 'lucide-static', 'icons', name + '.svg'), 'utf8');
  const inner = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
    .replace(/\s+/g, ' ').replace(/> </g, '><').trim();
  map[name] = inner;
}
writeFileSync(join(out, 'icons.js'),
  '// Lucide icons (ISC licence), only the ones this site uses. Made by tools/vendor.mjs - do not edit.\n' +
  'export const ICONS = ' + JSON.stringify(map, null, 0) + ';\n' +
  "export function icon(name, cls) { const p = ICONS[name] || ''; return '<svg class=\"i' + (cls ? ' ' + cls : '') + '\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">' + p + '</svg>'; }\n");
cpSync(join(nm, 'lucide-static', 'LICENSE'), join(out, 'icons.LICENSE'));

// 6. Vercel Blob upload helper (Apache-2.0): only the trial copy on Vercel uses it, to send PDFs straight into its storage
const { build } = await import('esbuild');
await build({
  entryPoints: [join(nm, '@vercel/blob', 'dist', 'client.js')], bundle: true, format: 'esm', platform: 'browser',
  target: 'es2020', minify: true, outfile: join(out, 'blob-client.mjs'), legalComments: 'none', logLevel: 'warning',
  define: { 'process.env': '{}' }, // server-only settings: always empty in a browser
});
cpSync(join(nm, '@vercel/blob', 'license.md'), join(out, 'blob-client.LICENSE.md'));

console.log('Vendor files copied to public/vendor');
