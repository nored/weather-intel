// Shared SSE driver for streamed snapshot assembly. Runs through the run registry
// so the original POST stream AND any reconnecting GET /api/runs/:id/stream share
// one event source. Assembly keeps running even if the client disconnects.

import { worldState } from './api.js';
import { createRun, emitRun, finishRun, failRun, subscribe } from './runs.js';

export function openSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  return (event, data) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {} };
}

// opts: { domains, bbox, time, synthesize, question, provider, fallback, meta }
export async function driveWorld(req, res, opts) {
  const runId = createRun(opts.meta || {});
  const send = openSSE(res);
  const unsub = subscribe(runId, send);
  let aborted = false;
  const ac = new AbortController();
  req.on('close', () => { aborted = true; ac.abort(); if (unsub) unsub(); });

  emitRun(runId, 'run', { runId, ...(opts.meta || {}) });

  try {
    const snapshot = await worldState({
      ...opts,
      signal: ac.signal,
      onProgress: (ev) => emitRun(runId, 'progress', ev),
    });
    finishRun(runId, snapshot);
  } catch (e) {
    failRun(runId, e.message);
  }
  if (!aborted) res.end();
}
