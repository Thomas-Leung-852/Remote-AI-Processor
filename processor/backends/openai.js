// ─── OpenAI-compatible backend ───────────────────────────────────────────────
// Implements the unified LLM interface for any OpenAI-compatible server:
//   - vLLM          (future NVIDIA GPU)
//   - LM Studio     (http://localhost:1234/v1)
//   - llama.cpp     (http://localhost:8080/v1)
//   - OpenAI API    (https://api.openai.com/v1)
//
// Called only via llm.js — never imported directly by server.js.

import { config } from '../config.js';

function BASE()    { return config.openai.url.replace(/\/+$/, ''); }
function authHeader() {
  return config.openai.apiKey ? { 'Authorization': `Bearer ${config.openai.apiKey}` } : {};
}

/**
 * Stream a chat completion via OpenAI /v1/chat/completions.
 * Handles SSE chunks: data: {...}\n\n  and  data: [DONE]
 */
export async function streamChat({ model, systemPrompt, userPrompt, options = {}, onToken, signal }) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userPrompt });

  // Map Ollama-style options to OpenAI-style params
  const { temperature = 0.7, top_p, seed, max_tokens } = options;
  const openaiParams = {
    temperature,
    ...(top_p     !== undefined ? { top_p }      : {}),
    ...(seed      !== undefined ? { seed }        : {}),
    ...(max_tokens !== undefined ? { max_tokens } : {}),
  };

  const res = await fetch(`${BASE()}/v1/chat/completions`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(),
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      ...openaiParams,
    }),
    signal,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI /v1/chat/completions error ${res.status}: ${err}`);
  }

  let fullText = '';
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete last line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;

      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return fullText;

      let parsed;
      try { parsed = JSON.parse(payload); } catch { continue; }

      const token = parsed?.choices?.[0]?.delta?.content ?? '';
      if (token) { fullText += token; onToken(token); }

      const finishReason = parsed?.choices?.[0]?.finish_reason;
      if (finishReason === 'stop' || finishReason === 'length') return fullText;
    }
  }

  return fullText;
}

/**
 * Generate embeddings via OpenAI /v1/embeddings.
 * Returns array of embedding vectors (same shape as Ollama backend).
 */
export async function embedText({ model, input, signal }) {
  const res = await fetch(`${BASE()}/v1/embeddings`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(),
    },
    body: JSON.stringify({ model, input }),
    signal,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI /v1/embeddings error ${res.status}: ${err}`);
  }

  const data = await res.json();
  // OpenAI returns { data: [{ embedding: [...], index: 0 }] }
  // Normalize to same shape as Ollama: array of vectors
  return (data.data ?? [])
    .sort((a, b) => a.index - b.index)
    .map(d => d.embedding);
}

/**
 * List available models from OpenAI /v1/models.
 */
export async function listModels() {
  const res = await fetch(`${BASE()}/v1/models`, {
    headers: authHeader(),
  });
  if (!res.ok) throw new Error(`OpenAI /v1/models error ${res.status}`);
  const data = await res.json();
  return (data.data ?? []).map(m => m.id);
}

/**
 * Loaded models — not applicable for OpenAI-compatible servers.
 * vLLM and LM Studio manage memory internally; no standard API for this.
 */
export async function getLoadedModels() {
  return [];
}
