// GET /api/layers — the shared map layer registry (built from registered adapters).

import { Router } from 'express';
import { buildLayers } from '../lib/layers.js';

export const layersRouter = Router();

layersRouter.get('/', (req, res) => {
  res.json({ layers: buildLayers() });
});
