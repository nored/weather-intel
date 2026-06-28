// Background poller — periodically assembles the whole-Earth snapshot so the
// default planet view is instant and one assembly is shared across all clients
// (instead of every client triggering its own fan-out). Per-source caches stay
// warm as a side effect. The world route serves getLatest() for plain requests.

import { assembleSnapshot } from './merge.js';
import { config } from '../config.js';

let latest = null;   // { snapshot, at (ms) }
let timer = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const snapshot = await assembleSnapshot({}); // whole Earth, all domains
    latest = { snapshot, at: Date.now() };
  } catch (e) {
    // keep the previous snapshot on failure; individual sources already isolate.
    console.error('poller tick failed:', e.message);
  } finally {
    running = false;
  }
}

export function startPoller() {
  if (!config.pollEnabled || timer) return;
  tick(); // warm immediately on boot
  timer = setInterval(tick, config.pollIntervalSecs * 1000);
  if (timer.unref) timer.unref();
}

// Return the cached whole-Earth snapshot if newer than maxAgeMs, else null.
export function getLatest(maxAgeMs = config.pollIntervalSecs * 1000 * 2) {
  if (!latest) return null;
  if (Date.now() - latest.at > maxAgeMs) return null;
  return latest.snapshot;
}
