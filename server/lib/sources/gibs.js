// NASA GIBS — global satellite imagery as WMTS tiles (no auth). We expose the
// daily true-color composite as a static global raster overlay. NOTE the WMTS
// tile order is {TileMatrix}/{TileRow}/{TileCol} = {z}/{y}/{x} (row before col).
//   https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{Layer}/default/{Time}/{Set}/{z}/{y}/{x}.jpg
// Imagery is daily, near-real-time ~3h latency, so we request a recent UTC date.

import { registerSource } from './source-registry.js';

const BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const LAYER = process.env.GIBS_LAYER || 'VIIRS_NOAA20_CorrectedReflectance_TrueColor';
const DAY_OFFSET = Number(process.env.GIBS_DAY_OFFSET || 1); // days back to dodge NRT lag

function recentDate() {
  const d = new Date(Date.now() - DAY_OFFSET * 86400_000);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

registerSource({
  id: 'gibs',
  title: 'NASA GIBS',
  domains: ['satellite'],
  coverage: { global: true },
  auth: { required: false, credKey: null },
  attribution: 'NASA EOSDIS GIBS',
  capabilities: { tileLayer: true },
  rate: { perMin: 120 },
  ttl: { tiles: 1800 },

  isConfigured() { return true; },

  getTiles() {
    const date = recentDate();
    return {
      urlTemplate: `${BASE}/${LAYER}/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
      tileSize: 256, minzoom: 0, maxzoom: 9,
      date, attribution: this.attribution,
    };
  },

  async probe(ctx) {
    const t = this.getTiles();
    const url = t.urlTemplate.replace('{z}', '3').replace('{y}', '2').replace('{x}', '4');
    await ctx.fetch(url, { ttl: 60, as: 'buffer' });
    return { detail: `true-color ${t.date}` };
  },
});
