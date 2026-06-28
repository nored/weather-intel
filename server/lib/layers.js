// Shared layer registry — the single source of truth for what the map can draw.
// Backend builds it from the registered adapters (tile/feature capabilities) and
// serves it at GET /api/layers; the browser builds its toggle panel + MapLibre
// sources from the exact same list. Add a tile-capable adapter → it appears on
// the map automatically.

import { allSources } from './sources/source-registry.js';
import { loadCredentials } from './llm-providers/provider-registry.js';

// Map a domain to a default z-order and color hint for the UI (low = bottom).
const DOMAIN_META = {
  satellite:   { order: 10, kind: 'raster',  color: '#9aa' },
  radar:       { order: 20, kind: 'raster',  color: '#2bd' },
  airquality:  { order: 25, kind: 'raster',  color: '#9b5' },
  temperature: { order: 12, kind: 'raster',  color: '#e85' },
  wind:        { order: 13, kind: 'raster',  color: '#5ce' },
  clouds:      { order: 14, kind: 'raster',  color: '#bbb' },
  lightning:   { order: 30, kind: 'raster',  color: '#fd0' },
  alerts:      { order: 40, kind: 'feature', color: '#e33' },
  disaster:    { order: 45, kind: 'feature', color: '#f2a' },
  tropical:    { order: 50, kind: 'feature', color: '#a3e' },
  wildfire:    { order: 60, kind: 'feature', color: '#f60' },
  earthquake:  { order: 70, kind: 'feature', color: '#fb0' },
};

export function buildLayers(creds = loadCredentials()) {
  const layers = [];
  for (const a of allSources()) {
    const configured = a.isConfigured ? a.isConfigured(creds) : true;
    for (const domain of a.domains) {
      const meta = DOMAIN_META[domain] || { order: 80, kind: 'feature', color: '#88a' };
      const animated = !!a.capabilities?.frames;
      const tiled = !!(a.capabilities?.tileLayer || a.capabilities?.frames);
      const featured = !!a.capabilities?.globalFeatures;
      if (!tiled && !featured) continue;
      const scheme = a.tileScheme || 'xyz';
      // XYZ tiles go through our caching proxy (also hides any token); WMS tiles
      // (keyless, bbox-based) are handed to the map as a direct template.
      let tilesUrl = null;
      if (tiled) {
        if (scheme === 'wms') { try { tilesUrl = a.getTiles(domain).urlTemplate; } catch { tilesUrl = null; } }
        else tilesUrl = `/api/tiles/${a.id}:${domain}/{z}/{x}/{y}`;
      }
      layers.push({
        id: `${a.id}:${domain}`,
        source: a.id,
        domain,
        title: `${a.title || a.id} — ${domain}`,
        kind: meta.kind,
        color: meta.color,
        order: meta.order,
        scheme,
        animated,                              // has a frame timeline
        tile: tiled,                           // raster tile overlay
        feature: featured,                     // GeoJSON event overlay
        framesUrl: animated ? `/api/tiles/${a.id}:${domain}/times` : null,
        tilesUrl,
        featuresUrl: featured ? `/api/features/${domain}?source=${a.id}` : null,
        attribution: a.attribution || null,
        configured,
        // Default-on: one radar (rainviewer) + the key events. Other tile
        // sources start off so the map isn't an opaque stack on load.
        defaultOn: ['earthquake', 'tropical', 'alerts', 'disaster'].includes(domain) || a.id === 'rainviewer',
        opacity: meta.kind === 'raster' ? 0.7 : 1,
      });
    }
  }
  return layers.sort((x, y) => x.order - y.order);
}
