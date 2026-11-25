# Jinharsh Docs

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

## Two screens

| Screen | Address | Who |
|---|---|---|
| Documents (upload, QR codes, replace, archive) | `/` | the Jinharsh team |
| Scan page (cover, Read now, Download, Share, contact buttons) | `/c/<code>` | customers who scan |

## Run it on this computer

You need Node.js 20 or newer.

```
npm install        (only the first time: fetches the libraries)
npm run vendor     (only after npm install: copies them into public/vendor)
npm start          (then open http://localhost:8180)
npm test           (checks every promise above on a throw-away copy; your documents are not touched)
```

## Settings

- `config.json`: `port`, `publicUrl` (**the address printed inside every QR**; empty = this computer only,
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
