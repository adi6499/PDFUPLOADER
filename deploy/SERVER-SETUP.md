# Jinharsh Catalogues: putting it on catalog.jinharsh.com

For whoever looks after the aaPanel server (159.89.94.209). About 30 minutes, once.

**What this is:** the catalogue site. The team uploads PDFs (catalogues, flyers) in the browser; each gets a QR code
that is printed on visiting cards, posters and stands. Customers scan it and read or download the PDF.
It **replaces the old catalogue hub** on catalog.jinharsh.com (the one-page hub that reads `hub/catalogs.json`):

- every old hub link keeps working: `catalog.jinharsh.com/?cat=timken-srb` opens the same catalogue,
  so any QR already printed from the old hub stays good;
- the old hub's 10 catalogues are brought across with the same names (step 5);
- the team no longer copies PDFs into `hub/pdfs/` or edits `catalogs.json`: they upload at `catalog.jinharsh.com/team`.

**Good to know:**
- It is a small Node.js program (no extra packages, no database) from `github.com/adi6499/PDFUPLOADER` (public).
  It is **not** a static site, so it does **not** go in `mitulv4u/jinharsh-subsites`.
- The program and its uploaded PDFs live in folders **outside** `/www/wwwroot`, so no sync or update can delete them.
- The address `catalog.jinharsh.com` is printed inside every QR code: it must keep working for as long as cards exist.

## 1. Node.js

aaPanel → **App Store** → install **Node.js version manager** (or "PM2 Manager") → install **Node 20 or newer**.
Check in the terminal: `node -v` shows v20 or higher.

## 2. Get the program

```bash
git clone https://github.com/adi6499/PDFUPLOADER.git /www/jinharsh-catalogues
cd /www/jinharsh-catalogues
```
Nothing to install: the libraries are already inside `public/vendor`.

## 3. The data folder

```bash
mkdir -p /www/jinharsh-catalogues-data
chown -R www:www /www/jinharsh-catalogues /www/jinharsh-catalogues-data   # the user that will run Node
```

## 4. Settings for this server

```bash
cp deploy/config.local.example.json config.local.json
```
`config.local.json` (not in git) should say:
```json
{
  "publicUrl": "https://catalog.jinharsh.com",
  "dataDir": "/www/jinharsh-catalogues-data",
  "host": "127.0.0.1",
  "port": 8180,
  "trustProxy": true,
  "inquiryForward": "https://api.jinharsh.com/inquiries"
}
```
`publicUrl` is the address inside every QR code. Set it once. Never change it after cards are printed.
`inquiryForward` sends a copy of every visitor query ("Send a query" on the catalogue pages) to the company's Odoo
bridge, with the same fields Mitul's hub sends. Leave it out to keep queries only on this server. Either way the team
sees every query under **Visitors & queries** on the team page, with Excel (CSV) downloads.

## 5. Bring the old hub's catalogues across (once, before the first start)

```bash
npm run import-hub -- --pdfs /www/wwwroot/catalog.jinharsh.com/hub/pdfs
```
It adds the 15 catalogues from `deploy/hub-catalogs.json` with the SAME names, so every QR printed from Mitul's hub
(`catalog.jinharsh.com/?cat=<name>`) keeps opening the right catalogue: Mitul's 12 (26 Nov 2026) plus 3 older links
from the first hub (`abb-baldor-motors`, `drager-safety`, `lovejoy-qf-interchange`).
- The hub's own PDFs (master catalogue, Shell, Flexco) are taken from `hub/pdfs` and go live at once; their cover
  pictures are made the first time someone opens the team page.
- Catalogues that link to a maker's PDF (Timken, Lovejoy, Rexnord Omega, Groz) keep offering it until the team uploads ours.
- The colour-coating and borewell guides are websites, not PDFs: their pages offer "Open the interactive guide".
- PDFs uploaded through Mitul's team page sit in `hub/data/custom-catalogs.json` + `hub/pdfs`; upload those again on
  our team page (none existed on 26 Nov 2026).
Running it again is safe: names already there are skipped.

## 6. Start it (keeps running, restarts by itself after a reboot)

```bash
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup        # run the line it prints, once
```
Check: `curl http://127.0.0.1:8180/api/health` shows `{"ok":true,...}`.

## 7. Point catalog.jinharsh.com at the program

First keep a copy of the old hub, just in case:
```bash
mkdir -p /www/backup && cp -a /www/wwwroot/catalog.jinharsh.com /www/backup/catalog-hub-2026-11
```
Then aaPanel → **Website** → `catalog.jinharsh.com` → **Reverse proxy** → add one: target URL `http://127.0.0.1:8180`,
send domain `$host`. Keep its existing SSL certificate and "Force HTTPS".

Two settings matter, whichever web server the site uses (the old hub was served by **Apache**):

**Apache** (aaPanel → the site → Config), inside the `<VirtualHost *:443>` block:
```apache
ProxyPreserveHost On
ProxyPass        / http://127.0.0.1:8180/ timeout=900
ProxyPassReverse / http://127.0.0.1:8180/
RequestHeader set X-Forwarded-Proto "https"
LimitRequestBody 167772160
```
**nginx**: see `deploy/nginx-catalog.jinharsh.com.conf` (`client_max_body_size 160m`, `proxy_request_buffering off`,
`proxy_read_timeout 900s`).

Without these, PDFs bigger than the web server's default limit are refused, or big uploads time out on phones.

## 8. Who may upload

The catalogue pages (`/` and `/c/...`) are always open. The team page (`/team`) is where PDFs are uploaded, replaced and
deleted. On the real address it **stays locked until a team password is set**, so strangers can't change the PDFs.
When Jinesh decides to open it for the team:
```bash
cd /www/jinharsh-catalogues
npm run password          # type it twice; stored only as a scrambled hash in the data folder
```
No restart needed. Running it again later changes the password and signs everyone out.

## 9. Check

- `https://catalog.jinharsh.com/` shows all catalogues
- `https://catalog.jinharsh.com/?cat=timken-srb` opens the Timken catalogue (an old hub link)
- `https://catalog.jinharsh.com/team` shows the sign-in page (or the team page once signed in)
- Upload a small PDF on `/team`, scan its QR with a phone: it opens.
- `pm2 logs jinharsh-docs` shows no errors.

## 10. Backups

Everything uploaded is in `/www/jinharsh-catalogues-data` (`db.json` = the list, `docs/` = every PDF version).
aaPanel → **Cron** → **Backup directory** → `/www/jinharsh-catalogues-data`, daily, keep 14.

## 11. Updating the program later

```bash
cd /www/jinharsh-catalogues
git pull
pm2 restart jinharsh-docs
```
The data folder is never touched by an update.
