// NASA FIRMS — global active-fire hotspots (MODIS + VIIRS) as point features.
// Requires a FREE MAP_KEY (firms.modaps.eosdis.nasa.gov/api/map_key/), stored as
// `firms_map_key` in data/credentials.json (set via the ⚙ panel). Until a key is
// present this adapter is simply disabled (isConfigured=false) and never queried.
//   area CSV: /api/area/csv/{KEY}/{SOURCE}/{AREA}/{DAYS}
//   AREA = "world" or "west,south,east,north"; DAYS 1..10

import { registerSource } from './source-registry.js';

const BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';
const SOURCE = process.env.FIRMS_SOURCE || 'VIIRS_NOAA20_NRT';

// Minimal CSV parse (FIRMS output has no embedded commas/quotes).
function parseCsv(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const head = lines[0].split(',');
  return lines.slice(1).map(line => {
    const cells = line.split(',');
    const row = {};
    head.forEach((h, i) => { row[h] = cells[i]; });
    return row;
  });
}

registerSource({
  id: 'firms',
  title: 'NASA FIRMS',
  domains: ['wildfire'],
  coverage: { global: true },
  auth: { required: true, credKey: 'firms_map_key' },
  attribution: 'NASA FIRMS',
  capabilities: { globalFeatures: true },
  rate: { perMin: 20 }, // 5000 transactions / 10 min per key
  ttl: { features: 600 },

  isConfigured(creds) { return !!creds?.firms_map_key; },

  async getGlobal(domain, { bbox } = {}, ctx) {
    const key = ctx.creds?.firms_map_key;
    if (!key) throw new Error('firms_map_key not set');
    const area = bbox ? bbox.join(',') : 'world';
    const url = `${BASE}/${key}/${SOURCE}/${area}/1`;
    const csv = await ctx.fetch(url, { ttl: this.ttl.features, as: 'text' });
    const features = parseCsv(csv).map(r => {
      const lat = Number(r.latitude), lon = Number(r.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: {
          frp: r.frp != null ? Number(r.frp) : null,           // fire radiative power
          brightness: r.bright_ti4 != null ? Number(r.bright_ti4) : null,
          confidence: r.confidence,
          daynight: r.daynight,
          satellite: r.satellite,
          validTime: r.acq_date && r.acq_time ? `${r.acq_date}T${String(r.acq_time).padStart(4, '0').replace(/(\d{2})(\d{2})/, '$1:$2')}:00Z` : r.acq_date || null,
        },
      };
    }).filter(Boolean);
    return { type: 'FeatureCollection', features };
  },

  async probe(ctx) {
    const fc = await this.getGlobal('wildfire', { bbox: [-125, 24, -66, 50] }, ctx);
    return { detail: `${fc.features.length} US hotspots (last day)` };
  },
});
