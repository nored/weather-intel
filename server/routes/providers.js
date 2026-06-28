// GET  /api/providers          — list LLM providers + which are configured + masked creds
// POST /api/providers          — save credentials (api keys, base urls, model ids)
// GET  /api/providers/probe/:name — test connection

import { Router } from 'express';
import { listProviders, saveCredentials, maskedCredentials, getProvider, loadCredentials } from '../lib/llm-providers/provider-registry.js';

export const providersRouter = Router();

providersRouter.get('/', (req, res) => {
  res.json({ providers: listProviders(), credentials: maskedCredentials() });
});

providersRouter.get('/probe/:name', async (req, res) => {
  const p = getProvider(req.params.name);
  if (!p) return res.status(404).json({ ok: false, error: 'unknown provider' });
  const creds = loadCredentials();
  if (!p.isConfigured(creds)) return res.json({ ok: false, error: 'not configured yet' });
  if (typeof p.probe !== 'function') return res.json({ ok: true, detail: 'configured' });
  try {
    const r = await p.probe(creds);
    res.json({ ok: true, ...(r || {}) });
  } catch (e) {
    res.json({ ok: false, error: String(e.message || e).slice(0, 200) });
  }
});

providersRouter.post('/', (req, res) => {
  const updates = req.body || {};
  // Only allow known credential keys to be written (LLM + source API keys).
  const allowed = [
    'anthropic_api_key', 'anthropic_model',
    'openai_base_url', 'openai_api_key', 'openai_model',
    'claude_cli_enabled', 'claude_cli_path', 'claude_cli_model',
    // source keys (added as keyed adapters arrive in later phases)
    'firms_map_key', 'openweather_api_key', 'openaq_api_key', 'waqi_token', 'meteostat_key', 'checkwx_key',
  ];
  const filtered = {};
  for (const k of allowed) if (k in updates) filtered[k] = updates[k];
  saveCredentials(filtered);
  res.json({ ok: true, providers: listProviders(), credentials: maskedCredentials() });
});
