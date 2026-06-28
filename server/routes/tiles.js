// Tile endpoints for the map.
//   GET /api/tiles/:layer/times          — frame timestamps for an animated layer
//   GET /api/tiles/:layer/:z/:x/:y(.png) — proxy+cache a single tile (?time= picks a frame)
// :layer is "<sourceId>:<domain>" (e.g. "rainviewer:radar").

import { Router } from 'express';
import { getSource } from '../lib/sources/source-registry.js';
import { makeCtx } from '../lib/source-ctx.js';
import { loadCredentials } from '../lib/llm-providers/provider-registry.js';
import { cachedFetch } from '../lib/cache.js';
import { config } from '../config.js';

export const tilesRouter = Router();

// Pace upstream tile fetches so a zoomed-in animation (one set of tiles per
// frame × ~13 frames = hundreds of tiles) doesn't burst the upstream and get
// rate-limited (429). Cache hits pass through these slots in sub-ms; only cold
// fetches actually occupy one, which is exactly what we want to throttle.
const MAX_UPSTREAM = 6;
let active = 0;
const waiters = [];
async function withSlot(fn) {
  if (active >= MAX_UPSTREAM) await new Promise(r => waiters.push(r));
  active++;
  try { return await fn(); }
  finally { active--; const next = waiters.shift(); if (next) next(); }
}

function parseLayer(layer) {
  const i = layer.indexOf(':');
  return i < 0 ? { id: layer, domain: null } : { id: layer.slice(0, i), domain: layer.slice(i + 1) };
}

// Cache resolved frame lists briefly so /times and the tile proxy agree.
async function framesFor(a, domain) {
  const creds = loadCredentials();
  const ctx = makeCtx(creds);
  if (typeof a.getFrames === 'function') return a.getFrames(domain, ctx);
  if (typeof a.getTiles === 'function') {
    const t = a.getTiles(domain, creds); // creds let keyed sources (e.g. WAQI) inject a token server-side
    return { frames: [{ time: null, urlTemplate: t.urlTemplate }], latest: null, ...t };
  }
  throw new Error('layer has no tiles');
}

tilesRouter.get('/:layer/times', async (req, res) => {
  const { id, domain } = parseLayer(req.params.layer);
  const a = getSource(id);
  if (!a) return res.status(404).json({ error: 'unknown layer' });
  try {
    res.json(await framesFor(a, domain));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

tilesRouter.get('/:layer/:z/:x/:y', async (req, res) => {
  const { id, domain } = parseLayer(req.params.layer);
  const a = getSource(id);
  if (!a) return res.status(404).send('unknown layer');
  const { z, x } = req.params;
  const y = req.params.y.replace(/\.png$/, '');
  try {
    const { frames } = await framesFor(a, domain);
    if (!frames?.length) return res.status(404).send('no frames');
    const time = (req.query.time || '').trim();
    const frame = (time && frames.find(f => f.time === time)) || frames[frames.length - 1];
    const url = frame.urlTemplate
      .replace('{z}', z).replace('{x}', x).replace('{y}', y)
      .replace('{s}', 'a');
    const { body, stale } = await withSlot(() =>
      cachedFetch(url, { ttl: config.tilesCacheTtl, as: 'buffer', retries: 4, retryBaseMs: 600 }));
    res.set('Content-Type', body.contentType || 'image/png');
    res.set('Cache-Control', `public, max-age=${config.tilesCacheTtl}`);
    if (stale) res.set('X-Cache', 'stale');
    res.send(body.buffer);
  } catch (e) {
    res.status(502).send(String(e.message || e).slice(0, 200));
  }
});
