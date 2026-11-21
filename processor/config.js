import dotenv from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Processor Configuration ────────────────────────────────────────────────
export const config = {
  // Server
  port: process.env.PORT || 3000,
  host: process.env.HOST || '0.0.0.0',

  // ── LLM Backend ────────────────────────────────────────────────────────────
  backend: process.env.BACKEND || 'ollama',

  // Ollama backend config
  ollama: {
    url: process.env.OLLAMA_URL || 'http://localhost:11434',
  },

  // OpenAI-compatible backend config
  openai: {
    url:    process.env.OPENAI_URL     || 'http://localhost:1234',
    apiKey: process.env.OPENAI_API_KEY || '',
  },

  // ── Model assignments per mode ──────────────────────────────────────────────
  models: {
    thinking: process.env.MODEL_THINKING || 'deepseek-r1:14b',
    coder:    process.env.MODEL_CODER    || 'gpt-oss:20b',
    default:  process.env.MODEL_DEFAULT  || 'llama3.2:3b',
    embed:    process.env.MODEL_EMBED    || 'nomic-embed-text',
  },

  // ── Queue ───────────────────────────────────────────────────────────────────
  concurrency:        parseInt(process.env.CONCURRENCY         || '4',      10),
  concurrencyExpress: parseInt(process.env.CONCURRENCY_EXPRESS || '8',      10),
  jobTimeoutMs:       parseInt(process.env.JOB_TIMEOUT_MS      || String(10 * 60 * 1000), 10),

  // ── Auth ────────────────────────────────────────────────────────────────────
  apiKey: process.env.API_KEY || '',

  // ── HTTPS ───────────────────────────────────────────────────────────────────
  ssl: {
    keyPath:  process.env.SSL_KEY_PATH  || '',
    certPath: process.env.SSL_CERT_PATH || '',
  },

  // ── SQLite job log ──────────────────────────────────────────────────────────
  db: {
    path:          resolve(__dirname, process.env.DB_PATH || './data/jobs.db'),
    retentionDays: parseInt(process.env.LOG_RETENTION_DAYS || '30', 10),
  },

  // ── Structured logging ──────────────────────────────────────────────────────
  log: {
    level:  (['debug', 'info', 'warn', 'error'].includes(process.env.LOG_LEVEL)
              ? process.env.LOG_LEVEL : 'info'),
    format: (['pretty', 'json'].includes(process.env.LOG_FORMAT)
              ? process.env.LOG_FORMAT : 'pretty'),
  },
};
