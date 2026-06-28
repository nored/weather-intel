// NOAA NHC — all active tropical cyclones (Atlantic, E/Central Pacific), no key,
// public domain. https://www.nhc.noaa.gov/CurrentStorms.json
// Each active storm becomes a point feature with intensity/pressure/movement.

import { registerSource } from './source-registry.js';

const URL = 'https://www.nhc.noaa.gov/CurrentStorms.json';

// "20.5N" / "94.3W" -> signed decimal
function coord(str, dir) {
  if (typeof str === 'number') return str;
  const m = String(str || '').match(/([\d.]+)\s*([NSEW])/i);
  if (!m) return null;
  let v = parseFloat(m[1]);
  const d = m[2].toUpperCase();
  if (d === 'S' || d === 'W') v = -v;
  return v;
}

registerSource({
  id: 'nhc',
  title: 'NOAA NHC',
  domains: ['tropical'],
  coverage: { global: true },
  auth: { required: false, credKey: null },
  attribution: 'NOAA NHC',
  capabilities: { globalFeatures: true },
  rate: { perMin: 30 },
  ttl: { features: 300 },

  isConfigured() { return true; },

  async getGlobal(domain, opts, ctx) {
    const data = await ctx.fetch(URL, { ttl: this.ttl.features });
    const storms = data.activeStorms || [];
    const features = storms.map(s => {
      const lat = s.latitudeNumeric ?? coord(s.latitude);
      const lon = s.longitudeNumeric ?? coord(s.longitude);
      return {
        type: 'Feature',
        geometry: lat != null && lon != null ? { type: 'Point', coordinates: [lon, lat] } : null,
        properties: {
          id: s.id,
          name: s.name,
          classification: s.classification,        // TD/TS/HU/...
          intensityKt: s.intensity != null ? Number(s.intensity) : null,
          pressureMb: s.pressure != null ? Number(s.pressure) : null,
          movementDir: s.movementDir ?? null,
          movementSpeedKt: s.movementSpeed ?? null,
          basin: s.binNumber || null,
          validTime: s.lastUpdate || null,
          publicAdvisory: s.publicAdvisory?.url || null,
          track: s.track?.url || null,
          cone: s.forecastCone?.url || null,
        },
      };
    });
    return { type: 'FeatureCollection', features };
  },

  async probe(ctx) {
    const data = await ctx.fetch(URL, { ttl: 60 });
    return { detail: `${(data.activeStorms || []).length} active storms` };
  },
});
