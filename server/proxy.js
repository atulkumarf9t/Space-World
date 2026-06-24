// proxy.js
// Tiny zero-dependency server: serves the static app AND proxies optional Gemini
// calls so the API key never reaches the browser. Gemini is advisory only; the
// game is fully playable with no key (mock world + local reasoning).
//
// Run:  node server/proxy.js   ->  http://localhost:5173

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';
import https from 'node:https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = normalize(join(__dirname, '..'));

// Load .env into process.env (zero-deps; no secrets in source control)
const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  const lines = (await readFile(envPath, 'utf8')).split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}
const PORT = process.env.PORT || 5173;
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const REACTOR_KEY = process.env.REACTOR_API_KEY || '';
const REACTOR_INSECURE_TLS = process.env.REACTOR_INSECURE_TLS === '1';

function reactorFetch(url, options = {}) {
  if (!REACTOR_INSECURE_TLS) return fetch(url, options);
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      u,
      { method: options.method || 'GET', headers: options.headers, rejectUnauthorized: false },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString();
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            json: () => Promise.resolve(JSON.parse(body)),
            text: () => Promise.resolve(body),
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function handleGemini(req, res) {
  if (!GEMINI_KEY) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ text: '', note: 'no GEMINI_API_KEY; running offline' }));
    return;
  }
  try {
    const body = JSON.parse((await readBody(req)) || '{}');
    const parts = [{ text: body.prompt || 'Describe this scene briefly.' }];
    if (body.image && body.image.startsWith('data:')) {
      const [meta, b64] = body.image.split(',');
      const mimeType = meta.slice(5, meta.indexOf(';')) || 'image/jpeg';
      parts.push({ inline_data: { mime_type: mimeType, data: b64 } });
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] }),
    });
    const data = await upstream.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join(' ').trim() || '';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ text }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err.message || err) }));
  }
}

// LLM-in-the-loop: turn a conjunction observation into a maneuver action.
// Returns { action: { type:'burn'|'coast', dv, axis } } or a coast fallback.
async function handleAgent(req, res) {
  const coast = (note) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ action: { type: 'coast' }, note }));
  };
  if (!GEMINI_KEY) return coast('no GEMINI_API_KEY; deterministic autopilot recommended');
  try {
    const body = JSON.parse((await readBody(req)) || '{}');
    const o = body.observation || {};
    const prompt = `You pilot a low-thrust ion probe resolving an orbital conjunction.
Decide ONE action to keep all threats outside the safe ring at least delta-v.
State (JSON): ${JSON.stringify(o)}
Reply with ONLY compact JSON: {"type":"burn","dv":<m/s up to budgetRemaining>} to maneuver
in the recommended avoidance direction, or {"type":"coast"} if no threat needs action.`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
      }),
    });
    const data = await upstream.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('').trim() || '{}';
    let parsed = {};
    try { parsed = JSON.parse(text); } catch { parsed = { type: 'coast' }; }
    const action = parsed.type === 'burn'
      ? { type: 'burn', dv: Math.max(0, Math.min(o.budgetRemaining ?? 0, +parsed.dv || 0)) }
      : { type: 'coast' };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ action }));
  } catch (err) {
    return coast('agent error: ' + (err.message || err));
  }
}

async function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = normalize(join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) throw new Error('dir');
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

async function handleReactorToken(_req, res) {
  if (!REACTOR_KEY) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'no REACTOR_API_KEY configured' }));
    return;
  }
  try {
    const result = await reactorFetch('https://api.reactor.inc/tokens', {
      method: 'POST',
      headers: { 'Reactor-API-Key': REACTOR_KEY },
    });
    if (!result.ok) throw new Error(`Reactor /tokens HTTP ${result.status}`);
    const { jwt, expires_at } = await result.json();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jwt, expires_at }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err.message || err) }));
  }
}

async function handleConfig(_req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    gemini: Boolean(GEMINI_KEY),
    reactor: Boolean(REACTOR_KEY),
  }));
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/gemini') return handleGemini(req, res);
  if (req.method === 'POST' && req.url === '/api/agent') return handleAgent(req, res);
  if (req.method === 'POST' && req.url === '/api/reactor-token') return handleReactorToken(req, res);
  if (req.method === 'GET' && req.url === '/api/config') return handleConfig(req, res);
  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`DRIFT 3D serving at http://localhost:${PORT}`);
  console.log(GEMINI_KEY ? 'Gemini proxy: ENABLED' : 'Gemini proxy: disabled (offline mode)');
  console.log(REACTOR_KEY ? 'Reactor token mint: ENABLED' : 'Reactor: no REACTOR_API_KEY (mock backdrop)');
  if (REACTOR_INSECURE_TLS) console.warn('Reactor TLS verification disabled (REACTOR_INSECURE_TLS=1)');
});
