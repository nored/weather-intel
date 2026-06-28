#!/usr/bin/env node
// weather-intel — headless, global-first CLI. The default is the WHOLE PLANET;
// --bbox only clips. Prints the result to stdout (JSON with --json, else a human
// summary); progress goes to stderr. Designed to be a step in a larger AI
// pipeline (and the backing command for the bundled skill).
//
//   weather-intel world [--domains radar,quakes,storms,alerts] [--bbox w,s,e,n] --json
//   weather-intel storms                # all active tropical cyclones on Earth
//   weather-intel quakes --time hour
//   weather-intel world --synthesize -Q "anything notable in Europe?" --bbox -31,34,45,72
//   weather-intel world --watch         # stream new events/frames as NDJSON
//   weather-intel sources               # list adapters + status

import { worldState } from './lib/api.js';
import { answerQuestion } from './lib/answer.js';
import { listSources } from './lib/sources/source-registry.js';

const HELP = `weather-intel — planet-scale open weather/geophysical snapshot

Usage:
  weather-intel ask "<question>"      answer ANY question from a weather angle
  weather-intel [world] [options]     all of Earth's weather at once (default)
  weather-intel storms|quakes|alerts|fires|radar [options]   one domain
  weather-intel sources               list registered sources + status

  ask resolves the location from the question, pulls its forecast, and answers:
    weather-intel ask "when will it rain in London?"
    weather-intel ask "what's the forecast for Tokyo this weekend?"
    weather-intel ask "will the vineyards near Bordeaux get frost this week?"

Options:
  -d, --domains <list>   radar,satellite,quakes,storms,alerts,fires,airquality,...
      --bbox <w,s,e,n>   clip to a bounding box (default: whole planet)
      --time <window>    quakes/radar window hint (e.g. hour|day|week)
  -s, --synthesize       add an LLM "state of the planet" intel summary
  -Q, --question <text>  question for the synthesis step
  -p, --provider <name>  claude-cli (default) | claude | openai
      --fallback <a,b>   fallback providers
      --watch [secs]     keep streaming new events/frames as NDJSON (default 60s)
      --json             emit JSON instead of a human summary
  -q, --quiet            suppress stderr progress
  -h, --help

No API key needed: all Phase-1 sources are keyless; synthesis uses your local
claude CLI by default. Run from anywhere — config resolves from the project root.`;

const SUBCOMMANDS = new Set(['world', 'storms', 'quakes', 'alerts', 'fires', 'radar', 'sources', 'ask']);
const SUB_DOMAIN = { storms: 'tropical', quakes: 'earthquake', alerts: 'alerts', fires: 'wildfire', radar: 'radar' };

function parseArgs(argv) {
  const a = { cmd: 'world', domains: [], bbox: null, time: null, synthesize: false, question: null,
    provider: undefined, fallback: [], watch: null, json: false, quiet: false, help: false, _: [] };
  let i = 0;
  if (argv[0] && !argv[0].startsWith('-') && SUBCOMMANDS.has(argv[0])) a.cmd = argv[i++];
  for (; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--domains' || t === '-d') a.domains = (argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
    else if (t === '--bbox') a.bbox = argv[++i];
    else if (t === '--time') a.time = argv[++i];
    else if (t === '--synthesize' || t === '-s') a.synthesize = true;
    else if (t === '--question' || t === '-Q') a.question = argv[++i];
    else if (t === '--provider' || t === '-p') a.provider = argv[++i];
    else if (t === '--fallback') a.fallback = (argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
    else if (t === '--watch') { const n = parseInt(argv[i + 1], 10); a.watch = Number.isFinite(n) ? (i++, n) : 60; }
    else if (t === '--json') a.json = true;
    else if (t === '--quiet' || t === '-q') a.quiet = true;
    else if (t === '--help' || t === '-h') a.help = true;
    else a._.push(t); // positional (e.g. the ask question)
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
const err = (s) => { if (!args.quiet) process.stderr.write(s); };
const out = (s) => process.stdout.write(s);
// Write (possibly large) output to a pipe and exit only once it has flushed —
// process.exit() otherwise truncates buffered stdout. Critical for agents that
// pipe our --json output.
const finish = (s) => process.stdout.write(s, () => process.exit(0));

if (args.help) { out(HELP + '\n'); process.exit(0); }

const bbox = args.bbox ? args.bbox.split(',').map(Number) : null;
const domains = args.cmd in SUB_DOMAIN ? [SUB_DOMAIN[args.cmd]] : args.domains;

const progress = args.quiet ? null : (ev) => {
  if (ev.phase === 'fetch' && ev.status !== 'start')
    err(`  · ${ev.source}/${ev.domain}: ${ev.status}${ev.ms ? ` (${ev.ms}ms)` : ''}\n`);
  else if (ev.phase === 'synthesize') err(`synthesize: ${ev.status}\n`);
};

function humanSummary(snap) {
  const lines = [];
  lines.push(`# Planet snapshot — ${snap.generatedAt}${snap.bbox ? ` (bbox ${snap.bbox.join(',')})` : ' (whole Earth)'}`);
  const f = snap.features || {};
  if (f.earthquakes) {
    const top = [...f.earthquakes.features].sort((a, b) => (b.properties.mag ?? -9) - (a.properties.mag ?? -9)).slice(0, 5);
    lines.push(`\n## Earthquakes: ${f.earthquakes.features.length}`);
    for (const q of top) lines.push(`  M${q.properties.mag} ${q.properties.place || ''} (${q.properties.time || ''})`);
  }
  if (f.storms) {
    lines.push(`\n## Active tropical cyclones: ${f.storms.features.length}`);
    for (const s of f.storms.features) lines.push(`  ${s.properties.classification} ${s.properties.name} — ${s.properties.intensityKt}kt, ${s.properties.pressureMb}mb`);
  }
  if (f.alerts) {
    lines.push(`\n## Active alerts: ${f.alerts.features.length} (${f.alerts.sources.join(', ')})`);
    for (const al of f.alerts.features.slice(0, 8)) lines.push(`  [${al.properties.severity || '?'}] ${al.properties.event} — ${al.properties.areaDesc || al.properties.country || ''}`);
  }
  if (f.wildfires) lines.push(`\n## Wildfire hotspots: ${f.wildfires.features.length}`);
  if (snap.tiles?.radar) lines.push(`\n## Radar: ${snap.tiles.radar.frames?.length || 0} frames, latest ${snap.tiles.radar.latest} (${snap.tiles.radar.source})`);
  if (snap.spaceWeather) lines.push(`\n## Space weather: Kp ${snap.spaceWeather.kpIndex} @ ${snap.spaceWeather.kpTime || snap.spaceWeather.validTime} (${snap.spaceWeather.source})`);
  lines.push(`\n## Sources: ${snap.sources.map(s => `${s.id}:${s.status}`).join('  ')}`);
  if (snap.intel?.answer) lines.push(`\n## Intel (${snap.intel.provider_used})\n${snap.intel.answer}`);
  if (snap.intel?.error) lines.push(`\n## Intel: failed — ${snap.intel.error}`);
  return lines.join('\n');
}

function eventKey(domain, p) {
  return `${domain}:${p.id || p.title || p.name || p.time || JSON.stringify(p).slice(0, 40)}`;
}

async function once() {
  return worldState({ domains, bbox, time: args.time, synthesize: args.synthesize, question: args.question,
    provider: args.provider, fallback: args.fallback, onProgress: progress });
}

async function main() {
  if (args.cmd === 'ask') {
    const question = args._.join(' ').trim();
    if (!question) { process.stderr.write('usage: weather-intel ask "<question>"\n'); return process.exit(1); }
    err('working it out (locate → forecast → answer)…\n');
    const r = await answerQuestion(question, { provider: args.provider, fallback: args.fallback,
      onProgress: args.quiet ? null : (ev) => err(`  · ${ev.phase}${ev.name ? ' ' + ev.name : ''}\n`) });
    if (args.json) return finish(JSON.stringify(r, null, 2) + '\n');
    const where = r.locations?.length ? ` (${r.locations.map(l => `${l.name}, ${l.country}`).join('; ')})` : '';
    return finish(`${r.answer}\n\n— ${r.scope}${where} · ${r.provider_used}\n`);
  }
  if (args.cmd === 'sources') {
    const s = listSources();
    if (args.json) return finish(JSON.stringify(s, null, 2) + '\n');
    out('Registered sources:\n');
    for (const x of s) out(`  ${x.enabled ? '✓' : '·'} ${x.id.padEnd(12)} [${x.domains.join(',')}] ${x.coverage.global ? 'global' : 'regional'}${x.configured ? '' : ' (needs key)'}\n`);
    return process.exit(0);
  }

  if (args.watch != null) {
    // Stream new events/frames as NDJSON until Ctrl-C.
    const seen = new Set();
    let firstRadar = null;
    err(`watching ${args.cmd} every ${args.watch}s (Ctrl-C to stop)…\n`);
    for (;;) {
      const snap = await once();
      for (const [, coll] of Object.entries(snap.features || {})) {
        for (const ft of coll.features) {
          const k = eventKey(coll.sources?.[0] || 'f', ft.properties);
          if (!seen.has(k)) { seen.add(k); out(JSON.stringify({ t: snap.generatedAt, type: 'feature', feature: ft }) + '\n'); }
        }
      }
      const latest = snap.tiles?.radar?.latest;
      if (latest && latest !== firstRadar) { firstRadar = latest; out(JSON.stringify({ t: snap.generatedAt, type: 'radar', latest }) + '\n'); }
      await new Promise(r => setTimeout(r, args.watch * 1000));
    }
  }

  const snap = await once();
  finish(args.json ? JSON.stringify(snap, null, 2) + '\n' : humanSummary(snap) + '\n');
}

main().catch((e) => {
  process.stderr.write(`weather-intel failed: ${e.message}\n`);
  process.exit(1);
});
