// GET  /api/world  — one-shot global snapshot as JSON (cache-friendly).
// POST /api/world  — SSE: streamed assembly (per-source progress) + final result.
//   query/body: domains (csv), bbox (w,s,e,n), time, synthesize, question, provider, fallback

import { Router } from 'express';
import { worldState } from '../lib/api.js';
import { driveWorld } from '../lib/run-world.js';
import { parseBbox } from '../lib/geo.js';
import { getLatest } from '../lib/poller.js';

export const worldRouter = Router();

// A "plain" request = whole Earth, no domain filter, no synthesis — the common
// case the poller keeps warm, so all clients share one assembly.
const isPlain = (o) => !o.bbox && !o.domains.length && !o.synthesize && !o.time;

const csv = (v) => (v || '').split(',').map(s => s.trim()).filter(Boolean);
const truthy = (v) => v === '1' || v === 'true' || v === true;

function readOpts(src) {
  return {
    domains: csv(src.domains),
    bbox: parseBbox(src.bbox),
    time: (src.time || '').trim() || null,
    synthesize: truthy(src.synthesize),
    question: (src.question || '').trim() || null,
    provider: (src.provider || '').trim() || undefined,
    fallback: csv(src.fallback),
  };
}

worldRouter.get('/', async (req, res) => {
  try {
    const opts = readOpts(req.query);
    if (isPlain(opts)) {
      const cached = getLatest();
      if (cached) return res.json({ ...cached, cached: true });
    }
    res.json(await worldState(opts));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

worldRouter.post('/', async (req, res) => {
  const opts = readOpts({ ...req.query, ...req.body });
  await driveWorld(req, res, { ...opts, meta: { bbox: opts.bbox, domains: opts.domains } });
});
