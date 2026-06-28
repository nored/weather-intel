// GET /api/sources              — catalog of registered adapters + configured/enabled flags
// GET /api/sources/probe/:id    — "test connection" for one adapter

import { Router } from 'express';
import { listSources, getSource } from '../lib/sources/source-registry.js';
import { makeCtx } from '../lib/source-ctx.js';
import { loadCredentials } from '../lib/llm-providers/provider-registry.js';

export const sourcesRouter = Router();

sourcesRouter.get('/', (req, res) => {
  res.json({ sources: listSources() });
});

sourcesRouter.get('/probe/:id', async (req, res) => {
  const a = getSource(req.params.id);
  if (!a) return res.status(404).json({ ok: false, error: 'unknown source' });
  if (typeof a.probe !== 'function') return res.json({ ok: true, detail: 'no probe' });
  try {
    const r = await a.probe(makeCtx(loadCredentials()));
    res.json({ ok: true, ...(r || {}) });
  } catch (e) {
    res.json({ ok: false, error: String(e.message || e).slice(0, 200) });
  }
});
