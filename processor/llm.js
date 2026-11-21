// ─── Unified LLM interface ───────────────────────────────────────────────────
// Single import point for all LLM operations.
// Routes to the correct backend based on BACKEND env var.
//
// Supported backends:
//   ollama  → Ollama (default)  — http://localhost:11434
//   openai  → OpenAI-compatible — vLLM, LM Studio, llama.cpp, OpenAI API
//
// Usage in server.js:
//   import { streamChat, embedText, listModels, getLoadedModels } from './llm.js';
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
