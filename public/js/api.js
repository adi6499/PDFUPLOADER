// Talking to the server. Every screen goes through these few functions,
// so moving the site to another host later only means changing this file.

async function call(method, url, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let r;
  try { r = await fetch(url, opt); } catch { throw new Error('Cannot reach the server. Check the internet connection.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong (' + r.status + ').');
  return j;
}

export const info = () => call('GET', '/api/info');
export const listDocs = () => call('GET', '/api/docs');
export const checkCode = (code) => call('GET', '/api/check-code?code=' + encodeURIComponent(code));
export const suggestCode = () => call('GET', '/api/check-code?suggest=1').then((j) => j.code);
export const updateDoc = (code, patch) => call('PATCH', '/api/docs/' + encodeURIComponent(code), patch);
export const deleteDoc = (code) => call('DELETE', '/api/docs/' + encodeURIComponent(code));

// Sends the PDF itself, reporting progress (0..1) as it goes.
function upload(url, file, onProgress) {
  return new Promise((ok, no) => {
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.setRequestHeader('Content-Type', 'application/pdf');
    x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total, e.loaded, e.total); };
    x.onload = () => {
      let j = {}; try { j = JSON.parse(x.responseText); } catch {}
      if (x.status >= 200 && x.status < 300) ok(j); else no(new Error(j.error || 'Upload failed (' + x.status + ').'));
    };
    x.onerror = () => no(new Error('The upload stopped. Check the internet connection and try again.'));
    x.send(file);
  });
}

export function createDoc(file, { title, code, pages }, onProgress) {
  const q = new URLSearchParams({ title: title || '', name: file.name, pages: pages || '' });
  if (code) q.set('code', code);
  return upload('/api/docs?' + q, file, onProgress);
}

export function addVersion(code, file, { pages }, onProgress) {
  const q = new URLSearchParams({ name: file.name, pages: pages || '' });
  return upload('/api/docs/' + encodeURIComponent(code) + '/versions?' + q, file, onProgress);
}

export async function putCover(code, v, blob, w, h) {
  const r = await fetch(`/api/docs/${encodeURIComponent(code)}/versions/${v}/cover?w=${w || ''}&h=${h || ''}`, {
    method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Cover upload failed');
  return j;
}
