// ─── Concurrent Job Queue ────────────────────────────────────────────────────
import PQueue from 'p-queue';
import { config } from './config.js';

// LLM queue — slow, Ollama/vLLM inference (thinking / coder / default / batch)
export const queue = new PQueue({ concurrency: config.concurrency });

// Express queue — fast, non-LLM tasks (embeddings, etc.)
export const expressQueue = new PQueue({ concurrency: config.concurrencyExpress });

// ─── Cumulative throughput counters ──────────────────────────────────────────
// p-queue snapshots (size / pending) can't show fast-finishing jobs — they're
// already 0 by the time the dashboard polls. These accumulators never reset,
// so the queue cards always reflect real activity.

let llmTotal     = 0;
let expressTotal = 0;

queue.on('completed',       () => { llmTotal++;     });
expressQueue.on('completed', () => { expressTotal++; });

export function getQueueTotals() {
  return { llm: llmTotal, express: expressTotal };
}

// ─── Job registry ─────────────────────────────────────────────────────────────
// jobId → { status, result, error, startedAt, finishedAt, clientId, ... }
const jobs = new Map();

// AbortController registry: jobId → AbortController
const abortControllers = new Map();

// ─── Job helpers ──────────────────────────────────────────────────────────────

export function registerJob(jobId, meta) {
  jobs.set(jobId, { status: 'queued', result: null, error: null, startedAt: null, finishedAt: null, ...meta });
}

export function updateJob(jobId, patch) {
  const job = jobs.get(jobId);
  if (job) jobs.set(jobId, { ...job, ...patch });
}

export function getJob(jobId) {
  return jobs.get(jobId) ?? null;
}

// ─── AbortController helpers ──────────────────────────────────────────────────

export function registerAbortController(jobId, ctrl) {
  abortControllers.set(jobId, ctrl);
}

export function unregisterAbortController(jobId) {
  abortControllers.delete(jobId);
}

// ─── Cancel one job ───────────────────────────────────────────────────────────

export function cancelJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return { ok: false, reason: 'not_found' };

  if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
    return { ok: false, reason: 'already_finished', status: job.status };
  }

  // Abort if running
  const ctrl = abortControllers.get(jobId);
  if (ctrl) {
    ctrl.abort();
    abortControllers.delete(jobId);
  }

  updateJob(jobId, { status: 'cancelled', finishedAt: Date.now() });
  return { ok: true };
}

// ─── Flush both queues ────────────────────────────────────────────────────────

export function flushQueues() {
  queue.clear();
  expressQueue.clear();

  for (const [jobId, ctrl] of abortControllers) {
    ctrl.abort();
    updateJob(jobId, { status: 'cancelled', finishedAt: Date.now() });
  }
  abortControllers.clear();

  for (const [jobId, job] of jobs) {
    if (job.status === 'queued') {
      updateJob(jobId, { status: 'cancelled', finishedAt: Date.now() });
    }
  }
}

// ─── Job stats ────────────────────────────────────────────────────────────────

export function getJobStats() {
  const counts = { queued: 0, running: 0, done: 0, error: 0, cancelled: 0 };
  for (const job of jobs.values()) {
    if (job.status in counts) counts[job.status]++;
  }
  return counts;
}

// ─── TTL cleanup — remove finished jobs older than 1 hour ────────────────────
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.finishedAt && job.finishedAt < cutoff) {
      jobs.delete(id);
      abortControllers.delete(id);
    }
  }
}, 60_000);
