# Jinharsh Docs: putting it on the company server

For whoever looks after the aaPanel server (159.89.94.209). About 20 minutes, once.

**What this is:** a small website. The team uploads PDFs (catalogues, flyers); each PDF gets a QR code that is
printed on visiting cards. Customers scan it and see the PDF. The QR codes hold the web address, so
**the address chosen here must never change** once cards are printed.

**Important differences from the other jinharsh sites:**
- It is **not** a static site, so it does **not** go in `mitulv4u/jinharsh-subsites`. It is a small Node.js
  program (no extra packages, no database) from `github.com/adi6499/PDFUPLOADER`.
- Uploaded PDFs live in a **data folder outside the website folder**, so no update or sync can delete them.

## 0. Choose the address

Suggested: **`docs.jinharsh.com`**. Confirm with Jinesh before going further; it is printed on every card.
Add a DNS **A record** `docs` → `159.89.94.209`.

## 1. Node.js

aaPanel → **App Store** → install **Node.js version manager** (or "PM2 Manager") → install **Node 20 or newer**.
Check in the terminal: `node -v` shows v20 or higher.

## 2. Get the program

```bash
cd /www/wwwroot
git clone https://github.com/adi6499/PDFUPLOADER.git docs.jinharsh.com
cd docs.jinharsh.com
```
Nothing to install: the libraries are already inside `public/vendor`.
(If the GitHub repository is private, ask Adesh to add you, or use a deploy key.)

## 3. The data folder (outside the website)

```bash
mkdir -p /www/jinharsh-docs-data
chown -R www:www /www/jinharsh-docs-data      # the same user that will run Node
```

## 4. Settings for this server

```bash
cp deploy/config.local.example.json config.local.json
```
`config.local.json` (not in git) should say:
```json
{
  "publicUrl": "https://docs.jinharsh.com",
  "dataDir": "/www/jinharsh-docs-data",
  "host": "127.0.0.1",
  "port": 8180,
  "trustProxy": true
}
```
`publicUrl` is the address inside every QR code. Set it once. Never change it after cards are printed.

## 5. Start it (keeps running, restarts by itself after a reboot)

**Either** aaPanel → **Website → Node project → Add Node project**:
project folder `/www/wwwroot/docs.jinharsh.com`, run command `node server/server.mjs`, port `8180`,
user `www`, domain `docs.jinharsh.com`. aaPanel then makes the nginx link for you.

**Or** with PM2 in the terminal:
```bash
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup        # run the line it prints, once
```
and create the website in aaPanel with `deploy/nginx-docs.jinharsh.com.conf` as its config.

## 6. Two nginx settings that matter (aaPanel → the site → Config)

```nginx
client_max_body_size 160m;     # PDFs up to 150 MB; nginx's default would refuse anything over 1 MB
proxy_request_buffering off;   # the progress bar in the app shows the real upload
proxy_read_timeout 900s;       # big PDFs on slow phone connections
proxy_send_timeout 900s;
```
Also `proxy_set_header Host $host;` and `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`
(the sample file has all of these).

## 7. HTTPS

aaPanel → the site → **SSL** → **Let's Encrypt** → apply → switch on **Force HTTPS**.

## 8. Who may upload

The customer page (`/c/...`) is always open. The team page (`/`) is where PDFs are uploaded, replaced and deleted.
On a real address that page **stays locked until a team password is set**, so strangers can't change the PDFs.
When Jinesh decides to open it for the team:
```bash
cd /www/wwwroot/docs.jinharsh.com
npm run password          # type it twice; stored only as a scrambled hash in the data folder
```
No restart needed. Running it again later changes the password and signs everyone out.

## 9. Check

- `https://docs.jinharsh.com/api/health` shows `{"ok":true,...}`
- `https://docs.jinharsh.com/` shows the team page (or the sign-in page)
- Upload a small PDF, scan its QR with a phone, it opens.
- `pm2 logs jinharsh-docs` (or the aaPanel Node project log) shows no errors.

## 10. Backups

Everything uploaded is in `/www/jinharsh-docs-data` (`db.json` = the list, `docs/` = every PDF version).
aaPanel → **Cron** → **Backup directory** → `/www/jinharsh-docs-data`, daily, keep 14.

## 11. Updating the program later

```bash
cd /www/wwwroot/docs.jinharsh.com
git pull
pm2 restart jinharsh-docs      # or restart the Node project in aaPanel
```
The data folder is never touched by an update.
