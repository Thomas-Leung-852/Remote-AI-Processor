// ─── SQLite Job Log ──────────────────────────────────────────────────────────
// Persists every job to a local SQLite database for analytics and dashboard history.
// Uses better-sqlite3 (synchronous, zero-config, single file).
//
// DB file location: controlled by DB_PATH in .env (default: ./data/jobs.db)
// Retention:        controlled by LOG_RETENTION_DAYS in .env (default: 30 days)

import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { config } from './config.js';
import { logger } from './logger.js';

// ─── Open / initialise database ───────────────────────────────────────────────

// Ensure the data directory exists
mkdirSync(dirname(config.db.path), { recursive: true });

const db = new Database(config.db.path);

// Performance pragmas — safe for single-writer workload
db.pragma('journal_mode = WAL');   // Write-Ahead Logging: better concurrent reads
db.pragma('synchronous = NORMAL'); // Safe + fast (not FULL — no need for ACID at this scale)
db.pragma('foreign_keys = ON');

// ─── Schema ───────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id        TEXT    NOT NULL UNIQUE,
    client_id     TEXT    NOT NULL DEFAULT 'unknown',
    client_ip     TEXT    NOT NULL DEFAULT 'unknown',
    mode          TEXT    NOT NULL DEFAULT 'default',
    model         TEXT    NOT NULL DEFAULT '',
    backend       TEXT    NOT NULL DEFAULT 'ollama',
    prompt_preview TEXT   NOT NULL DEFAULT '',
    status        TEXT    NOT NULL DEFAULT 'queued',
    elapsed_ms    INTEGER,
    error         TEXT,
    queued_at     INTEGER NOT NULL,
    started_at    INTEGER,
    finished_at   INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_queued_at  ON jobs (queued_at);
  CREATE INDEX IF NOT EXISTS idx_jobs_status     ON jobs (status);
  CREATE INDEX IF NOT EXISTS idx_jobs_client_id  ON jobs (client_id);
  CREATE INDEX IF NOT EXISTS idx_jobs_model      ON jobs (model);
`);

// ─── Prepared statements (compiled once, reused) ──────────────────────────────

const stmtInsert = db.prepare(`
  INSERT OR IGNORE INTO jobs
    (job_id, client_id, client_ip, mode, model, backend, prompt_preview, status, queued_at)
  VALUES
    (@jobId, @clientId, @clientIp, @mode, @model, @backend, @promptPreview, 'queued', @queuedAt)
`);

const stmtStart = db.prepare(`
  UPDATE jobs
  SET status = 'running', started_at = @startedAt
  WHERE job_id = @jobId
`);

const stmtFinish = db.prepare(`
  UPDATE jobs
  SET status      = @status,
      elapsed_ms  = @elapsedMs,
      error       = @error,
      finished_at = @finishedAt
  WHERE job_id = @jobId
`);

const stmtListFiltered = db.prepare(`
  SELECT * FROM jobs
  WHERE (:status   IS NULL OR status    = :status)
    AND (:clientId IS NULL OR client_id = :clientId)
    AND (:model    IS NULL OR model     = :model)
    AND (:since    IS NULL OR queued_at >= :since)
  ORDER BY queued_at DESC
  LIMIT :limit OFFSET :offset
`);

const stmtCount = db.prepare(`
  SELECT COUNT(*) AS total FROM jobs
  WHERE (:status   IS NULL OR status    = :status)
    AND (:clientId IS NULL OR client_id = :clientId)
    AND (:model    IS NULL OR model     = :model)
    AND (:since    IS NULL OR queued_at >= :since)
`);

const stmtPurge = db.prepare(`
  DELETE FROM jobs WHERE queued_at < @cutoff
`);

const stmtStats = db.prepare(`
  SELECT
    COUNT(*)                                          AS total,
    SUM(CASE WHEN status = 'done'      THEN 1 ELSE 0 END) AS done,
    SUM(CASE WHEN status = 'error'     THEN 1 ELSE 0 END) AS error,
    SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
    AVG(CASE WHEN status = 'done' AND elapsed_ms IS NOT NULL
             THEN elapsed_ms END)                     AS avgElapsedMs,
    COUNT(DISTINCT client_id)                         AS uniqueClients,
    COUNT(DISTINCT model)                             AS uniqueModels
  FROM jobs
  WHERE queued_at >= @since
`);

// Analytics: per-client call counts broken down by mode.
// Optionally filtered by status and/or calendar year.
// Returns one row per client_id, sorted by total DESC.
const stmtAnalytics = db.prepare(`
  SELECT
    client_id,
    SUM(CASE WHEN mode = 'thinking' THEN 1 ELSE 0 END) AS thinking,
    SUM(CASE WHEN mode = 'coder'    THEN 1 ELSE 0 END) AS coder,
    SUM(CASE WHEN mode = 'default'  THEN 1 ELSE 0 END) AS general,
    SUM(CASE WHEN mode = 'embed'    THEN 1 ELSE 0 END) AS embed,
    COUNT(*)                                            AS total
  FROM jobs
  WHERE (:status IS NULL OR status = :status)
    AND (:year   IS NULL OR CAST(strftime('%Y', datetime(queued_at / 1000, 'unixepoch')) AS TEXT) = :year)
  GROUP BY client_id
  ORDER BY total DESC
`);

// All distinct years present in the jobs table (for year filter dropdown).
const stmtYears = db.prepare(`
  SELECT DISTINCT
    CAST(strftime('%Y', datetime(queued_at / 1000, 'unixepoch')) AS TEXT) AS year
  FROM jobs
  ORDER BY year DESC
`);

// ─── Public API ───────────────────────────────────────────────────────────────

const PREVIEW_LEN = 200;

/**
 * Record a new job when it enters the queue.
 */
export function logJobQueued({ jobId, clientId, clientIp, mode, model, backend, userPrompt }) {
  stmtInsert.run({
    jobId,
    clientId:      clientId  || 'unknown',
    clientIp:      clientIp  || 'unknown',
    mode:          mode      || 'default',
    model:         model     || '',
    backend:       backend   || config.backend,
    promptPreview: (userPrompt || '').slice(0, PREVIEW_LEN),
    queuedAt:      Date.now(),
  });
}

/**
 * Update job status when Ollama/backend starts processing.
 */
export function logJobStarted({ jobId }) {
  stmtStart.run({ jobId, startedAt: Date.now() });
}

/**
 * Update job status when it completes (done / error / cancelled).
 */
export function logJobFinished({ jobId, status, elapsedMs = null, error = null }) {
  stmtFinish.run({
    jobId,
    status,
    elapsedMs:  elapsedMs ?? null,
    error:      error     ?? null,
    finishedAt: Date.now(),
  });
}

/**
 * Query job history with optional filters.
 * Returns { jobs, total, page, pageSize }.
 */
export function queryJobs({
  status   = null,
  clientId = null,
  model    = null,
  since    = null,   // ms timestamp
  page     = 1,
  pageSize = 50,
} = {}) {
  const params = {
    status:   status   || null,
    clientId: clientId || null,
    model:    model    || null,
    since:    since    || null,
    limit:    pageSize,
    offset:   (page - 1) * pageSize,
  };

  const jobs  = stmtListFiltered.all(params);
  const total = stmtCount.get(params).total;

  return { jobs, total, page, pageSize };
}

/**
 * Aggregate stats for the last N days (default 7).
 */
export function queryStats(days = 7) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const row   = stmtStats.get({ since });
  return {
    period:        `${days}d`,
    total:         row.total         ?? 0,
    done:          row.done          ?? 0,
    error:         row.error         ?? 0,
    cancelled:     row.cancelled     ?? 0,
    avgElapsedMs:  row.avgElapsedMs  ? Math.round(row.avgElapsedMs) : null,
    uniqueClients: row.uniqueClients ?? 0,
    uniqueModels:  row.uniqueModels  ?? 0,
  };
}

/**
 * Per-client analytics aggregated by mode.
 *
 * @param {object} opts
 * @param {string|null} opts.status  — filter by job status (null = all)
 * @param {string|null} opts.year    — filter by calendar year e.g. '2026' (null = all)
 * @returns {{ byClient: Array, years: string[] }}
 */
export function queryAnalytics({ status = null, year = null } = {}) {
  const byClient = stmtAnalytics.all({
    status: status || null,
    year:   year   || null,
  });
  const years = stmtYears.all().map(r => r.year);
  return { byClient, years };
}

/**
 * Delete jobs older than LOG_RETENTION_DAYS.
 * Called once at startup and nightly thereafter.
 */
export function purgeOldJobs() {
  const cutoff  = Date.now() - config.db.retentionDays * 24 * 60 * 60 * 1000;
  const result  = stmtPurge.run({ cutoff });
  if (result.changes > 0) {
    logger.info('db purge', { count: result.changes, retentionDays: config.db.retentionDays });
  }
}

// ─── Startup: mark stale jobs left over from a previous server run ────────────
// Any job still in 'queued' or 'running' state when the server starts means the
// server crashed or was restarted mid-job. Mark them cancelled so the dashboard
// does not show phantom running jobs.
const stmtMarkStale = db.prepare(`
  UPDATE jobs
  SET status      = 'cancelled',
      error       = 'Server restarted — job interrupted',
      finished_at = @now
  WHERE status IN ('queued', 'running')
`);

export function markStaleJobsInterrupted() {
  const result = stmtMarkStale.run({ now: Date.now() });
  if (result.changes > 0) {
    logger.info('db startup: marked stale jobs as cancelled', { count: result.changes });
  }
}

// ─── Startup purge + nightly schedule ────────────────────────────────────────
markStaleJobsInterrupted();  // must run before purgeOldJobs
purgeOldJobs();
setInterval(purgeOldJobs, 24 * 60 * 60 * 1000);

logger.info('db open', { path: config.db.path });
