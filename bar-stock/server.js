// Serves the web app and the /api endpoints that read photos with Claude.
import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { aiAvailable, readPhoto } from './lib/vision.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
const MAX_BODY = 20 * 1024 * 1024;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
// When set, photo reading needs this code, so a public link can't run up the API bill.
const ACCESS_CODE = process.env.ACCESS_CODE || '';

function codeMatches(given) {
  const hash = (s) => createHash('sha256').update(String(s)).digest();
  return timingSafeEqual(hash(given || ''), hash(ACCESS_CODE));
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Photos too large'), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function handleApi(req, res, path) {
  if (path === '/api/status' && req.method === 'GET') return send(res, 200, { ai: aiAvailable(), needsCode: Boolean(ACCESS_CODE) });

  const task = path.match(/^\/api\/read\/(invoice|sales|bottle)$/)?.[1];
  if (!task || req.method !== 'POST') return send(res, 404, { error: 'Not found' });
  if (!aiAvailable()) return send(res, 503, { error: 'Photo reading is not set up on this server (no ANTHROPIC_API_KEY).' });
  if (ACCESS_CODE && !codeMatches(req.headers['x-access-code'])) return send(res, 401, { error: 'Wrong access code' });

  const body = await readJson(req);
  const images = (body.images || []).filter((i) => IMAGE_TYPES.has(i.mediaType) && typeof i.data === 'string');
  if (!images.length) return send(res, 400, { error: 'No photo supplied' });
  return send(res, 200, await readPhoto(task, images.slice(0, 5), body.context || {}));
}

async function serveStatic(res, path) {
  const file = normalize(join(PUBLIC_DIR, path === '/' ? 'index.html' : decodeURIComponent(path)));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden', 'text/plain');
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  }
}

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  try {
    if (path.startsWith('/api/')) await handleApi(req, res, path);
    else await serveStatic(res, path);
  } catch (err) {
    let status = err.status || 500;
    let message = err.message;
    if (err instanceof Anthropic.RateLimitError) message = 'Photo reading is busy, try again in a minute.';
    else if (err instanceof Anthropic.AuthenticationError) { status = 503; message = 'The server\'s Anthropic API key is invalid.'; }
    else if (err instanceof Anthropic.APIConnectionError) { status = 502; message = 'Could not reach the photo reading service.'; }
    else if (err instanceof SyntaxError) { status = 400; message = 'Bad request'; }
    if (status >= 500) console.error(err);
    send(res, status, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`Bar stock app on http://localhost:${PORT} (photo reading ${aiAvailable() ? 'on' : 'off: set ANTHROPIC_API_KEY'})`);
});
