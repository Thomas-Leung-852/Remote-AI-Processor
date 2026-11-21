// ─── Structured Logger ───────────────────────────────────────────────────────
// Zero-dependency structured logger for the Remote AI Processor.
//
// Log levels (ascending severity):
//   debug  — verbose internal detail (queue transitions, token counts, etc.)
//   info   — normal operational events (startup, job queued/done, purge)
//   warn   — recoverable anomalies (backend degraded, auth failure, etc.)
//   error  — failures that need attention (SSL load failure, job crash, etc.)
//
// Output formats:
//   pretty — human-readable, coloured, timestamp prefix. Default for dev.
//   json   — one JSON object per line. Use in production / log aggregators.
//
// Environment variables (read once at import time):
//   LOG_LEVEL  = debug | info | warn | error   (default: info)
//   LOG_FORMAT = pretty | json                 (default: pretty)

import { config } from './config.js';

// ─── Level map ────────────────────────────────────────────────────────────────

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const currentLevel = LEVELS[config.log.level] ?? LEVELS.info;

// ─── ANSI colour helpers (pretty format only) ─────────────────────────────────

const C = {
  reset : '\x1b[0m',
  dim   : '\x1b[2m',
  bold  : '\x1b[1m',
  debug : '\x1b[36m',   // cyan
  info  : '\x1b[32m',   // green
  warn  : '\x1b[33m',   // yellow
  error : '\x1b[31m',   // red
};

/** Pad level label to fixed width for column alignment */
function padLevel(level) {
  return level.toUpperCase().padEnd(5);
}

// ─── Core write function ──────────────────────────────────────────────────────

function write(level, msg, meta) {
  if (LEVELS[level] < currentLevel) return;

  const ts = new Date().toISOString();

  if (config.log.format === 'json') {
    // ── JSON: one compact line per entry ──────────────────────────────────────
    // All meta fields are spread to the top level for easy grepping.
    // e.g.  {"ts":"2026-11-19T...","level":"info","msg":"job queued","jobId":"..."}
    const entry = { ts, level, msg, ...meta };
    process.stdout.write(JSON.stringify(entry) + '\n');
  } else {
    // ── Pretty: coloured, human-readable ──────────────────────────────────────
    // 2026-11-19T12:34:56.789Z INFO  job queued  {"jobId":"...","model":"..."}
    const colour  = C[level] ?? C.reset;
    const metaStr = meta && Object.keys(meta).length
      ? '  ' + C.dim + JSON.stringify(meta) + C.reset
      : '';
    const line = `${C.dim}${ts}${C.reset} ${colour}${C.bold}${padLevel(level)}${C.reset} ${msg}${metaStr}`;
    // Use stderr for error/warn so they don't pollute piped stdout in pretty mode
    if (level === 'error' || level === 'warn') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const logger = {
  debug : (msg, meta = {}) => write('debug', msg, meta),
  info  : (msg, meta = {}) => write('info',  msg, meta),
  warn  : (msg, meta = {}) => write('warn',  msg, meta),
  error : (msg, meta = {}) => write('error', msg, meta),

  /**
   * Express request-logger middleware.
   * Logs method + path + status + elapsed on response finish.
   * Skips /api/v1/process (SSE) to avoid one log per connection.
   */
  requestMiddleware() {
    return (req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        // Skip SSE stream — it stays open for minutes; not useful per-request
        if (req.path === '/api/v1/process' && req.method === 'POST') return;
        const elapsed = Date.now() - start;
        const level   = res.statusCode >= 500 ? 'error'
                      : res.statusCode >= 400 ? 'warn'
                      : 'debug';
        write(level, `${req.method} ${req.path}`, {
          status  : res.statusCode,
          elapsedMs: elapsed,
          ip      : req.ip,
          clientId: req.headers['x-client-id'] ?? undefined,
        });
      });
      next();
    };
  },
};
