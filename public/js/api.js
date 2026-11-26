// Talking to the server. Every screen goes through these few functions.
// Two ways of sending a PDF, chosen by the server (see /api/info "storage"):
//   'disk' - the company server: the PDF goes to our own server, which saves it on its disk
//   'blob' - the Vercel trial copy: the PDF goes straight into Vercel's file storage (Vercel's
//            program part cannot take files over 4.5 MB), then the server checks it and lists it
let MODE = 'disk';
export const setMode = (m) => { MODE = m === 'blob' ? 'blob' : 'disk'; };

const NOT_CONNECTED = 'This page is not connected to the Jinharsh Docs program.';

async function call(method, url, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let r;
  try { r = await fetch(url, opt); } catch { throw new Error('Cannot reach the server. Check the internet connection.'); }
  const j = await r.json().catch(() => null);
  if (j === null) throw new Error(NOT_CONNECTED);
  if (r.status === 401) { location.reload(); throw new Error('Please sign in again.'); }
  if (!r.ok) throw new Error(j.error || 'Something went wrong (' + r.status + ').');
  return j;
}

export const info = () => call('GET', '/api/info');
export const listDocs = () => call('GET', '/api/docs');
export const checkCode = (code) => call('GET', '/api/check-code?code=' + encodeURIComponent(code));
export const suggestCode = () => call('GET', '/api/check-code?suggest=1').then((j) => j.code);
export const updateDoc = (code, patch) => call('PATCH', '/api/docs/' + encodeURIComponent(code), patch);
export const deleteDoc = (code) => call('DELETE', '/api/docs/' + encodeURIComponent(code));

// company server: sends the PDF itself, reporting progress (0..1) as it goes
function upload(url, file, onProgress) {
  return new Promise((ok, no) => {
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.setRequestHeader('Content-Type', 'application/pdf');
    x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total, e.loaded, e.total); };
    x.onload = () => {
      let j = {}; try { j = JSON.parse(x.responseText); } catch {}
      if (x.status === 401) { location.reload(); no(new Error('Please sign in again.')); return; }
      if (x.status >= 200 && x.status < 300) ok(j);
      else if (!j.error && (x.status === 404 || x.status === 405)) no(new Error('This page is not connected to the Jinharsh Docs program, so the file could not be saved. Open http://localhost:8180 (or catalog.jinharsh.com once it is online) and try again.'));
      else no(new Error(j.error || 'Upload failed (' + x.status + ').'));
    };
    x.onerror = () => no(new Error('The upload stopped. Check the internet connection and try again.'));
    x.send(file);
  });
}

// trial copy: the PDF goes straight into Vercel's storage, under the name the server expects
async function toBlobStore(pathname, file, onProgress) {
  const { upload: put } = await import('/vendor/blob-client.mjs');
  try {
    return await put(pathname, file, {
      access: 'public', handleUploadUrl: '/api/blob-upload', contentType: 'application/pdf',
      multipart: file.size > 8 * 1048576,
      onUploadProgress: (e) => { if (onProgress && e.total) onProgress(e.loaded / e.total, e.loaded, e.total); },
    });
  } catch (e) {
    // the server's own reason (for example "That name is already used") is inside the message
    const m = String((e && e.message) || '').replace(/^Vercel Blob:\s*/i, '').replace(/^Failed to\s+retrieve the client token\s*/i, '');
    throw new Error(m || 'The upload stopped. Check the internet connection and try again.');
  }
}

export async function createDoc(file, { title, code, pages, brand = '', category = '' }, onProgress) {
  if (MODE === 'blob') {
    const b = await toBlobStore(`docs/${code}/v1.pdf`, file, onProgress);
    return call('POST', '/api/docs?code=' + encodeURIComponent(code), { title, brand, category, name: file.name, pages, pathname: b.pathname });
  }
  const q = new URLSearchParams({ title: title || '', name: file.name, pages: pages || '', brand, category });
  if (code) q.set('code', code);
  return upload('/api/docs?' + q, file, onProgress);
}

export async function addVersion(code, file, { pages, nextV }, onProgress) {
  if (MODE === 'blob') {
    const b = await toBlobStore(`docs/${code}/v${nextV}.pdf`, file, onProgress);
    return call('POST', '/api/docs/' + encodeURIComponent(code) + '/versions', { name: file.name, pages, pathname: b.pathname });
  }
  const q = new URLSearchParams({ name: file.name, pages: pages || '' });
  return upload('/api/docs/' + encodeURIComponent(code) + '/versions?' + q, file, onProgress);
}

// the small copy of the cover (best effort: lists simply use the full cover if this fails)
export async function putThumb(code, v, blob, w, h) {
  const r = await fetch(`/api/docs/${encodeURIComponent(code)}/versions/${v}/thumb?w=${w || ''}&h=${h || ''}`, {
    method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Thumbnail upload failed');
  return j;
}

export async function putCover(code, v, blob, w, h) {
  const r = await fetch(`/api/docs/${encodeURIComponent(code)}/versions/${v}/cover?w=${w || ''}&h=${h || ''}`, {
    method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { location.reload(); throw new Error('Please sign in again.'); }
  if (!r.ok) throw new Error(j.error || 'Cover upload failed');
  return j;
}
