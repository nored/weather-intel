// GET /api/point?lat=&lon= — "normal weather" at any location: current
// conditions + short forecast (Open-Meteo). Powers click-anywhere on the map and
// point enrichment for agents ("is it raining in Caracas? cloudy in Kampala?").

import { Router } from 'express';
import { getSource } from '../lib/sources/source-registry.js';
import { makeCtx } from '../lib/source-ctx.js';
import { loadCredentials } from '../lib/llm-providers/provider-registry.js';

export const pointRouter = Router();

pointRouter.get('/', async (req, res) => {
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ error: 'lat and lon required' });
  const a = getSource('open-meteo');
  if (!a) return res.status(503).json({ error: 'open-meteo not registered' });
  try {
    const data = await a.queryPoint(lat, lon, makeCtx(loadCredentials()));
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
