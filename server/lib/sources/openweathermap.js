// OpenWeatherMap — global model-field tile overlays (temperature, wind, clouds).
// Requires a FREE API key (`openweather_api_key`, set via ⚙). The key is injected
// server-side in the tile proxy, so it never reaches the browser. Free tier:
// 60 calls/min. Attribution: OpenWeather.
//   https://tile.openweathermap.org/map/{layer}/{z}/{x}/{y}.png?appid=KEY

import { registerSource } from './source-registry.js';

// domain -> OWM 1.0 tile layer id
const LAYER_FOR = { temperature: 'temp_new', wind: 'wind_new', clouds: 'clouds_new' };

registerSource({
  id: 'openweathermap',
  title: 'OpenWeatherMap',
  domains: ['temperature', 'wind', 'clouds'],
  coverage: { global: true },
  auth: { required: true, credKey: 'openweather_api_key' },
  attribution: 'OpenWeather',
  capabilities: { tileLayer: true },
  rate: { perMin: 60 },
  ttl: { tiles: 600 },

  isConfigured(creds) { return !!creds?.openweather_api_key; },
  getTiles(domain, creds = {}) {
    const layer = LAYER_FOR[domain] || LAYER_FOR.temperature;
    return { urlTemplate: `https://tile.openweathermap.org/map/${layer}/{z}/{x}/{y}.png?appid=${creds.openweather_api_key || ''}`, tileSize: 256, minzoom: 0, maxzoom: 9, attribution: this.attribution };
  },

  async probe(ctx) {
    const u = this.getTiles('temperature', ctx.creds).urlTemplate.replace('{z}', '3').replace('{x}', '4').replace('{y}', '2');
    await ctx.fetch(u, { ttl: 60, as: 'buffer' });
    return { detail: 'OWM temp tiles ok' };
  },
});
