# Release Notes — Remote AI Processor
---

## v1.1.0      
2026/11/28

### client 
- Added new example :: prompt inversion (prompt reverse engineering) and LLM chaining to create a report description from JSX source code.

### Processor

- support thinking-small and coder-small AI models (below 12B Q4_K_M)

---

## v1.0.1      
2026/11/23

### dashboard
- Added 'Configured Models' card
- Fixed UI/UX inconsistent and misleading color and message

---

## v1.0.0 — Initial release      
2026/11/21

### Processor server (`server.js` · Express · Node.js 22+)

- `POST /api/v1/process` — streaming via SSE.
- `POST /api/v1/process/batch` — full response, non-streaming.
- `POST /api/v1/embed` — text embeddings via dedicated Express queue.
- `GET /api/v1/health` — server status, queue counts, loaded models, memory.
- `GET /api/v1/jobs` — paginated job history with filters.
- `GET /api/v1/jobs/stats` — aggregate stats by time window.
- `GET /api/v1/jobs/analytics` — per-client call counts broken down by mode.
- `DELETE /api/v1/job/:id` — cancel a single job.
- `POST /api/v1/queue/flush` — cancel all jobs and clear queues.

### Queues (`p-queue`)

- LLM queue: handles `/process` and `/process/batch`, configurable concurrency.
- Express queue: handles `/embed` only, never blocked by slow LLM jobs.
- Per-job `AbortController` — cancel any running job on demand.
- Auto-abort on client disconnect (SSE and batch routes).
- Auto-abort after `JOB_TIMEOUT_MS` timeout (default 10 min).
- Stale `queued` / `running` jobs marked `cancelled` automatically on server restart.

### Backend abstraction (`llm.js`)

- Supports Ollama (default) and any OpenAI-compatible server (vLLM, LM Studio).
- Switch with `BACKEND=` in `.env` — zero code change.
- Mode routing: `thinking` / `coder` / `default` / `embed` each map to a configurable model.

### SQLite job log (`db.js` · `better-sqlite3`)

- WAL mode, prepared statements.
- Stores client ID, mode, model, status, elapsed time, prompt preview, error.
- Auto-purge after `LOG_RETENTION_DAYS` (default 30 days).

### React dashboard (Vite + React)

- Queue panel, job stats, memory usage, loaded models.
- Live job history table with status filter, per-job abort, CSV/JSON export.
- Click any job row to open a detail modal — shows full prompt preview, timestamps, error.
- Usage Analytics panel — syncs with status tab filter in real time.
  - Chart 1: total requests per client, stacked by mode.
  - Chart 2: mode mix per client as 100% stacked bar.
  - Full History modal — all-time data with year filter.
- Flush All Queues button.
- 3-second polling; served as static files from `/public`.

### Client library (`client.js`)

- `processPrompt()` — streams tokens via SSE.
- `processPromptBatch()` — waits for the full response (non-streaming).
- `embedText()` — generates text embeddings (single or batch input).
- `checkHealth()` — checks server health and loaded models.
- `JobCancelledError` — named error class for cancelled jobs, distinct from real errors.
- Configured via `.env`: `AI_PROCESSOR_URL`, `AI_PROCESSOR_KEY`, `CLIENT_ID`.
- ESM native; CommonJS apps rename to `.mjs` and use `await import()`.

### Infrastructure

- **Structured logger** (`logger.js`) — pretty (dev) or JSON (production), zero external dependencies.
- **HTTPS** — self-signed TLS for secure LAN use.
- **Auth** — optional shared `API_KEY` via `x-api-key` header.
- **CORS** — enabled for all origins (home network use).
- **Config** (`config.js`) — all settings from `.env`, single source of truth.
