import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Importing the API registers every LLM provider and source adapter (side
// effects), so all four interfaces share the exact same registries.
import './lib/api.js';

import { worldRouter } from './routes/world.js';
import { pointRouter } from './routes/point.js';
import { answerRouter } from './routes/answer.js';
import { layersRouter } from './routes/layers.js';
import { featuresRouter } from './routes/features.js';
import { tilesRouter } from './routes/tiles.js';
import { sourcesRouter } from './routes/sources.js';
import { providersRouter } from './routes/providers.js';
import { runsRouter } from './routes/runs.js';
import { sweepCache } from './lib/cache.js';
import { startPoller } from './lib/poller.js';
import { config } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', 'public');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use('/api/world', worldRouter);
app.use('/api/point', pointRouter);
app.use('/api/answer', answerRouter);
app.use('/api/layers', layersRouter);
app.use('/api/features', featuresRouter);
app.use('/api/tiles', tilesRouter);
app.use('/api/sources', sourcesRouter);
app.use('/api/providers', providersRouter);
app.use('/api/runs', runsRouter);

app.use(express.static(PUBLIC));

// Occasional disk-cache housekeeping (never blocks; unref'd).
const sweeper = setInterval(sweepCache, 6 * 60 * 60 * 1000);
if (sweeper.unref) sweeper.unref();

app.listen(config.port, () => {
  console.log(`weather-intel — planet view on http://localhost:${config.port}`);
  startPoller(); // keep the whole-Earth snapshot warm
});
