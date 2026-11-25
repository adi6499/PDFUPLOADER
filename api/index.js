// The trial copy on Vercel: Vercel runs this file for /api/*, /c/*, /f/* and /cover/* (see vercel.json).
// The pages themselves (public/) are served by Vercel directly. Files go into the project's Vercel Blob store.
import { createApp } from '../server/app.mjs';

let app = null;
export default async function handler(req, res) {
  try {
    app ||= createApp();
    const { handle } = await app;
    return handle(req, res);
  } catch (e) {
    app = null;
    console.error(e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'The trial copy could not start: ' + (e && e.message) }));
  }
}
