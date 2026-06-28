// Open-Meteo — keyless global forecast/observation point source. Unlike the
// other adapters (which return whole-Earth feeds), this answers "what's the
// weather right HERE?" for any lat/lon — current conditions + a short forecast.
// Powers click-anywhere weather on the map and point enrichment for agents.
// CC-BY 4.0 (attribute Open-Meteo + the underlying model). No key, global.
//   https://api.open-meteo.com/v1/forecast

import { registerSource } from './source-registry.js';

// WMO weather interpretation codes → short text.
const WMO = {
  0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
  77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers', 82: 'Violent rain showers',
  85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm w/ hail', 99: 'Thunderstorm w/ hail',
};
export const wmoText = (c) => WMO[c] ?? `code ${c}`;

registerSource({
  id: 'open-meteo',
  title: 'Open-Meteo',
  domains: ['forecast'],
  coverage: { global: true },
  auth: { required: false, credKey: null },
  attribution: 'Open-Meteo (CC-BY 4.0)',
  capabilities: { pointQuery: true }, // point-only: not a map layer, not in the global snapshot
  rate: { perMin: 120 },
  ttl: { point: 600 },

  isConfigured() { return true; },

  // Current conditions + hourly (next ~48h) + daily (7-day) for a location.
  // hours/days control how much is returned (the click popup wants little; the
  // question-answering pipeline wants the full horizon).
  async queryPoint(lat, lon, ctx, { hours = 48 } = {}) {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,showers,snowfall,weather_code,cloud_cover,surface_pressure,wind_speed_10m,wind_direction_10m` +
      `&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset` +
      `&forecast_days=7&timezone=auto`;
    const d = await ctx.fetch(u, { ttl: this.ttl.point });
    const c = d.current || {};
    const H = d.hourly || {}, D = d.daily || {};
    return {
      lat, lon, timezone: d.timezone,
      current: {
        time: c.time,
        weather: wmoText(c.weather_code),
        temperatureC: c.temperature_2m,
        feelsLikeC: c.apparent_temperature,
        humidity: c.relative_humidity_2m,
        precipitationMm: c.precipitation,
        rainMm: c.rain,
        snowfallCm: c.snowfall,
        cloudCoverPct: c.cloud_cover,
        pressureHpa: c.surface_pressure,
        windKmh: c.wind_speed_10m,
        windDir: c.wind_direction_10m,
      },
      hourly: (H.time || []).slice(0, hours).map((t, i) => ({
        time: t, temperatureC: H.temperature_2m?.[i], weather: wmoText(H.weather_code?.[i]),
        precipMm: H.precipitation?.[i], precipProb: H.precipitation_probability?.[i], windKmh: H.wind_speed_10m?.[i],
      })),
      daily: (D.time || []).map((t, i) => ({
        date: t, weather: wmoText(D.weather_code?.[i]),
        tMaxC: D.temperature_2m_max?.[i], tMinC: D.temperature_2m_min?.[i],
        precipMm: D.precipitation_sum?.[i], precipProbMaxPct: D.precipitation_probability_max?.[i],
        windMaxKmh: D.wind_speed_10m_max?.[i], sunrise: D.sunrise?.[i], sunset: D.sunset?.[i],
      })),
      source: 'open-meteo',
    };
  },

  async probe(ctx) {
    const r = await this.queryPoint(52.52, 13.405, ctx);
    return { detail: `Berlin: ${r.current.temperatureC}°C, ${r.current.weather}` };
  },
});
