// GET /api/features/:domain?bbox=&source=&time=
// Returns one domain's global GeoJSON FeatureCollection (optionally clipped to a
// bbox and/or filtered to a single source). Used by the map's feature overlays
// and by agents wanting just events of one kind.

import { Router } from 'express';
import { worldState } from '../lib/api.js';
import { parseBbox } from '../lib/geo.js';

export const featuresRouter = Router();

featuresRouter.get('/:domain', async (req, res) => {
  try {
    const snap = await worldState({
      domains: [req.params.domain],
      bbox: parseBbox(req.query.bbox),
      time: (req.query.time || '').trim() || null,
    });
    // With a single-domain filter there is exactly one feature collection.
    let coll = Object.values(snap.features)[0] || { type: 'FeatureCollection', features: [], sources: [] };
    const source = (req.query.source || '').trim();
    if (source) coll = { ...coll, features: coll.features.filter(f => f.properties?.source === source) };
    res.json({ ...coll, generatedAt: snap.generatedAt, bbox: snap.bbox, sourceStatus: snap.sources });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
