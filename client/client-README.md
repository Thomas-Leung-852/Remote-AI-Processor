# Remote AI Client

Lightweight Node.js client library for the Remote AI Processor. Runs on Raspberry Pi 5, NUC, or any device with Node.js 18+.

---

## Installation

```bash
cd client
npm install
cp .env.example .env
# Edit .env — set AI_PROCESSOR_URL and CLIENT_ID at minimum
```

---

## Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `AI_PROCESSOR_URL` | `http://192.168.1.100:3000` | Processor server URL |
| `AI_PROCESSOR_KEY` | _(empty)_ | API key (must match server `API_KEY`) |
| `CLIENT_ID` | _(auto: `rpi-xxxxxx`)_ | Identifies this device in job logs — set a meaningful name |
| `AI_REQUEST_TIMEOUT_MS` | `900000` | 15 min — increase for very long model runs |
| `AI_TEMPERATURE` | `0.1` | Default temperature |
| `AI_TOP_P` | `0.95` | Default top_p |
| `AI_SEED` | `42` | Default seed (reproducible outputs) |

> **Always set `CLIENT_ID`** to a meaningful name (e.g. `rpi-kitchen`, `nuc-study`). Without it, jobs appear in the dashboard as a random `rpi-xxxxxx` ID, making log analysis harder.

---

## API

### `processPrompt(opts)` — streaming

Sends a prompt and streams tokens back as they arrive. Returns the full response text when done.

```js
import { processPrompt } from './client.js';

const result = await processPrompt({
  userPrompt:   'Summarise the following report: ...',
  systemPrompt: 'You are a concise assistant.',  // optional
  mode:         'default',                        // thinking | coder | default
  model:        'llama3.2:3b',                   // optional override
  options:      { temperature: 0.5 },            // optional Ollama/OpenAI params
  onToken: (token) => process.stdout.write(token),  // default: stdout
  onDone:  ({ jobId, elapsed, fullText }) => {
    console.error(`\nDone in ${elapsed}ms (job ${jobId})`);
  },
  onError: (err) => console.error('Error:', err),
});

console.log('Full text:', result);
```

**`mode` values:**

| Mode | Uses model |
|---|---|
| `thinking` | `MODEL_THINKING` (e.g. `deepseek-r1:14b`) — slow, deep reasoning |
| `coder` | `MODEL_CODER` (e.g. `gpt-oss:20b`) — code generation |
| `default` | `MODEL_DEFAULT` (e.g. `llama3.2:3b`) — general purpose, fast |

---

### `processPromptBatch(opts)` — non-streaming

Waits for the full response before returning. Useful when the caller doesn't need tokens incrementally, or when SSE connections drop for very long runs.

```js
import { processPromptBatch } from './client.js';

const result = await processPromptBatch({
  userPrompt:   'List the top 5 storage locations by item count.',
  systemPrompt: 'You are a home inventory analyst.',
  mode:         'thinking',
});

console.log(result);
```

Returns the full response string directly (not `{ jobId, result }` — that's unwrapped for you).

---

### `embedText(opts)` — vector embeddings

Generates embedding vectors for one or more texts. Returns an array of float arrays.

```js
import { embedText } from './client.js';

// Single text
const [vector] = await embedText({ input: 'winter jacket' });
console.log(`Dimension: ${vector.length}`);  // e.g. 768

// Batch
const vectors = await embedText({
  input: ['winter jacket', 'summer shorts', 'rain coat'],
});
// vectors[0], vectors[1], vectors[2]
```

Use cases: semantic search, similarity ranking, clustering, RAG (retrieval-augmented generation).

**Cosine similarity example:**
```js
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const [v1, v2] = await embedText({ input: ['cat', 'kitten'] });
console.log(cosine(v1, v2));  // ~0.92 — very similar
```

---

### `checkHealth(serverUrl?)` — health check

```js
import { checkHealth } from './client.js';

const h = await checkHealth();
console.log(h.status);   // 'ok' | 'degraded'
console.log(h.backend);  // 'ollama' | 'openai'
console.log(h.queues);   // { llm: { waiting, running, total }, express: {...} }
```

---

## npm scripts

Add to `client/package.json` as needed:

```json
{
  "scripts": {
    "embed":  "node ./examples/test-embed.js",
    "health": "node -e \"import('./client.js').then(m => m.checkHealth()).then(h => console.log(JSON.stringify(h,null,2)))\""
  }
}
```

Run:
```bash
npm run embed    # full embed test: single, batch, cosine similarity
npm run health   # print health JSON
```

---

## Example: Housekeeper Bee integration

```js
import { processPromptBatch, embedText } from './client.js';

// Generate a daily storage report
const report = await processPromptBatch({
  userPrompt:   `Today's inventory: ${JSON.stringify(storageData)}. Write a brief summary.`,
  systemPrompt: 'You are a home inventory assistant. Be concise.',
  mode:         'default',
});

// Embed item descriptions for semantic search
const vectors = await embedText({
  input: items.map(i => `${i.name}: ${i.description}`),
});
```

---

## Error handling

All functions throw on network errors or server-side failures:

```js
try {
  const result = await processPromptBatch({ userPrompt: '...' });
} catch (err) {
  if (err.message.includes('Job was cancelled')) {
    // job was aborted (e.g. via dashboard or queue flush)
  } else {
    console.error('AI request failed:', err.message);
  }
}
```

For streaming jobs, disconnection from the server causes the SSE reader to end — `processPrompt` will return whatever text was collected before the disconnect.

---

## Notes on self-signed HTTPS

The client uses `undici` with `rejectUnauthorized: false` — this is intentional for private LAN use with self-signed certificates. If the processor is behind a proper CA-signed cert, remove the `connect` option from the agent in `client.js`.

The extended `headersTimeout` and `bodyTimeout` (15 min) prevent undici from dropping long-running model generations before they finish.
