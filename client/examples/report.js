// ─── Example: Generate a structured report (thinking mode) ──────────────────
import { processPrompt } from '../client.js';

// ── Schema the client sends as part of the system prompt ─────────────────────
const DATA_SCHEMA = `
You are a data analyst.  The input data follows this JSON schema:

{
  "sales": [
    { "date": "YYYY-MM-DD", "product": "string", "region": "string", "amount": number }
  ]
}

Always return a Markdown report with:
1. Executive summary
2. Top 3 products by revenue
3. Regional breakdown table
4. Trend analysis
5. Recommendations
`;

// ── Sample data the RPi might collect from a sensor / local DB ───────────────
const salesData = {
  sales: [
    { date: '2024-11-01', product: 'Widget A', region: 'HK',    amount: 4200 },
    { date: '2024-11-02', product: 'Widget B', region: 'SG',    amount: 3100 },
    { date: '2024-11-03', product: 'Widget A', region: 'TW',    amount: 2800 },
    { date: '2024-11-04', product: 'Gadget X', region: 'HK',    amount: 6700 },
    { date: '2024-11-05', product: 'Widget B', region: 'TW',    amount: 1900 },
    { date: '2024-11-06', product: 'Gadget X', region: 'SG',    amount: 5400 },
    { date: '2024-11-07', product: 'Widget A', region: 'HK',    amount: 3300 },
  ],
};

const userPrompt = `
Please analyse the following sales data and generate a full report.

\`\`\`json
${JSON.stringify(salesData, null, 2)}
\`\`\`
`;

console.log('Sending report request to processor...\n');
console.log('─'.repeat(60));

await processPrompt({
  mode: 'thinking',
  systemPrompt: DATA_SCHEMA,
  userPrompt,
  onToken: (t) => process.stdout.write(t),
  onDone: ({ elapsed }) => {
    console.log('\n' + '─'.repeat(60));
    console.log(`\n✅  Done in ${(elapsed / 1000).toFixed(1)}s`);
  },
});
