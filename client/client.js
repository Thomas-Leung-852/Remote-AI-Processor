// ─── Remote AI Client ────────────────────────────────────────────────────────
// Lightweight sender for Raspberry Pi 5 (or any Node.js device).
// Streams tokens from the processor server as they arrive.

import dotenv from 'dotenv';
import { fetch, Agent } from 'undici';
dotenv.config();

/**
 * Thrown when a job is cancelled (via DELETE /job/:id or POST /queue/flush).
 * Catch this separately from real errors:
 *
 *   try {
 *     const result = await processPromptBatch({ ... });
 *   } catch (err) {
 *     if (err instanceof JobCancelledError) { console.log('cancelled'); return; }
 *     throw err;  // real error
 *   }
 */
export class JobCancelledError extends Error {
  constructor(jobId) {
    super('Job was cancelled');
    this.name = 'JobCancelledError';
    this.jobId = jobId ?? null;
  }
}

const DEFAULT_SERVER  = process.env.AI_PROCESSOR_URL || 'http://192.168.1.100:3000';
const DEFAULT_API_KEY = process.env.AI_PROCESSOR_KEY || '';
const CLIENT_ID       = process.env.CLIENT_ID        || `rpi-${Math.random().toString(36).slice(2, 8)}`;
const REQUEST_TIMEOUT = parseInt(process.env.AI_REQUEST_TIMEOUT_MS ?? '900000', 10); // 15 min

// ─── undici agent — extends headersTimeout so long model runs don't disconnect
// connect.rejectUnauthorized: false — required for self-signed HTTPS certificates.
// Safe for private LAN use; remove only if using a trusted CA-signed cert.
const agent = new Agent({
  headersTimeout: REQUEST_TIMEOUT,
  bodyTimeout:    REQUEST_TIMEOUT,
  connect: { rejectUnauthorized: false },
});

// ─── AI generation defaults (overridable via .env) ───────────────────────────
const DEFAULT_OPTIONS = {
  temperature: parseFloat(process.env.AI_TEMPERATURE ?? '0.1'),
  top_p:       parseFloat(process.env.AI_TOP_P       ?? '0.95'),
  seed:        parseInt(process.env.AI_SEED          ?? '42', 10),
};

/**
 * Send a prompt to the remote processor and stream tokens back.
 *
 * @param {object} opts
 * @param {string}   opts.userPrompt
 * @param {string}   [opts.systemPrompt]
 * @param {'thinking'|'coder'|'default'} [opts.mode]
 * @param {string}   [opts.model]        - override model name
 * @param {object}   [opts.options]      - Ollama params
 * @param {string}   [opts.serverUrl]    - override server URL
 * @param {Function} [opts.onToken]      - called with each token (default: stdout)
 * @param {Function} [opts.onDone]       - called with { jobId, elapsed, fullText }
 * @param {Function} [opts.onError]      - called with error string
 * @returns {Promise<string>}            - full response text
 */
export async function processPrompt({
  userPrompt,
  systemPrompt = '',
  mode = 'default',
  model,
  options = {},
  serverUrl = DEFAULT_SERVER,
  onToken = (t) => process.stdout.write(t),
  onDone,
  onError,
}) {
  const url = `${serverUrl}/api/v1/process`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Client-Id':  CLIENT_ID,
    ...(DEFAULT_API_KEY ? { 'x-api-key': DEFAULT_API_KEY } : {}),
  };

  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  const body = JSON.stringify({ mode, userPrompt, systemPrompt, model, options: mergedOptions });

  const res = await fetch(url, { method: 'POST', headers, body, dispatcher: agent });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Server error ${res.status}: ${err}`);
  }

  let fullText = '';
  const decoder = new TextDecoder();
  let buffer = '';

  // Use getReader() explicitly — avoids ERR_INVALID_STATE "ReadableStream is locked"
  // that occurs when undici's fetch response body is iterated with for-await directly.
  const reader = res.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete last line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let event;
        try { event = JSON.parse(line.slice(6)); } catch { continue; }

        switch (event.type) {
          case 'queued':
            console.error(`[client] queued as job ${event.jobId} (position ${event.position})`);
            break;
          case 'start':
            console.error(`[client] processing started — model: ${event.model}, mode: ${event.mode}`);
            break;
          case 'token':
            fullText += event.token;
            onToken(event.token);
            break;
          case 'done':
            if (onDone) onDone({ jobId: event.jobId, elapsed: event.elapsed, fullText });
            return fullText;
          case 'cancelled':
            throw new JobCancelledError(event.jobId);
          case 'error':
            if (onError) onError(event.error);
            throw new Error(event.error);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return fullText;
}

/**
 * Non-streaming batch call.  Waits for the full response.
 * Use this for slow models (gpt-oss:20b, deepseek-r1) to avoid SSE connection drops.
 */
export async function processPromptBatch({
  userPrompt,
  systemPrompt = '',
  mode = 'default',
  model,
  options = {},
  serverUrl = DEFAULT_SERVER,
}) {
  const url = `${serverUrl}/api/v1/process/batch`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Client-Id':  CLIENT_ID,
    ...(DEFAULT_API_KEY ? { 'x-api-key': DEFAULT_API_KEY } : {}),
  };

  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ mode, userPrompt, systemPrompt, model, options: mergedOptions }),
    dispatcher: agent,
  });

  const data = await res.json();
  if (!res.ok) {
    // Cancelled is not a crash — let the caller decide what to do.
    if (res.status === 409 || (data.error ?? '').toLowerCase().includes('cancel')) {
      throw new JobCancelledError(data.jobId);
    }
    throw new Error(data.error ?? `Server error ${res.status}`);
  }
  return data.result;
}

/**
 * Generate embeddings for text.
 *
 * @param {object} opts
 * @param {string|string[]} opts.input   - text or array of texts to embed
 * @param {string}  [opts.model]         - override embedding model
 * @param {string}  [opts.serverUrl]
 * @returns {Promise<number[][]>}        - array of embedding vectors
 */
export async function embedText({
  input,
  model,
  serverUrl = DEFAULT_SERVER,
}) {
  const url = `${serverUrl}/api/v1/embed`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Client-Id':  CLIENT_ID,
    ...(DEFAULT_API_KEY ? { 'x-api-key': DEFAULT_API_KEY } : {}),
  };

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ input, ...(model ? { model } : {}) }),
    dispatcher: agent,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
  return data.embeddings;
}

/**
 * Check server health and available models.
 */
export async function checkHealth(serverUrl = DEFAULT_SERVER) {
  const res = await fetch(`${serverUrl}/api/v1/health`, { dispatcher: agent });
  return res.json();
}
