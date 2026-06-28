// US NWS — all active severe-weather alerts as GeoJSON (no key; a descriptive
// User-Agent is required and set globally in config). Public domain.
//   https://api.weather.gov/alerts/active

import { registerSource } from './source-registry.js';

const URL = 'https://api.weather.gov/alerts/active';

registerSource({
  id: 'nws',
  title: 'US NWS',
  domains: ['alerts'],
  coverage: { bbox: [-179.9, 15, -64, 72] }, // CONUS + AK + PR/territories (approx)
  auth: { required: false, credKey: null },
  attribution: 'NOAA / NWS',
  capabilities: { globalFeatures: true },
  rate: { perMin: 30 },
  ttl: { features: 120 },

  isConfigured() { return true; },

  async getGlobal(domain, opts, ctx) {
    const fc = await ctx.fetch(URL, { ttl: this.ttl.features, headers: { Accept: 'application/geo+json' } });
    const features = (fc.features || []).map(f => ({
      type: 'Feature',
      geometry: f.geometry, // may be null (zone-based) — kept as-is
      properties: {
        id: f.id,
        event: f.properties.event,
        severity: f.properties.severity,
        certainty: f.properties.certainty,
        urgency: f.properties.urgency,
        headline: f.properties.headline,
        areaDesc: f.properties.areaDesc,
        onset: f.properties.onset,
        expires: f.properties.expires,
        validTime: f.properties.effective || f.properties.sent || null,
        sender: f.properties.senderName,
      },
    }));
    return { type: 'FeatureCollection', features };
  },

  async probe(ctx) {
    const fc = await ctx.fetch(URL, { ttl: 60, headers: { Accept: 'application/geo+json' } });
    return { detail: `${(fc.features || []).length} active US alerts` };
  },
});
