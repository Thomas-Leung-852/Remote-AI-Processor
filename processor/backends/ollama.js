// ─── Ollama backend ──────────────────────────────────────────────────────────
// Implements the unified LLM interface for Ollama (http://localhost:11434).
// Called only via llm.js — never imported directly by server.js.

import { config } from '../config.js';

const BASE = () => config.ollama.url;

/**
 * Stream a chat completion from Ollama /api/chat.
 * Calls onToken(token) for each streamed chunk.
 */
export async function streamChat({ model, systemPrompt, userPrompt, options = {}, onToken, signal }) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userPrompt });

  const res = await fetch(`${BASE()}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      model,
      messages,
      stream:  true,
      options: { temperature: 0.7, num_ctx: 8192, ...options },
    }),
    signal,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama /api/chat error ${res.status}: ${err}`);
  }

  let fullText = '';
  const decoder = new TextDecoder();

  for await (const chunk of res.body) {
    const lines = decoder.decode(chunk, { stream: true }).split('\n').filter(Boolean);
    for (const line of lines) {
      let parsed;
      try { parsed = JSON.parse(line); } catch { continue; }

      const token = parsed?.message?.content ?? '';
      if (token) { fullText += token; onToken(token); }
      if (parsed?.done) break;
    }
  }

  return fullText;
}

/**
 * Generate embeddings via Ollama /api/embed.
 * Returns array of embedding vectors.
 */
export async function embedText({ model, input, signal }) {
  const res = await fetch(`${BASE()}/api/embed`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ model, input }),
    signal,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama /api/embed error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.embeddings ?? [];
}

/**
 * List all available models from Ollama /api/tags.
 */
export async function listModels() {
  const res = await fetch(`${BASE()}/api/tags`);
  if (!res.ok) throw new Error(`Ollama /api/tags error ${res.status}`);
  const data = await res.json();
  return (data.models ?? []).map(m => m.name);
}

/**
 * Get currently loaded models from Ollama /api/ps.
 * Returns name, size, sizeVram, expiresAt per model.
 */
export async function getLoadedModels() {
  try {
    const res = await fetch(`${BASE()}/api/ps`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models ?? []).map(m => ({
      name:      m.name,
      size:      m.size      ?? 0,
      sizeVram:  m.size_vram ?? 0,
      expiresAt: m.expires_at ?? null,
    }));
  } catch {
    return [];
  }
}
