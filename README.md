# weather-intel

**See all the weather of planet Earth at once — and ask any weather question in plain language.**

weather-intel is a planet-scale situational-awareness layer over **free, open public
weather and geophysical data**. It stitches together global rain radar, satellite
imagery, every active tropical cyclone, severe-weather alerts, earthquakes, disasters,
wildfires and space weather into **one interactive world map** and **one structured data
API** — and it can **answer any weather-dependent question** (for a place or for the planet)
using a pluggable LLM.

It’s built to be three things at once:

- a **map** you can just watch (animated rain radar, satellite, live events);
- a **data source** an AI agent or script can call (clean JSON, no key required for the core);
- an **answer engine** — ask *“when will it rain in London?”*, *“forecast for Tokyo this
  weekend?”*, or *“will the vineyards near Bordeaux get frost this week?”* and get a specific,
  forecast-grounded answer.

```bash
git clone <your-fork-url> weather-intel && cd weather-intel
npm install
npm start                         # → http://localhost:8090

# ask anything — answered from a weather angle (geocode → forecast → answer):
node server/cli.js ask "when will it rain in London?"
node server/cli.js ask "what's the forecast for Tokyo this weekend?"
node server/cli.js ask "will the vineyards near Bordeaux get frost this week?"

# raw global data (no key needed):
node server/cli.js world --json --quiet            # whole Earth snapshot
node server/cli.js world --bbox -31,34,45,72       # clip to a bbox (Europe)
node server/cli.js quakes --time hour              # one domain
node server/cli.js sources                          # list sources + status
```

The `ask` command (and the **Ask** panel in the web UI) need an LLM. By default it uses your
local **Claude Code CLI** (`claude -p`, no API key); you can also configure an Anthropic or
OpenAI-compatible key. Everything else — the map, the raw data, the snapshot — works with **no
keys at all**.

## Four interfaces, one core

| Interface | What it’s for |
| --- | --- |
| **Web map** (`/`) | MapLibre world view: animated radar, satellite, event overlays, live feeds, click-anywhere weather, the Ask panel |
| **CLI** (`server/cli.js`) | `ask` to answer questions; `world --json` for pipelines; `--watch` NDJSON stream |
| **HTTP API** | `GET /api/answer?q=`, `/api/world`, `/api/point`, `/api/features/:domain`, `/api/tiles/*`, SSE `POST /api/world` |
| **Agent skill** | A bundled skill so an AI agent can answer weather-dependent questions or pull live data |

## The `ask` pipeline

Any question whose answer depends on weather — directly or indirectly — is resolved like this:

1. **Locate** — an LLM extracts the place(s) the question implies (states/regions resolve to a
   representative city, e.g. California → Los Angeles).
2. **Geocode** — Open-Meteo geocoding → lat/lon/timezone.
3. **Forecast** — current conditions + 72 h hourly + 7-day daily for that point.
4. **Answer** — the LLM answers from a weather angle: concrete local times, temperatures,
   rainfall, probabilities. If no place is implied, it falls back to the global snapshot.

`GET /api/answer?q=...` and `weather-intel ask "..."` both return this; with `--json` you get
`{ answer, locations:[{name,country,lat,lon,timezone}], scope, provider_used }`.

## How the map works

A **source registry** of pluggable adapters (`server/lib/sources/`) — each declaring its
domains, coverage, capabilities, rate limit and cache TTLs. A request fans out across the
relevant adapters concurrently, **isolating failures** (one dead feed never blanks the planet),
stamps provenance (`source`/`fetchedAt`/`validTime`) on every datum, and merges everything into
one global snapshot. A background poller keeps that snapshot warm; a two-tier (memory + disk)
cache with per-source rate-limiting and stale-while-revalidate sits in front of every upstream
call. Tile layers are per-source toggles (stack multiple radars, satellite, air quality); event
layers are merged by domain. Adding a source is one file in `server/lib/sources/` plus a
side-effect import — it then appears in the CLI, API, map and skill automatically.

## Data sources

All core sources are **keyless**. Keyed sources are gated (shown as “needs key”) until a key is
set in the ⚙ panel; any token is injected server-side and never reaches the browser.

| Source | Domain(s) | Coverage | Auth |
| --- | --- | --- | --- |
| RainViewer | rain radar (animated) | global | none |
| NASA GIBS | satellite (true-color) | global | none |
| IEM NEXRAD | radar | United States | none |
| DWD | radar + lightning (WMS) | Germany | none |
| Open-Meteo | forecast / point weather | global | none |
| USGS | earthquakes | global | none |
| NOAA NHC | tropical cyclones | global (Atlantic/E-Pacific) | none |
| US NWS | severe-weather alerts | United States | none |
| Meteoalarm | severe-weather alerts | Europe | none |
| GDACS | disasters (flood/quake/cyclone/volcano…) | global | none |
| NOAA SWPC | space weather | global | none |
| NASA FIRMS | wildfire hotspots | global | free key |
| WAQI | air quality (tiles) | global | free token |
| OpenWeatherMap | temperature / wind / clouds (tiles) | global | free key |

Several sources require **attribution** (e.g. Open-Meteo, DWD, RainViewer, NASA GIBS, WAQI) — see
`attribution` in `GET /api/sources` and each adapter file. Respect each provider’s terms; some
keyed sources restrict commercial use. This project bundles no data — it links to live feeds.

## Configuration

Env-driven (`server/config.js`): `PORT` (8090), `LLM_PROVIDER` (`claude-cli`), `SOURCES`
allow-list, `CACHE_TTL`, `TILES_CACHE_TTL`, `FANOUT_CONCURRENCY`, `SOURCE_TIMEOUT`,
`POLL_INTERVAL`, `WI_USER_AGENT`. API keys (for keyed sources / LLM providers) live in
`data/credentials.json` (mode 0600), settable via the ⚙ panel or env vars.

## Requirements

- Node 22+
- For `ask` / the Ask panel: an LLM provider — the [Claude Code CLI](https://claude.com/claude-code)
  (`claude -p`, no API key) by default, or an Anthropic / OpenAI-compatible key.

## License

MIT — see [LICENSE](LICENSE). Provided as-is; not for safety-of-life decisions. Always
cross-check official sources for severe weather.
