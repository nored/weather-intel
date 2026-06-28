// In-memory registry of in-flight research runs, so a client that reloads
// mid-run can re-attach to the live event stream instead of losing it. Each run
// buffers its events; subscribers (the original POST stream, or a reconnecting
// GET stream) get a replay of buffered events then live updates until finish.

const runs = new Map();
let seq = 0;
const TTL_MS = 5 * 60 * 1000; // keep finished runs briefly so late reconnects still resolve

export function createRun(meta = {}) {
  const id = `r-${Date.now().toString(36)}-${(seq++).toString(36)}`;
  runs.set(id, { id, status: 'running', events: [], result: null, error: null, subs: new Set(), meta });
  return id;
}

export function emitRun(id, event, data) {
  const r = runs.get(id);
  if (!r) return;
  r.events.push({ event, data });
  for (const s of r.subs) { try { s(event, data); } catch {} }
}

export function finishRun(id, result) {
  const r = runs.get(id);
  if (!r) return;
  r.status = 'done'; r.result = result;
  for (const s of r.subs) { try { s('result', result); } catch {} }
  r.subs.clear();
  scheduleCleanup(id);
}

export function failRun(id, message) {
  const r = runs.get(id);
  if (!r) return;
  r.status = 'error'; r.error = message;
  for (const s of r.subs) { try { s('error', { message }); } catch {} }
  r.subs.clear();
  scheduleCleanup(id);
}

export function getRunStatus(id) {
  const r = runs.get(id);
  return r ? { id: r.id, status: r.status, meta: r.meta } : null;
}

// Attach a sender. Replays buffered events, then live ones. For an
// already-finished run, replays everything plus the final result/error.
// Returns an unsubscribe fn (no-op if the run is already done).
export function subscribe(id, send) {
  const r = runs.get(id);
  if (!r) return null;
  for (const m of r.events) { try { send(m.event, m.data); } catch {} }
  if (r.status === 'done') { try { send('result', r.result); } catch {} return () => {}; }
  if (r.status === 'error') { try { send('error', { message: r.error }); } catch {} return () => {}; }
  r.subs.add(send);
  return () => r.subs.delete(send);
}

function scheduleCleanup(id) {
  const t = setTimeout(() => runs.delete(id), TTL_MS);
  if (t.unref) t.unref();
}
