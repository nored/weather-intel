// WAQI / AQICN — global air-quality (US EPA AQI) tile overlay. Requires a FREE
// token (aqicn.org/data-platform/token/), stored as `waqi_token` (⚙ panel). The
// token is injected server-side in the tile proxy, so it is never exposed to the
// browser. NOTE licensing: attribution required; for-profit public use needs a
// written agreement with WAQI.
//   https://tiles.aqicn.org/tiles/usepa-aqi/{z}/{x}/{y}.png?token=TOKEN

import { registerSource } from './source-registry.js';

const BASE = 'https://tiles.aqicn.org/tiles/usepa-aqi/{z}/{x}/{y}.png';

registerSource({
  id: 'waqi',
  title: 'WAQI',
  domains: ['airquality'],
  coverage: { global: true },
  auth: { required: true, credKey: 'waqi_token' },
  attribution: 'World Air Quality Index (WAQI)',
  capabilities: { tileLayer: true },
  rate: { perMin: 120 },
  ttl: { tiles: 600 },

  isConfigured(creds) { return !!creds?.waqi_token; },
  getTiles(domain, creds = {}) {
    return { urlTemplate: `${BASE}?token=${creds.waqi_token || ''}`, tileSize: 256, minzoom: 0, maxzoom: 12, attribution: this.attribution };
  },

  async probe(ctx) {
    const u = this.getTiles('airquality', ctx.creds).urlTemplate.replace('{z}', '4').replace('{x}', '8').replace('{y}', '5');
    await ctx.fetch(u, { ttl: 60, as: 'buffer' });
    return { detail: 'WAQI tiles ok' };
  },
});
