// GET /api/answer?q=<question>[&provider=&fallback=]
// The agent step: answer ANY question from a weather angle (geocode → forecast →
// answer, or global snapshot fallback). Returns { answer, locations, scope }.

import { Router } from 'express';
import { answerQuestion } from '../lib/answer.js';

export const answerRouter = Router();

const csv = (v) => (v || '').split(',').map(s => s.trim()).filter(Boolean);

answerRouter.get('/', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q (question) required' });
  try {
    const out = await answerQuestion(q, {
      provider: (req.query.provider || '').trim() || undefined,
      fallback: csv(req.query.fallback),
    });
    res.json(out);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
