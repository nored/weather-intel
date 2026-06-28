// USGS Earthquakes — every quake on Earth, as GeoJSON (no key, public domain).
//   https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/{level}_{window}.geojson
// We default to all quakes in the last day; `time` can pick a window.

import { registerSource } from './source-registry.js';

const BASE = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary';
const WINDOWS = { hour: 'hour', day: 'day', week: 'week', month: 'month' };

registerSource({
  id: 'usgs',
  title: 'USGS Earthquakes',
  domains: ['earthquake'],
  coverage: { global: true },
  auth: { required: false, credKey: null },
  attribution: 'USGS',
  capabilities: { globalFeatures: true },
  rate: { perMin: 60 },
  ttl: { features: 60 },

  isConfigured() { return true; },

  async getGlobal(domain, { time } = {}, ctx) {
    const window = WINDOWS[time] || 'day';
    const url = `${BASE}/all_${window}.geojson`;
    const fc = await ctx.fetch(url, { ttl: this.ttl.features });
    // Normalize: keep geometry, lift the useful props (and a validTime).
    const features = (fc.features || []).map(f => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        id: f.id,
        mag: f.properties.mag,
        place: f.properties.place,
        time: f.properties.time ? new Date(f.properties.time).toISOString() : null,
        depthKm: f.geometry?.coordinates?.[2] ?? null,
        tsunami: f.properties.tsunami,
        url: f.properties.url,
        title: f.properties.title,
      },
    }));
    return { type: 'FeatureCollection', features };
  },

  async probe(ctx) {
    const fc = await ctx.fetch(`${BASE}/significant_day.geojson`, { ttl: 60 });
    return { detail: `${(fc.features || []).length} significant quakes today` };
  },
});
