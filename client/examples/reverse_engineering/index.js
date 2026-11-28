// index.js
// Reverse engineering pipeline — JSX → plain language user prompt
//
// Pipeline passes (configured in config.json):
//   refinePasses: 0 → generate only (fastest)
//   refinePasses: 1 → generate → verify
//   refinePasses: 2 → generate → verify → distil (best quality)
//
// Usage (from another file):
//   import { reverseEngineer } from './index.js';
//   const result = await reverseEngineer(jsxSource);
//   console.log(result.title, result.description, result.prompt);

import { processPromptBatch, JobCancelledError } from '../../client.js';
import { generatePrompt, verifyPrompt, distilPrompt } from './prompts.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf8'));
const cfg = config.reverseEngineer;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getLanguageName = () => {
  return cfg.supportedLanguages[cfg.outputLanguage] || 'English';
};

const parseOutput = (raw) => {
  const title       = raw.match(/TITLE:\s*(.+)/)?.[1]?.trim()       || '';
  const description = raw.match(/DESCRIPTION:\s*(.+)/)?.[1]?.trim() || '';
  const prompt      = raw.match(/PROMPT:\s*([\s\S]+?)(?=\n[A-Z]+:|$)/)?.[1]?.trim() || '';
  return { title, description, prompt };
};

const callModel = async (mode, systemPrompt, userPrompt, label) => {
  console.error(`[pipeline] ${label} — model: ${mode}`);
  const start = Date.now();
  const result = await processPromptBatch({ mode, systemPrompt, userPrompt });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.error(`[pipeline] ${label} done in ${elapsed}s`);
  return result;
};

// ─── Main pipeline ────────────────────────────────────────────────────────────

/**
 * Reverse engineer a JSX report template into a plain language user prompt.
 *
 * @param {string} jsxSource - raw JSX source code
 * @returns {Promise<{ title, description, prompt, passes, language }>}
 */
export async function reverseEngineer(jsxSource) {
  const language = getLanguageName();
  const passes   = cfg.refinePasses;

  console.error(`[pipeline] starting — passes: ${passes}, language: ${language}`);

  // ── Pass 1: Generate ──────────────────────────────────────────────────────
  const raw1 = await callModel(
    cfg.generateModel,
    generatePrompt(language),
    jsxSource,
    'Pass 1 (generate)'
  );
  const v1 = parseOutput(raw1);

  if (passes === 0) {
    return { ...v1, passes: 1, language };
  }

  // ── Pass 2: Verify ────────────────────────────────────────────────────────
  const verifyInput = `TITLE: ${v1.title}\n\nDESCRIPTION: ${v1.description}\n\nPROMPT: ${v1.prompt}`;
  const raw2 = await callModel(
    cfg.verifyModel,
    verifyPrompt(language),
    verifyInput,
    'Pass 2 (verify)'
  );
  const v2 = parseOutput(raw2);

  if (passes === 1) {
    return { ...v2, passes: 2, language };
  }

  // ── Pass 3: Distil ────────────────────────────────────────────────────────
  const distilInput = `VERSION 1:\nTITLE: ${v1.title}\nDESCRIPTION: ${v1.description}\nPROMPT: ${v1.prompt}\n\nVERSION 2:\nTITLE: ${v2.title}\nDESCRIPTION: ${v2.description}\nPROMPT: ${v2.prompt}`;
  const raw3 = await callModel(
    cfg.distilModel,
    distilPrompt(language),
    distilInput,
    'Pass 3 (distil)'
  );
  const v3 = parseOutput(raw3);

  return { ...v3, passes: 3, language };
}
