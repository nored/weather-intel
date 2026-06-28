// Two-tier (in-memory LRU + disk) TTL cache, plus a caching `fetch` wrapper that
// every source adapter uses via ctx.fetch. This is mandatory infrastructure:
// the global feeds are rate-limited and many browser clients watch the same
// planet, so one upstream fetch is shared across everyone until it expires.
//
// On an upstream failure we serve the last good (even expired) value flagged
// `stale` — stale-while-revalidate-on-error — so a single dead feed never blanks
// the map.

import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const CACHE_DIR = isAbsolute(config.cacheDir) ? config.cacheDir : join(ROOT, config.cacheDir);

const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const now = () => Date.now();

// --- in-memory LRU -------------------------------------------------------
const MEM_MAX = 500;
const mem = new Map(); // key -> { expiresAt, value (parsed), meta }

function memGet(key) {
  const e = mem.get(key);
  if (!e) return null;
  mem.delete(key); mem.set(key, e); // bump recency
  return e;
}
function memSet(key, entry) {
  mem.set(key, entry);
  if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value);
}

// --- disk tier -----------------------------------------------------------
function diskPath(ns, key) {
  return join(CACHE_DIR, ns, `${key}.json`);
}
function diskGet(ns, key) {
  const p = diskPath(ns, key);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
}
function diskSet(ns, key, entry) {
  const p = diskPath(ns, key);
  try { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(entry)); } catch {}
}

// Generic cached producer: cached(ns, key, ttlSeconds, async producer()).
// Returns { value, fromCache, stale }. On producer failure, falls back to the
// last stored value (any age) flagged stale; if none exists, rethrows.
export async function cached(ns, keyParts, ttl, producer) {
  const key = sha1(Array.isArray(keyParts) ? keyParts.join('|') : String(keyParts));
  const fresh = (e) => e && e.expiresAt > now();

  const m = memGet(key);
  if (fresh(m)) return { value: m.value, fromCache: true, stale: false };
  const d = diskGet(ns, key);
  if (fresh(d)) { memSet(key, d); return { value: d.value, fromCache: true, stale: false }; }

  try {
    const value = await producer();
    const entry = { expiresAt: now() + (ttl ?? config.cacheTtlDefault) * 1000, value, storedAt: now() };
    memSet(key, entry); diskSet(ns, key, entry);
    return { value, fromCache: false, stale: false };
  } catch (err) {
    const stale = m || d;
    if (stale) return { value: stale.value, fromCache: true, stale: true, error: err.message };
    throw err;
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Caching fetch. opts: { ttl (s), headers, method, body, as:'json'|'text'|'buffer',
//   signal, retries, retryBaseMs }.
// Buffers are stored base64 on disk (tiles are small PNGs). Returns the parsed
// body directly (the cached() wrapper handles freshness/stale). `retries` retries
// transient upstream failures (429/5xx/network) with exponential backoff + jitter
// WITHIN the request — so rate-limited tiles come back as a (slightly slower) 200
// instead of a 502 the browser won't re-request, and the success then gets cached.
export async function cachedFetch(url, opts = {}) {
  const { ttl, headers = {}, method = 'GET', body, as = 'json', signal, retries = 0, retryBaseMs = 500 } = opts;
  const ns = 'http';
  const res = await cached(ns, [method, url, body || '', as], ttl, async () => {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), config.sourceTimeoutMs);
      const onAbort = () => ctl.abort();
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      try {
        const r = await fetch(url, {
          method, body,
          headers: { 'User-Agent': config.userAgent, ...headers },
          signal: ctl.signal,
        });
        const transient = r.status === 429 || (r.status >= 500 && r.status < 600);
        if (transient && attempt < retries) {
          const ra = Number(r.headers.get('retry-after'));
          const wait = Number.isFinite(ra) ? ra * 1000 : retryBaseMs * 2 ** attempt + Math.random() * 250;
          lastErr = new Error(`HTTP ${r.status} for ${url}`);
          await sleep(wait);
          continue;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
        if (as === 'json') return { kind: 'json', data: await r.json() };
        if (as === 'text') return { kind: 'text', data: await r.text() };
        const buf = Buffer.from(await r.arrayBuffer());
        return { kind: 'buffer', data: buf.toString('base64'), contentType: r.headers.get('content-type') || 'application/octet-stream' };
      } catch (e) {
        lastErr = e;
        if (attempt < retries) { await sleep(retryBaseMs * 2 ** attempt + Math.random() * 250); continue; }
        throw e;
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
      }
    }
    throw lastErr;
  });
  const v = res.value;
  const out = v.kind === 'buffer'
    ? { buffer: Buffer.from(v.data, 'base64'), contentType: v.contentType }
    : v.data;
  // attach provenance flags without mutating arrays awkwardly
  return { body: out, fromCache: res.fromCache, stale: !!res.stale };
}

// Best-effort sweep of expired disk entries (called occasionally; never throws).
export function sweepCache() {
  try {
    for (const ns of readdirSync(CACHE_DIR)) {
      const dir = join(CACHE_DIR, ns);
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        try {
          const e = JSON.parse(readFileSync(p, 'utf-8'));
          // keep stale-fallback candidates for a day past expiry, then drop
          if (e.expiresAt && e.expiresAt + 86400_000 < now()) unlinkSync(p);
          else if (statSync(p).mtimeMs + 7 * 86400_000 < now()) unlinkSync(p);
        } catch { try { unlinkSync(p); } catch {} }
      }
    }
  } catch {}
}
