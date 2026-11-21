// ─── Embedding endpoint tester ───────────────────────────────────────────────
// Tests GET /api/v1/embed via the client library.
//
// What it covers:
//   1. Single-text embedding (dimension check)
//   2. Batch embedding  (array of texts)
//   3. Cosine similarity between two related vs two unrelated texts
//      — a working embed model should score related pairs higher
//
// Usage:
//   node test-embed.js
//   AI_PROCESSOR_URL=https://192.168.1.100:3000 node test-embed.js

import { embedText, checkHealth } from '../client.js';

// ─── Cosine similarity ────────────────────────────────────────────────────────

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pass(msg)  { console.log(`  ✅  ${msg}`); }
function fail(msg)  { console.error(`  ❌  ${msg}`); }
function info(msg)  { console.log(`  ℹ️   ${msg}`); }
function sep()      { console.log(''); }

// ─── Tests ────────────────────────────────────────────────────────────────────

async function testHealth() {
  console.log('── Health check ─────────────────────────────────────────────────');
  const h = await checkHealth();
  info(`status:  ${h.status}`);
  info(`backend: ${h.backend}`);
  if (h.status !== 'ok' && h.status !== 'degraded') {
    throw new Error(`Processor not healthy: ${h.status}`);
  }
  pass('processor is reachable');
  sep();
}

async function testSingleEmbed() {
  console.log('── Test 1: single text embedding ────────────────────────────────');
  const text   = 'The quick brown fox jumps over the lazy dog.';
  info(`input: "${text}"`);

  const result = await embedText({ input: text });

  if (!Array.isArray(result))             throw new Error('result is not an array');
  if (result.length !== 1)                throw new Error(`expected 1 embedding, got ${result.length}`);
  if (!Array.isArray(result[0]))          throw new Error('embedding[0] is not an array');
  if (result[0].length === 0)             throw new Error('embedding vector is empty');
  if (typeof result[0][0] !== 'number')   throw new Error('embedding values are not numbers');

  pass(`embedding returned: dimension = ${result[0].length}`);
  info(`first 5 values: [${result[0].slice(0, 5).map(v => v.toFixed(4)).join(', ')}]`);
  sep();
}

async function testBatchEmbed() {
  console.log('── Test 2: batch embedding (array of texts) ─────────────────────');
  const texts = [
    'Node.js is a JavaScript runtime.',
    'Python is used for data science.',
    'The sky is blue.',
  ];
  texts.forEach((t, i) => info(`input[${i}]: "${t}"`));

  const result = await embedText({ input: texts });

  if (!Array.isArray(result))               throw new Error('result is not an array');
  if (result.length !== texts.length)       throw new Error(`expected ${texts.length} embeddings, got ${result.length}`);
  result.forEach((vec, i) => {
    if (!Array.isArray(vec) || vec.length === 0) throw new Error(`embedding[${i}] is empty`);
  });

  pass(`batch returned: ${result.length} embeddings, dimension = ${result[0].length}`);
  sep();
}

async function testSimilarity() {
  console.log('── Test 3: cosine similarity (sanity check) ─────────────────────');

  const pairs = [
    {
      a: 'How do I cook pasta?',
      b: 'What is the best way to boil spaghetti?',
      label: 'related  (cooking)',
      expectHigh: true,
    },
    {
      a: 'How do I cook pasta?',
      b: 'The interest rate was raised by the central bank.',
      label: 'unrelated (cooking vs finance)',
      expectHigh: false,
    },
  ];

  const scores = [];
  for (const { a, b, label } of pairs) {
    const [va, vb] = await Promise.all([
      embedText({ input: a }).then(r => r[0]),
      embedText({ input: b }).then(r => r[0]),
    ]);
    const score = cosine(va, vb);
    scores.push({ label, score });
    info(`${label}: similarity = ${score.toFixed(4)}`);
  }

  const relatedScore   = scores.find(s => s.label.startsWith('related')).score;
  const unrelatedScore = scores.find(s => s.label.startsWith('unrelated')).score;

  if (relatedScore > unrelatedScore) {
    pass(`related pair scored higher (${relatedScore.toFixed(4)} > ${unrelatedScore.toFixed(4)}) — model is working`);
  } else {
    fail(`related pair did NOT score higher — check your embed model`);
    fail(`  related: ${relatedScore.toFixed(4)}, unrelated: ${unrelatedScore.toFixed(4)}`);
  }
  sep();
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🧪  Embedding endpoint test\n');

  let passed = 0;
  let failed = 0;

  const run = async (name, fn) => {
    try {
      await fn();
      passed++;
    } catch (err) {
      fail(`${name} threw: ${err.message}`);
      failed++;
      sep();
    }
  };

  await run('health',       testHealth);
  await run('single embed', testSingleEmbed);
  await run('batch embed',  testBatchEmbed);
  await run('similarity',   testSimilarity);

  console.log(`── Result ───────────────────────────────────────────────────────────`);
  console.log(`   ${passed} passed  /  ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
