// ─── Example: Fire multiple requests concurrently ────────────────────────────
// Shows that the processor handles several clients at the same time.
import { processPromptBatch } from '../client.js';

const tasks = [
  {
    label: 'Haiku',
    mode: 'default',
    userPrompt: 'Write a haiku about Raspberry Pi.',
  },
  {
    label: 'SQL',
    mode: 'coder',
    userPrompt: 'Write a SQL query that finds the top 5 customers by total spend in the last 30 days.',
    systemPrompt: 'You are a SQL expert.  Return only SQL, no explanation.',
  },
  {
    label: 'Summary',
    mode: 'thinking',
    userPrompt: 'In 3 bullet points, summarise why edge computing matters for IoT.',
  },
];

console.log(`Firing ${tasks.length} concurrent requests…\n`);

const results = await Promise.allSettled(
  tasks.map((t) =>
    processPromptBatch(t).then((result) => ({ label: t.label, result }))
  )
);

for (const r of results) {
  if (r.status === 'fulfilled') {
    console.log(`\n── ${r.value.label} ──────────────────────────────────`);
    console.log(r.value.result);
  } else {
    console.error(`\n── ERROR ──`, r.reason.message);
  }
}
