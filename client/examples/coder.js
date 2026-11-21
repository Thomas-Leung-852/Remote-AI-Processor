// ─── Example: Code generation (coder mode) ───────────────────────────────────
// Uses processPromptBatch (not streaming) — avoids SSE connection drops on
// slow models like gpt-oss:20b that take >30s to respond.
import { processPromptBatch, JobCancelledError } from '../client.js';

const CODER_SYSTEM = `
You are an expert Node.js developer.
- Write clean, production-ready code with comments.
- Always use CommonJS module syntax. Never use ES6 module syntax.
- WRONG: import fs from 'fs';   RIGHT: const fs = require('fs');
- WRONG: export default fn;     RIGHT: module.exports = fn;
- Include error handling and input validation.
- Output only code blocks with brief inline comments.
`;

const userPrompt = `
Write a Node.js function that:
1. Reads a CSV file of sensor readings (columns: timestamp, sensor_id, temperature, humidity)
2. Calculates per-sensor min/max/average for temperature and humidity
3. Returns a JSON summary object
4. Handles malformed rows gracefully
`;

console.log('Sending code-generation request (coder mode)...\n');
console.log('─'.repeat(60));
console.log('⏳  Waiting for full response (batch mode — no streaming)...\n');

const start = Date.now();

try {
  const code = await processPromptBatch({
    mode: 'coder',
    systemPrompt: CODER_SYSTEM,
    userPrompt,
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(code);
  console.log('\n' + '─'.repeat(60));
  console.log(`\n✅  Done in ${elapsed}s`);

} catch (err) {
  if (err instanceof JobCancelledError) {
    console.log(`\n⚠️  Job was cancelled (jobId: ${err.jobId ?? 'unknown'})`);
  } else {
    console.error(`\n❌  Error: ${err.message}`);
    process.exit(1);
  }
}
