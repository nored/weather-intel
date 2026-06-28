# Source adapter contract

Every file in this directory describes one open weather/geophysical data source and
ends by calling `registerSource(adapter)`. Adding a new source = adding one file
here and a side-effect import in `server/index.js` and `server/lib/api.js`. The
adapter then surfaces automatically in the CLI, the HTTP API, the map, and the skill.

```js
import { registerSource } from './source-registry.js';

registerSource({
  id: 'rainviewer',                 // unique slug
  title: 'RainViewer',              // human label
  domains: ['radar'],               // radar|satellite|alerts|tropical|wildfire|
                                    //   earthquake|lightning|airquality|spaceweather|
                                    //   model|marine|hydrology|aviation|climate
  coverage: { global: true },       // or { bbox: [w, s, e, n] } for regional sources
  auth: { required: false, credKey: null },   // credKey -> credentials.json field name
  attribution: 'RainViewer',        // shown in the UI / required by license
  capabilities: {                   // drives fan-out selection (see source-registry)
    globalFeatures: false,          // returns a GeoJSON FeatureCollection of events
    frames: true,                   // returns animated tile timestamps
    tileLayer: true,                // returns a static/global tile template
  },
  rate: { perMin: 60 },             // token-bucket limit (ratelimit.js)
  ttl: { features: 120, frames: 60, tiles: 60 },   // seconds per op (cache.js)

  isConfigured(creds) { return true; },          // keyless adapters: always true

  // PRIMARY method. domain is one of this adapter's domains. bbox is optional
  // (whole planet if null) and is a CLIP filter, never a requirement.
  // ctx = { creds, fetch (caching), signal, ua }.
  // Return a GeoJSON FeatureCollection; merge.js stamps provenance on each feature.
  async getGlobal(domain, { bbox, time } = {}, ctx) {
    return { type: 'FeatureCollection', features: [] };
  },

  // Animated tile layers: list of { time (ISO), label?, urlTemplate } newest-last.
  async getFrames(layer, ctx) { return { frames: [], latest: null }; },

  // Static/global tile layer descriptor for the map layer registry.
  getTiles(layer) {
    return { urlTemplate: '...{z}/{x}/{y}.png', tileSize: 256, minzoom: 0, maxzoom: 7, attribution: '...' };
  },

  // "Test connection" for the ⚙ panel. Resolve with { detail } or throw.
  async probe(ctx) { return { detail: 'ok' }; },
});
```

## Conventions
- **Global-first.** `getGlobal` returns *everything* in the domain on Earth; `bbox`
  only clips. Do not require a location.
- **Never throw to blank the planet.** Network/HTTP errors propagate to `merge.js`,
  which isolates them per-source (`sources[].status = 'error' | 'stale'`); the rest
  of the snapshot still renders. Prefer `ctx.fetch` (caching + stale-on-error).
- **Stamp nothing yourself.** Return raw normalized features; `merge.js` adds
  `properties.source` / `fetchedAt` / `validTime`.
- **Respect licenses.** Put required attribution in `attribution`; note non-commercial
  / key-gated sources in a comment. See the verified source catalog in the plan dir.
