// Copies the Jinharsh Catalogues public pages into Mitul's PHP catalogue hub (sites/catalog.jinharsh.com in
// mitulv4u/jinharsh-subsites), so catalog.jinharsh.com looks and works like this app while his api.php keeps doing
// the saving (catalogue list, visits, queries, team uploads).
//   node tools/php-hub/build.mjs <site folder>
// What it does:
// - js/, css/, vendor/, assets/ in the site folder are replaced by this app's files (his api.php, team.html,
//   catalogs.json, pdfs/, data/ and covers/ are never touched)
// - every address gets the /hub/ in front (the hub is served from /hub/; / shows /hub/index.html)
// - .mjs files become .js: his Apache sends .mjs with no type and browsers then refuse to run them
// - public/js/backend.js is swapped for tools/php-hub/backend.js (his api.php instead of /api/...)
// - index.html is made from this app's view.html (a catalogue) and index.html (the front page)
// Covers: tools/php-hub/make-covers.mjs.
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const PUB = path.join(ROOT, 'public');
const DEST = process.argv[2];
if (!DEST || !existsSync(path.join(DEST, 'api.php'))) { console.error('Give the hub folder (the one with api.php).'); process.exit(1); }

const TEAM_ONLY = new Set(['library.js', 'insights.js', 'login.js', 'api.js']);
const RENAME = { 'qrcode.mjs': 'qrcode.js', 'pdf.min.mjs': 'pdf.min.js', 'pdf.worker.min.mjs': 'pdf.worker.min.js' };
const fix = (s) => s
  .replace(/(["'`(])\/(vendor|js|css|assets)\//g, '$1/hub/$2/')
  .replace(/qrcode\.mjs/g, 'qrcode.js').replace(/pdf\.worker\.min\.mjs/g, 'pdf.worker.min.js').replace(/pdf\.min\.mjs/g, 'pdf.min.js');
const read = (p) => fs.readFile(p, 'utf8').then((s) => s.replace(/\r\n/g, '\n'));

async function copyDir(from, to, { text = false } = {}) {
  await fs.mkdir(to, { recursive: true });
  for (const e of await fs.readdir(from, { withFileTypes: true })) {
    const src = path.join(from, e.name), dst = path.join(to, RENAME[e.name] || e.name);
    if (e.isDirectory()) await copyDir(src, dst, { text });
    else if (text && /\.(m?js|css)$/.test(e.name)) await fs.writeFile(dst, fix(await read(src)));
    else await fs.copyFile(src, dst);
  }
}

// 1. the folders this build owns start empty
for (const d of ['js', 'css', 'vendor', 'assets']) await fs.rm(path.join(DEST, d), { recursive: true, force: true });

// 2. the page code, with /hub/ addresses
await fs.mkdir(path.join(DEST, 'js'), { recursive: true });
const jsFiles = (await fs.readdir(path.join(PUB, 'js'))).filter((f) => f.endsWith('.js') && !TEAM_ONLY.has(f));
for (const f of jsFiles) await fs.writeFile(path.join(DEST, 'js', f), fix(await read(path.join(PUB, 'js', f))));
await fs.writeFile(path.join(DEST, 'js', 'backend.js'), await read(path.join(HERE, 'backend.js')));
const site = JSON.parse(await fs.readFile(path.join(ROOT, 'site.json'), 'utf8'));
site.contact = { ...site.contact, whatsapp: '912240900000' };   // the hub's WhatsApp line
site.links = [{ label: 'Technical Wiki', href: 'https://catalog.jinharsh.co.in/index.php/Product_Range' }];
await fs.writeFile(path.join(DEST, 'js', 'boot.js'), (await read(path.join(HERE, 'boot.js'))).replace('/*SITE*/{}', JSON.stringify(site)));

// every module a page imports must be here
for (const f of await fs.readdir(path.join(DEST, 'js'))) {
  const s = await read(path.join(DEST, 'js', f));
  for (const m of s.matchAll(/(?:from\s+|import\()\s*'\.\/([\w-]+\.js)'/g)) if (!existsSync(path.join(DEST, 'js', m[1]))) throw new Error(`${f} needs ${m[1]}, which is not copied`);
}

// 3. styles, the kit, fonts, icons, the PDF reader, pictures
await fs.mkdir(path.join(DEST, 'css'), { recursive: true });
for (const f of ['app.css', 'view.css', 'hub.css']) await fs.writeFile(path.join(DEST, 'css', f), fix(await read(path.join(PUB, 'css', f))));
await fs.mkdir(path.join(DEST, 'vendor'), { recursive: true });
for (const f of ['jinharsh-ui.css', 'jinharsh-ui.js']) await fs.copyFile(path.join(PUB, 'vendor', f), path.join(DEST, 'vendor', f)); // the kit, unchanged
await fs.writeFile(path.join(DEST, 'vendor', 'icons.js'), await read(path.join(PUB, 'vendor', 'icons.js')));
await fs.copyFile(path.join(PUB, 'vendor', 'qrcode.mjs'), path.join(DEST, 'vendor', 'qrcode.js'));
await copyDir(path.join(PUB, 'vendor', 'fonts'), path.join(DEST, 'vendor', 'fonts'));
await copyDir(path.join(PUB, 'vendor', 'pdfjs'), path.join(DEST, 'vendor', 'pdfjs'));
await copyDir(path.join(PUB, 'assets'), path.join(DEST, 'assets'));

// 4. the page: the top of this app's two pages, and the bodies of both as templates (one is chosen at once)
const view = await read(path.join(PUB, 'view.html')), hub = await read(path.join(PUB, 'index.html'));
const body = (html) => fix(/<body[^>]*>([\s\S]*?)<\/body>/.exec(html)[1])
  .replace(/\s*<script type="module"[^>]*><\/script>/g, '').replace(/\s*<!--DATA-->/g, '').replace('<!--HERO-->', '').trim();
// each page fetches ahead only the scripts it needs (boot.js first)
const preloadsOf = (html) => ['/hub/js/boot.js', ...[...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => fix(`"${m[1]}`).slice(1))];
const viewPre = preloadsOf(view), hubPre = preloadsOf(hub);
const html = `<!DOCTYPE html>
<html class="ju" lang="en">
<head>
  <!-- synced via jinharsh-subsites -->
  <!-- Made from the Jinharsh Catalogues app (github.com/adi6499/PDFUPLOADER) by tools/php-hub/build.mjs: change it there.
       api.php, team.html, catalogs.json, pdfs/ and covers/ are this hub's own. -->
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>JINHARSH Catalog Hub — Interactive Industrial Catalogs &amp; PDF Downloads</title>
  <meta name="description" content="Official JINHARSH interactive catalog hub. View and download Timken, Regal Rexnord, Lovejoy, ABB, Groz, Dräger, and Flexco industrial catalogs.">
  <meta name="theme-color" content="#f4f4f6" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)">
  <link rel="icon" href="/hub/assets/favicon-32.png" sizes="32x32">
  <link rel="apple-touch-icon" href="/hub/assets/apple-touch-icon.png">
  <!-- asked for straight away, while the rest of the page is still arriving: the list of catalogues, a catalogue
       page's cover picture, and only the scripts this page needs -->
  <script>
    window.CATALOGS_REQ = fetch('/hub/api.php?action=catalogs').then(function (r) { if (!r.ok) throw r; return r.json(); });
    window.CATALOGS_REQ.catch(function () {});
    (function () {
      var m = /[?&]cat=([A-Za-z0-9-]{1,120})(&|$)/.exec(location.search), h = document.head;
      function add(rel, href, as) { var l = document.createElement('link'); l.rel = rel; l.href = href; if (as) { l.as = as; l.setAttribute('fetchpriority', 'high'); } h.appendChild(l); }
      if (m) add('preload', '/hub/covers/' + m[1] + '.webp', 'image');
      (m ? ${JSON.stringify(viewPre)} : ${JSON.stringify(hubPre)}).forEach(function (p) { add('modulepreload', p); });
    })();
  </script>
  <link rel="stylesheet" href="/hub/vendor/jinharsh-ui.css">
  <link rel="stylesheet" href="/hub/css/app.css">
  <link rel="stylesheet" href="/hub/css/view.css">
  <link rel="stylesheet" href="/hub/css/hub.css">
  <script src="/hub/js/theme-boot.js"></script>
  <script src="/hub/vendor/jinharsh-ui.js"></script>
  <link rel="preload" href="/hub/vendor/fonts/Geist-Latin.woff2" as="font" type="font/woff2" crossorigin>
</head>
<body class="viewer">
<template id="t-view">
${body(view)}
</template>
<template id="t-hub">
${body(hub)}
</template>
<script>
  // the frame of the page straight away: a catalogue (/?cat=<id>, with its cover) or the front page
  (function () {
    var m = /[?&]cat=([A-Za-z0-9-]{1,120})(&|$)/.exec(location.search), b = document.body, kind = m ? 'view' : 'hub';
    b.className = m ? 'viewer' : 'viewer hub';
    b.dataset.shell = kind;
    b.insertBefore(document.getElementById('t-' + kind).content.cloneNode(true), document.currentScript);
    if (m) document.getElementById('app').innerHTML = '<section class="v-hero"><div class="v-cover"><img src="/hub/covers/' + m[1] +
      '.webp" alt="" width="720" height="1018" fetchpriority="high" onerror="var s=this.closest(\\'.v-hero\\');if(s)s.remove()"></div></section>';
  })();
</script>
<script type="module" src="/hub/js/boot.js"></script>
</body>
</html>
`;
await fs.writeFile(path.join(DEST, 'index.html'), html);
console.log(`built into ${DEST}: ${jsFiles.length} scripts, index.html, css, vendor, assets`);
