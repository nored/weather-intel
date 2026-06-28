// Iowa Environmental Mesonet (IEM) — CONUS NEXRAD base-reflectivity mosaic as
// keyless XYZ tiles. Higher-resolution US radar to complement the global
// RainViewer mosaic. ~5-min updates; we serve the current composite.
//   https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q/{z}/{x}/{y}.png

import { registerSource } from './source-registry.js';

const TILES = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q/{z}/{x}/{y}.png';

registerSource({
  id: 'iem-nexrad',
  title: 'IEM NEXRAD',
  domains: ['radar'],
  coverage: { bbox: [-127, 20, -65, 50] }, // CONUS
  auth: { required: false, credKey: null },
  attribution: 'Iowa Environmental Mesonet / NWS',
  capabilities: { tileLayer: true },
  rate: { perMin: 120 },
  ttl: { tiles: 120 },

  isConfigured() { return true; },
  getTiles() { return { urlTemplate: TILES, tileSize: 256, minzoom: 0, maxzoom: 9, attribution: this.attribution }; },

  async probe(ctx) {
    await ctx.fetch(TILES.replace('{z}', '4').replace('{x}', '3').replace('{y}', '6'), { ttl: 60, as: 'buffer' });
    return { detail: 'IEM n0q tiles ok' };
  },
});
