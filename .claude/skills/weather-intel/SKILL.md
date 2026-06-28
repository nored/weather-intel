---
name: weather-intel
description: >-
  Answer any weather-dependent question, or get a planet-scale snapshot of Earth's
  weather/geophysical state. Use `ask "<question>"` for questions whose answer
  needs weather — directly ("forecast for Tokyo this weekend", "when will it rain
  in London") or indirectly ("will the vineyards near Bordeaux get frost?", "good
  day to fly a drone in Denver?"); it geocodes the location from the question, pulls
  the forecast, and answers specifically. Or get the whole-Earth snapshot (every
  active earthquake, tropical cyclone, severe-weather alert via US NWS + European
  Meteoalarm + GDACS disasters, the global rain-radar timeline, space weather) as
  one JSON object. Uses `claude -p` (no API key). Use whenever a task needs live
  weather — for a place or for the planet.
allowed-tools: Bash, Read
---

# weather-intel (headless global snapshot)

Drives a locally-installed open-weather aggregator via its CLI. Returns a global
situational snapshot as JSON on stdout; progress goes to stderr. The default scope
is the **whole planet** — `--bbox` only clips.

## Where it lives

Set `PROJECT` to wherever you cloned the repo:

```
PROJECT="$HOME/weather-intel"     # adjust to your clone path
```

Run from anywhere — config/credentials resolve from the project root.

## Answer a weather-dependent question (the main agent step)

For ANY question whose answer depends on weather — directly or indirectly — use
`ask`. It works out the location from the question, geocodes it, pulls that
location's forecast, and answers specifically (concrete times, temps, mm, probabilities):

```bash
node "$PROJECT/server/cli.js" ask "when will it rain in London?" --quiet
node "$PROJECT/server/cli.js" ask "what's the forecast for Tokyo this weekend?" --quiet
node "$PROJECT/server/cli.js" ask "will the vineyards near Bordeaux get frost this week?" --quiet
node "$PROJECT/server/cli.js" ask "is it a good day to fly a drone in Denver tomorrow?" --json --quiet
```

`--json` returns `{ answer, locations:[{name,country,lat,lon,timezone}], scope, provider_used }`.
Regions/states resolve to a representative city (California → Los Angeles). If no place is
implied, it answers from the global snapshot instead. No API key needed (uses your local claude CLI).

## Run it (raw global data)

```bash
# Whole planet, machine-readable:
node "$PROJECT/server/cli.js" world --json --quiet

# Clip to a bounding box (west,south,east,north):
node "$PROJECT/server/cli.js" world --bbox -31,34,45,72 --json --quiet   # Europe

# One domain:
node "$PROJECT/server/cli.js" quakes --json --quiet
node "$PROJECT/server/cli.js" storms --json --quiet
node "$PROJECT/server/cli.js" alerts --bbox -125,24,-66,50 --json --quiet # US

# Cited intel summary (uses your local claude CLI, no key):
node "$PROJECT/server/cli.js" world --synthesize -Q "Any significant severe weather over the US right now?" --bbox -125,24,-66,50 --quiet
```

| Option | Purpose |
| --- | --- |
| `world\|storms\|quakes\|alerts\|fires\|radar` | scope to all domains (default) or one |
| `-d, --domains <list>` | `radar,quakes,storms,alerts,fires,airquality,...` |
| `--bbox <w,s,e,n>` | clip to a bounding box (default: whole Earth) |
| `--time <window>` | quakes window: `hour\|day\|week\|month` |
| `-s, --synthesize` | add a cited LLM intel summary at `.intel.answer` |
| `-Q, --question <text>` | question for the synthesis step |
| `-p, --provider <name>` | `claude-cli` (default, no key), `claude`, `openai` |
| `--json` | emit the full JSON snapshot (recommended for agents) |
| `-q, --quiet` | suppress stderr progress |

## The JSON shape

```jsonc
{
  "generatedAt": "ISO", "bbox": null | [w,s,e,n],
  "tiles":    { "radar": { "frames": [{time,urlTemplate}], "latest": "ISO", "source": "rainviewer" } },
  "features": { "earthquakes": {FeatureCollection}, "storms": {…}, "alerts": {…} },
  "spaceWeather": { "kpIndex": 1.33, "source": "noaa-swpc" },
  "intel":   { "answer": "…cited markdown…", "provider_used": "claude-cli" },  // only with --synthesize
  "sources": [ { "id": "usgs", "status": "ok|stale|error", "count": 217 } ],
  "stats":   { "adaptersQueried": 6, "ok": 6, "features": 5230 }
}
```
Every feature carries `properties.source` / `fetchedAt` / `validTime`. One dead
source never blanks the snapshot — check `sources[].status`.

## How to use the result
- For a decision, prefer `--synthesize` and read `.intel.answer` (cited, ranked).
- For data, read `.features.<domain>` (GeoJSON) and `.tiles.radar` (animation frames).
- Domains with no covering source for the requested bbox are simply absent.

## Prerequisites
- Node 22+ and `npm install` done in `$PROJECT`.
- For `--synthesize` with the default provider: the `claude` CLI installed + logged in.
- All Phase-1 sources are **keyless**. Keyed sources (FIRMS, OpenWeather, etc.)
  arrive in later phases and are configured in `data/credentials.json`.
- A snapshot takes a few seconds (parallel fetches). Synthesis adds ~10–60s.
