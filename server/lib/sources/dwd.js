// DWD (Deutscher Wetterdienst) — German high-resolution radar + lightning density
// via the open GeoServer WMS (no auth, GeoNutzV: free incl. commercial, attribution
// "Source: Deutscher Wetterdienst"). Served as WMS raster (bbox-based) directly to
// the map — MapLibre fills the {bbox-epsg-3857} token, so these are NOT proxied.
//   https://maps.dwd.de/geoserver/dwd/wms?...layers=dwd:Niederschlagsradar
//   lightning density: layers=dwd:Blitzdichte

import { registerSource } from './source-registry.js';

const WMS = 'https://maps.dwd.de/geoserver/dwd/wms';
const wmsTemplate = (layer) =>
  `${WMS}?service=WMS&version=1.3.0&request=GetMap&layers=${encodeURIComponent(layer)}` +
  `&styles=&format=image/png&transparent=true&crs=EPSG:3857&width=256&height=256&bbox={bbox-epsg-3857}`;

const LAYER_FOR = { radar: 'dwd:Niederschlagsradar', lightning: 'dwd:Blitzdichte' };

registerSource({
  id: 'dwd',
  title: 'DWD',
  domains: ['radar', 'lightning'],
  coverage: { bbox: [5.8, 47, 15.1, 55.1] }, // Germany
  auth: { required: false, credKey: null },
  attribution: 'Deutscher Wetterdienst (DWD)',
  capabilities: { tileLayer: true },
  tileScheme: 'wms', // direct WMS raster, not the XYZ proxy
  rate: { perMin: 120 },
  ttl: { tiles: 120 },

  isConfigured() { return true; },
  getTiles(domain) {
    return { urlTemplate: wmsTemplate(LAYER_FOR[domain] || LAYER_FOR.radar), scheme: 'wms', tileSize: 256, attribution: this.attribution };
  },

  async probe(ctx) {
    const u = this.getTiles('radar').urlTemplate.replace('{bbox-epsg-3857}', '668000,5930000,1670000,7360000');
    await ctx.fetch(u, { ttl: 60, as: 'buffer' });
    return { detail: 'DWD WMS radar ok' };
  },
});
