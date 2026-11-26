# Jinharsh Catalogues (catalog.jinharsh.com)

Upload a PDF (catalogue, flyer, price list) and it gets its own **QR code that never changes**.
Print that QR on visiting cards, flyers, boxes, anywhere. When a newer PDF comes out, press
**Replace PDF**: the QR stays exactly the same, and everyone who scans it sees the new file.

Made for Jinharsh Industrial Solutions Private Limited.

## How the "never changes" part works

Each document gets a short, permanent link such as `https://<your-address>/c/catalogue`.
The QR code holds only that link, never the PDF itself. So:

- **Replace PDF** adds a new version under the same link. Old versions are kept and you can switch back.
- **Rename** changes only the name people see.
- **Archive** hides the PDF; anyone who scans gets a polite "no longer available" page with your contact buttons.
- **Delete** (only after archiving) removes the files for good. The code is never given to another document,
  so an old printed card can never open the wrong PDF.

The one thing that must never change is the website address itself (`publicUrl` below).
Set it once, before printing anything.

## The pages

| Page | Address | Who |
|---|---|---|
| All catalogues, brand filters, search, a QR for each | `/` | everyone |
| QR Studio: every QR code (PNG / SVG / visiting card, or all in one ZIP) for posters and cards | `/?qr=1` | the team (Dhwani) |
| One catalogue: cover, Read now, Download, Share, QR, menu of all catalogues, videos & proof, "Send a query" | `/c/<code>` | everyone (this is what a QR opens) |
| Team: upload, QR codes for printing, replace, edit details (incl. videos & trials), archive, **Visitors & queries** | `/team` | the Jinharsh team |

Links from the old catalog.jinharsh.com hub keep working: `/?cat=<name>` opens `/c/<name>`.
`npm run import-hub` brings the hub's catalogues across with the same names (Mitul's 12 + 3 older ones).

**Sales side** (like Mitul's hub): the first download on a device asks, optionally, who is downloading; "Send a query"
saves the visitor's question (and sends a copy to Odoo when `inquiryForward` is set); every visit, read, download,
share and video is counted. The team sees it all under Visitors & queries, split before / during / after an
exhibition when its dates are set, with Excel (CSV) downloads. Data: `data/events.jsonl` and `data/inquiries.jsonl`.

## Run it on this computer

You need Node.js 20 or newer.

```
npm install        (only the first time: fetches the libraries)
npm run vendor     (only after npm install: copies them into public/vendor)
npm start          (then open http://localhost:8180)
npm test           (checks every promise above on a throw-away copy; your documents are not touched)
npm run password   (sets or changes the team password; needed on the real website)
```

## Going live

On the company aaPanel server at catalog.jinharsh.com, step by step: [deploy/SERVER-SETUP.md](deploy/SERVER-SETUP.md).
On a real address the team page stays locked until a team password is set with `npm run password`
(on this computer, with no password, it is open: nobody else can reach it).

## Trial copy on Vercel

The GitHub repository is also connected to a Vercel project (`pdf`) for trying things out. There the same
program keeps its files in a **Vercel Blob** store instead of a disk (`server/blobstore.mjs`, `api/index.js`,
`vercel.json`). To make it work: Vercel → project `pdf` → **Storage** → **Create** → **Blob** → connect it to the
project → redeploy. Free limits: 1 GB of files, 10 GB of downloads a month; when a limit is reached Vercel pauses
the storage for the month, it never charges. Trial QR codes point to the vercel.app address: **never print them**.
In the trial the team page is open to anyone with the address, and opens are not counted.
`npm run test:trial` checks the trial storage rules with a pretend store.

## On the office Wi-Fi (trying it out)

In `config.local.json` on this computer: `"host": "0.0.0.0"`, `"publicUrl": "http://<this PC's Wi-Fi address>:8180"`,
`"teamOpen": true`. Then phones on the same Wi-Fi open that address and scan its QR codes. Never print these codes:
the address changes when the PC or the Wi-Fi changes. `teamOpen` lets anyone on that Wi-Fi upload or delete.

## Settings

- `config.json`: `port`, `host`, `trustProxy` (true behind nginx), `publicUrl` (**the address printed inside every QR**; empty = this computer only,
  and the app warns you not to print), `dataDir`, `maxUploadMB`.
  Put this computer's own changes in `config.local.json` (not saved to git).
- `site.json`: company name and the contact buttons on the scan page (phones, WhatsApp, email, website, address).

## Where the files live

Everything uploaded is in the `data` folder: `data/db.json` (the list) and `data/docs/<code>/` (every version
of every PDF and its cover picture). Back up that folder. It is never put into git.

## Built with

Plain HTML, CSS and JavaScript, a small Node.js server with no extra packages, the Jinharsh UI kit
(`public/vendor/jinharsh-ui.*`, used as it is), PDF.js by Mozilla (Apache 2.0), qrcode-generator by
Kazuhiko Arase (MIT), the Geist font (OFL) and Lucide icons (ISC). All of them are copied into
`public/vendor`, so the site never depends on anyone else's server.
