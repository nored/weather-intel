// Reconnect API for in-flight snapshot runs:
//   GET /api/runs/:id         — status snapshot
//   GET /api/runs/:id/stream  — SSE: replay buffered events then live updates

import { Router } from 'express';
import { getRunStatus, subscribe } from '../lib/runs.js';
import { openSSE } from '../lib/run-world.js';

export const runsRouter = Router();

runsRouter.get('/:id', (req, res) => {
  const s = getRunStatus(req.params.id);
  if (!s) return res.status(404).json({ status: 'unknown' });
  res.json(s);
});

runsRouter.get('/:id/stream', (req, res) => {
  const base = openSSE(res);
  const send = (event, data) => {
    base(event, data);
    if (event === 'result' || event === 'error') res.end();
  };
  const unsub = subscribe(req.params.id, send);
  if (!unsub) { send('error', { message: 'run not found or expired' }); return; }
  req.on('close', () => unsub());
});
