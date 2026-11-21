// ─── Remote AI Processor Server ─────────────────────────────────────────────
import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import https from 'https';
import http from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from './config.js';
import { logger } from './logger.js';
import { streamChat, embedText, listModels, getLoadedModels, activeBackend } from './llm.js';
import { logJobQueued, logJobStarted, logJobFinished, queryJobs, queryStats, queryAnalytics } from './db.js';
import {
  queue, expressQueue,
  registerJob, updateJob, getJob,
  registerAbortController, unregisterAbortController,
  cancelJob, flushQueues, getJobStats, getQueueTotals,
} from './queue.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ─── Request logger middleware ────────────────────────────────────────────────
app.use(logger.requestMiddleware());

// ─── Serve dashboard (Vite build output) ─────────────────────────────────────
app.use(express.static(join(__dirname, 'public')));

// ─── Auth middleware ──────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  if (!config.apiKey) return next(); // auth disabled
  const key = req.headers['x-api-key'] ?? req.query.apiKey;
  if (key !== config.apiKey) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ─── GET /api/v1/health ───────────────────────────────────────────────────────
app.get('/api/v1/health', async (req, res) => {
  const stats  = getJobStats();
  const totals = getQueueTotals();
  const mem    = process.memoryUsage();

  // Backend calls are best-effort — processor stays up even if backend is down
  let models        = [];
  let loadedModels  = [];
  let backendStatus = 'ok';
  let backendError  = null;

  try {
    [models, loadedModels] = await Promise.all([listModels(), getLoadedModels()]);
  } catch (err) {
    backendStatus = 'unreachable';
    backendError  = err.message;
  }

  res.json({
    status:  backendStatus === 'ok' ? 'ok' : 'degraded',
    backend: activeBackend,
    backendStatus,
    ...(backendError ? { backendError } : {}),
    queues: {
      llm:     { waiting: queue.size,        running: queue.pending,        total: totals.llm     },
      express: { waiting: expressQueue.size, running: expressQueue.pending, total: totals.express },
    },
    jobs: stats,
    llm: {
      models,
      loaded: loadedModels,
    },
    memory: {
      rss:       Math.round(mem.rss       / 1024 / 1024),
      heapUsed:  Math.round(mem.heapUsed  / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      external:  Math.round(mem.external  / 1024 / 1024),
    },
    config: {
      concurrency:        config.concurrency,
      concurrencyExpress: config.concurrencyExpress,
      models:             config.models,
    },
  });
});

// ─── POST /api/v1/process  (streaming via SSE) ───────────────────────────────
//
// Request body:
// {
//   "mode":         "thinking" | "coder" | "default",
//   "userPrompt":   "...",
//   "systemPrompt": "...",          // optional
//   "model":        "llama3.2:3b",  // optional override
//   "options":      { "temperature": 0.5 }  // optional Ollama params
// }
//
// Response: text/event-stream
//   data: {"type":"queued","jobId":"...","position":N}
//   data: {"type":"start","jobId":"...","model":"...","mode":"..."}
//   data: {"type":"token","token":"..."}
//   data: {"type":"done","jobId":"...","elapsed":1234}
//   data: {"type":"error","jobId":"...","error":"..."}
//   data: {"type":"cancelled","jobId":"..."}
//
app.post('/api/v1/process', authMiddleware, async (req, res) => {
  const { mode = 'default', userPrompt, systemPrompt = '', model: modelOverride, options = {} } = req.body;

  if (!userPrompt) {
    return res.status(400).json({ error: 'userPrompt is required' });
  }

  const jobId    = randomUUID();
  const clientId = req.headers['x-client-id'] ?? 'unknown';
  const model    = modelOverride ?? config.models[mode] ?? config.models.default;

  registerJob(jobId, { clientId, mode, model, startedAt: null });
  logJobQueued({ jobId, clientId, clientIp: req.ip, mode, model, backend: activeBackend, userPrompt });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Job-Id', jobId);
  res.flushHeaders();

  function send(obj) {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  }

  const abortCtrl = new AbortController();
  registerAbortController(jobId, abortCtrl);
  req.on('close', () => abortCtrl.abort());

  // Auto-abort if the job runs longer than JOB_TIMEOUT_MS
  const timeoutId = setTimeout(() => {
    logger.warn('job timeout', { jobId, timeoutMs: config.jobTimeoutMs });
    abortCtrl.abort();
  }, config.jobTimeoutMs);

  send({ type: 'queued', jobId, position: queue.size + queue.pending });

  queue.add(async () => {
    if (abortCtrl.signal.aborted) {
      clearTimeout(timeoutId);
      unregisterAbortController(jobId);
      return;
    }

    const startedAt = Date.now();
    updateJob(jobId, { status: 'running', startedAt });
    logJobStarted({ jobId });
    logger.info('job start', { jobId, model, mode, clientId });
    send({ type: 'start', jobId, model, mode });

    try {
      await streamChat({
        model, systemPrompt, userPrompt, options,
        signal: abortCtrl.signal,
        onToken: (token) => send({ type: 'token', token }),
      });

      const elapsed = Date.now() - startedAt;
      updateJob(jobId, { status: 'done', finishedAt: Date.now() });
      logJobFinished({ jobId, status: 'done', elapsedMs: elapsed });
      logger.info('job done', { jobId, elapsedMs: elapsed });
      send({ type: 'done', jobId, elapsed });
    } catch (err) {
      if (err.name === 'AbortError') {
        updateJob(jobId, { status: 'cancelled', finishedAt: Date.now() });
        logJobFinished({ jobId, status: 'cancelled' });
        logger.info('job cancelled', { jobId });
        send({ type: 'cancelled', jobId });
      } else {
        logger.error('job error', { jobId, error: err.message });
        updateJob(jobId, { status: 'error', error: err.message, finishedAt: Date.now() });
        logJobFinished({ jobId, status: 'error', error: err.message });
        send({ type: 'error', jobId, error: err.message });
      }
    } finally {
      clearTimeout(timeoutId);
      unregisterAbortController(jobId);
      res.end();
    }
  });
});

// ─── POST /api/v1/process/batch  (non-streaming) ─────────────────────────────
app.post('/api/v1/process/batch', authMiddleware, async (req, res) => {
  const { mode = 'default', userPrompt, systemPrompt = '', model: modelOverride, options = {} } = req.body;

  if (!userPrompt) return res.status(400).json({ error: 'userPrompt is required' });

  const jobId    = randomUUID();
  const clientId = req.headers['x-client-id'] ?? 'unknown';
  const model    = modelOverride ?? config.models[mode] ?? config.models.default;
  registerJob(jobId, { clientId, mode, model });
  logJobQueued({ jobId, clientId, clientIp: req.ip, mode, model, backend: activeBackend, userPrompt });

  const abortCtrl = new AbortController();
  registerAbortController(jobId, abortCtrl);

  // Abort when client disconnects before the response is sent.
  // Use res 'close' (not req 'close') — req closes as soon as the JSON body is
  // consumed by express.json(), which is immediately and would abort every job.
  // res 'close' only fires when the socket is destroyed before we finish writing.
  res.on('close', () => {
    if (!res.writableEnded) abortCtrl.abort();
  });

  // Auto-abort if the job runs longer than JOB_TIMEOUT_MS
  const timeoutId = setTimeout(() => {
    logger.warn('job timeout', { jobId, timeoutMs: config.jobTimeoutMs });
    abortCtrl.abort();
  }, config.jobTimeoutMs);

  try {
    const startedAt = Date.now();
    const result = await queue.add(async () => {
      if (abortCtrl.signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
      updateJob(jobId, { status: 'running', startedAt });
      logJobStarted({ jobId });
      let full = '';
      await streamChat({
        model, systemPrompt, userPrompt, options,
        signal: abortCtrl.signal,
        onToken: (t) => { full += t; },
      });
      return full;
    });

    const elapsed = Date.now() - startedAt;
    clearTimeout(timeoutId);
    unregisterAbortController(jobId);
    updateJob(jobId, { status: 'done', finishedAt: Date.now() });
    logJobFinished({ jobId, status: 'done', elapsedMs: elapsed });
    res.json({ jobId, result });
  } catch (err) {
    clearTimeout(timeoutId);
    unregisterAbortController(jobId);
    if (err.name === 'AbortError') {
      updateJob(jobId, { status: 'cancelled', finishedAt: Date.now() });
      logJobFinished({ jobId, status: 'cancelled' });
      return res.status(409).json({ jobId, error: 'Job was cancelled' });
    }
    updateJob(jobId, { status: 'error', error: err.message, finishedAt: Date.now() });
    logJobFinished({ jobId, status: 'error', error: err.message });
    res.status(500).json({ jobId, error: err.message });
  }
});

// ─── POST /api/v1/embed ───────────────────────────────────────────────────────
app.post('/api/v1/embed', authMiddleware, async (req, res) => {
  const { input, model: modelOverride } = req.body;

  if (!input) return res.status(400).json({ error: 'input is required' });

  const jobId    = randomUUID();
  const clientId = req.headers['x-client-id'] ?? 'unknown';
  const model    = modelOverride ?? config.models.embed;
  registerJob(jobId, { clientId, mode: 'embed', model });
  logJobQueued({ jobId, clientId, clientIp: req.ip, mode: 'embed', model, backend: activeBackend, userPrompt: Array.isArray(input) ? input[0] : input });

  const abortCtrl = new AbortController();
  registerAbortController(jobId, abortCtrl);

  try {
    const startedAt  = Date.now();
    const embeddings = await expressQueue.add(async () => {
      if (abortCtrl.signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
      updateJob(jobId, { status: 'running', startedAt });
      logJobStarted({ jobId });
      return embedText({ model, input, signal: abortCtrl.signal });
    });

    const elapsed = Date.now() - startedAt;
    unregisterAbortController(jobId);
    updateJob(jobId, { status: 'done', finishedAt: Date.now() });
    logJobFinished({ jobId, status: 'done', elapsedMs: elapsed });
    res.json({ jobId, embeddings });
  } catch (err) {
    unregisterAbortController(jobId);
    if (err.name === 'AbortError') {
      updateJob(jobId, { status: 'cancelled', finishedAt: Date.now() });
      logJobFinished({ jobId, status: 'cancelled' });
      return res.status(409).json({ jobId, error: 'Job was cancelled' });
    }
    updateJob(jobId, { status: 'error', error: err.message, finishedAt: Date.now() });
    logJobFinished({ jobId, status: 'error', error: err.message });
    res.status(500).json({ jobId, error: err.message });
  }
});

// ─── GET /api/v1/jobs  (paginated job history from SQLite) ───────────────────
//
// Query params (all optional):
//   status    — queued | running | done | error | cancelled
//   clientId  — filter by client
//   model     — filter by model name
//   since     — ISO date string or ms timestamp
//   page      — page number (default 1)
//   pageSize  — results per page (default 50, max 200)
//
app.get('/api/v1/jobs', authMiddleware, (req, res) => {
  const { status, clientId, model, since, page = '1', pageSize = '50' } = req.query;

  const sinceMs  = since ? (isNaN(since) ? Date.parse(since) : Number(since)) : null;
  const pageNum  = Math.max(1, parseInt(page, 10));
  const pageSz   = Math.min(200, Math.max(1, parseInt(pageSize, 10)));

  const result = queryJobs({
    status:   status   || null,
    clientId: clientId || null,
    model:    model    || null,
    since:    sinceMs  || null,
    page:     pageNum,
    pageSize: pageSz,
  });

  res.json(result);
});

// ─── GET /api/v1/jobs/stats  (aggregate stats) ────────────────────────────────
//
// Query params:
//   days — look-back window in days (default 7)
//
app.get('/api/v1/jobs/stats', authMiddleware, (req, res) => {
  const days = Math.min(365, Math.max(1, parseInt(req.query.days || '7', 10)));
  res.json(queryStats(days));
});

// ─── GET /api/v1/jobs/analytics ───────────────────────────────────────────────
//
// Per-client call counts broken down by mode (thinking / coder / general / embed).
// Used by the dashboard analytics charts.
//
// Query params (all optional):
//   status — filter by job status (queued | running | done | error | cancelled)
//   year   — filter by calendar year e.g. 2026
//
// Response:
// {
//   "byClient": [
//     { "client_id": "rpi-kitchen", "thinking": 12, "coder": 5, "general": 83, "embed": 234, "total": 334 },
//     ...
//   ],
//   "years": ["2026", "2025"]   // all years present in the DB, newest first
// }
//
app.get('/api/v1/jobs/analytics', authMiddleware, (req, res) => {
  const { status, year } = req.query;

  // Validate year — must be 4-digit number string or absent
  const yearVal = year && /^\d{4}$/.test(year) ? year : null;

  res.json(queryAnalytics({
    status: status || null,
    year:   yearVal,
  }));
});

// ─── GET /api/v1/job/:id ──────────────────────────────────────────────────────
app.get('/api/v1/job/:id', authMiddleware, (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// ─── DELETE /api/v1/job/:id ───────────────────────────────────────────────────
app.delete('/api/v1/job/:id', authMiddleware, (req, res) => {
  const result = cancelJob(req.params.id);
  if (!result.ok) {
    const status = result.reason === 'not_found' ? 404 : 409;
    return res.status(status).json({ error: result.reason, ...result });
  }
  res.json({ jobId: req.params.id, cancelled: true });
});

// ─── POST /api/v1/queue/flush ─────────────────────────────────────────────────
app.post('/api/v1/queue/flush', authMiddleware, (req, res) => {
  flushQueues();
  res.json({ flushed: true, message: 'All queues cleared and running jobs cancelled' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const { keyPath, certPath } = config.ssl;
const useHttps = keyPath && certPath;

function onListening(protocol) {
  logger.info('server ready', {
    url      : `${protocol}://${config.host}:${config.port}`,
    dashboard: `${protocol}://localhost:${config.port}/`,
    backend  : activeBackend,
    tls      : useHttps ? 'https' : 'http',
    auth     : config.apiKey ? 'enabled' : 'disabled',
    concurrency    : config.concurrency,
    concurrencyExpress: config.concurrencyExpress,
    logLevel : config.log.level,
    logFormat: config.log.format,
    models   : config.models,
  });
}

if (useHttps) {
  let key, cert;
  try {
    key  = readFileSync(keyPath);
    cert = readFileSync(certPath);
  } catch (err) {
    logger.error('SSL cert/key load failed — check SSL_KEY_PATH and SSL_CERT_PATH in .env', {
      error: err.message,
    });
    process.exit(1);
  }
  https.createServer({ key, cert }, app).listen(config.port, config.host, () => onListening('https'));
} else {
  http.createServer(app).listen(config.port, config.host, () => onListening('http'));
}
