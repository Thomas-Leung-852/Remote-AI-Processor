// ─── Unified LLM interface ───────────────────────────────────────────────────
// Single import point for all LLM operations.
// Routes to the correct backend based on BACKEND env var.
//
// Supported backends:
//   ollama  → Ollama (default)  — http://localhost:11434
//   openai  → OpenAI-compatible — vLLM, LM Studio, llama.cpp, OpenAI API
//
// Usage in server.js:
//   import { streamChat, embedText, listModels, getLoadedModels, selectModel } from './llm.js';
//
// To switch backend: set BACKEND=openai in processor/.env

import { config } from './config.js';

// ─── Load backend at startup ──────────────────────────────────────────────────
const SUPPORTED = ['ollama', 'openai'];

if (!SUPPORTED.includes(config.backend)) {
  console.error(`\n❌  Unknown BACKEND="${config.backend}". Supported: ${SUPPORTED.join(', ')}\n`);
  process.exit(1);
}

let backend;
if (config.backend === 'openai') {
  backend = await import('./backends/openai.js');
} else {
  backend = await import('./backends/ollama.js');
}

console.log(`[llm] backend: ${config.backend}`);

// ─── Mode → model resolver ────────────────────────────────────────────────────
/**
 * Map a request mode string to the configured model name.
 * Add new modes here — server.js never needs to change.
 *
 * @param {string} mode  — e.g. 'thinking' | 'thinking-small' | 'coder' | 'coder-small' | 'default'
 * @returns {string}     — model name, e.g. 'deepseek-r1:7b'
 */
export function selectModel(mode) {
  const m = config.models;
  switch (mode) {
    case 'thinking':       return m.thinking;
    case 'thinking-small': return m.thinkingSmall;
    case 'coder':          return m.coder;
    case 'coder-small':    return m.coderSmall;
    case 'embed':          return m.embed;
    default:               return m.default;
  }
}

// ─── Unified exports ──────────────────────────────────────────────────────────

/**
 * Stream a chat completion.
 * @param {object} opts
 * @param {string}   opts.model
 * @param {string}   [opts.systemPrompt]
 * @param {string}   opts.userPrompt
 * @param {object}   [opts.options]       - model params (temperature, top_p, seed)
 * @param {Function} opts.onToken         - called with each text token
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<string>}             - full response text
 */
export function streamChat(opts) {
  return backend.streamChat(opts);
}

/**
 * Generate text embeddings.
 * @param {object} opts
 * @param {string}        opts.model
 * @param {string|string[]} opts.input
 * @param {AbortSignal}   [opts.signal]
 * @returns {Promise<number[][]>}  - array of embedding vectors
 */
export function embedText(opts) {
  return backend.embedText(opts);
}

/**
 * List all available models on the backend server.
 * @returns {Promise<string[]>}
 */
export function listModels() {
  return backend.listModels();
}

/**
 * Get currently loaded models with memory usage.
 * Returns [] for OpenAI-compatible backends (not standardised).
 * @returns {Promise<Array<{name, size, sizeVram, expiresAt}>>}
 */
export function getLoadedModels() {
  return backend.getLoadedModels();
}

/**
 * Which backend is active.
 * Useful for health endpoint and logging.
 */
export const activeBackend = config.backend;
