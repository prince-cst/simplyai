# Universal MongoDB AI Assistant

Connect **any** MongoDB database, automatically inspect its structure, ask natural-language questions, and get answers from **actual query results** — not invented numbers.

This is a generic tool. It is not built for a specific domain (shop, hospital, HR, ecommerce). Collections, fields, and calculations are discovered at runtime from the database you connect.

```text
MongoDB connection
      ↓
Schema introspection (sampled)
      ↓
AI query planning (structured JSON)
      ↓
Safety validation (read-only)
      ↓
MongoDB read operation
      ↓
AI explanation of the real result
```

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│  React + Vite client  (http://localhost:5173)               │
│  Chat · Explorer · Schema · Settings · Test Center          │
└──────────────────────────────┬──────────────────────────────┘
                               │ /api  (proxied)
┌──────────────────────────────▼──────────────────────────────┐
│  Express + TypeScript API  (http://localhost:4000)          │
│                                                             │
│  AIProvider  ── OllamaProvider | GeminiProvider | GroqProvider
│  MongoConnectionManager (session memory, never logged)      │
│  Introspection → Schema inference → Query validator         │
│  Query execution (find / aggregate / count / distinct)      │
└──────────────────────────────┬──────────────────────────────┘
                               │
                    MongoDB (local or Atlas)
```

The rest of the app talks only to `AIProvider`. Gemini, Groq, and Ollama are never called from random files.

## Requirements

- Node.js 20+
- npm 10+
- Optional: [MongoDB](https://www.mongodb.com/) locally or Atlas
- Optional: [Ollama](https://ollama.com/) for local models
- Optional: Google Gemini API key and/or Groq API key

The app **starts without MongoDB**. Until you connect, it shows demo mode. It does **not** pretend to be connected.

## Installation

```bash
npm install
cp server/.env.example server/.env
cp client/.env.example client/.env
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173).

| Process | URL |
| --- | --- |
| Frontend (Vite) | http://localhost:5173 |
| Backend API | http://localhost:4000 |
| Health | http://localhost:4000/api/health |

Production-style run after build:

```bash
npm run build
npm start
```

`npm start` serves the API. If `client/dist` exists, the API also serves the UI.

## Environment variables

Client and server each have their own env file:

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

### Server (`server/.env`)

All keys are optional except what your chosen provider needs.

```env
PORT=4000
APP_TIMEZONE=Asia/Kolkata
DEFAULT_AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
GROQ_API_KEY=
GROQ_MODEL=llama-3.3-70b-versatile
MAX_RESULT_DOCUMENTS=100
MAX_SAMPLE_DOCUMENTS=10
MAX_PIPELINE_STAGES=30
QUERY_TIMEOUT_MS=15000
MONGODB_URI=mongodb://127.0.0.1:27017
TEST_DATABASE_NAME=test_shop_db
```

Also supports QuickBooks, Microsoft Outlook, and SMTP keys — see `server/.env.example`.

**UI settings override environment values** for the running process (model, base URL, keys, limits, timezone).

### Client (`client/.env`)

```env
VITE_DEV_PORT=5173
VITE_API_PROXY_TARGET=http://localhost:4000
```
## Ollama

1. Install Ollama from [https://ollama.com](https://ollama.com)
2. Start it (default `http://localhost:11434`)
3. Pull a model, for example:

```bash
ollama pull qwen3
```

4. In **Settings**, select Ollama, set base URL and model, then **Test Connection** / **Fetch Models**.

If Ollama is down, the UI shows:

```text
Cannot connect to Ollama.

Make sure Ollama is installed and running.

Expected:
http://localhost:11434
```

No API key is required for Ollama.

## Google Gemini

1. Create an API key in Google AI Studio
2. Open **Settings → Google Gemini**
3. Paste the key (stored **server-side only**, never returned to the browser after save)
4. Set a model (default `gemini-2.5-flash`)
5. Click **Test Gemini** — this performs a real API request

Uses the official `@google/genai` SDK.

## Groq

1. Create an API key at [https://console.groq.com](https://console.groq.com)
2. Open **Settings → Groq**
3. Paste the key (server-side only)
4. Set a model (default `llama-3.3-70b-versatile`)
5. Click **Test Groq**

## MongoDB setup

Any connection string works:

```text
mongodb://127.0.0.1:27017/mydb
mongodb+srv://user:password@cluster.mongodb.net/mydb
```

If the URI has no database name, the UI lists user databases (system DBs `admin` / `local` / `config` are hidden unless you request them).

The raw connection string:

- is kept in **server session memory**
- is **never** sent to Ollama / Gemini / Groq
- is **never** written to `localStorage`
- is **never** logged
- is shown masked: `mongodb+srv://user:********@host/db`

## Test database

```bash
npm run seed:test
```

Creates `test_shop_db` with `shops`, `products`, `customers`, and `orders` (about 90 days of orders). Then connect with:

```text
mongodb://127.0.0.1:27017/test_shop_db
```

Example questions (field names come from this seed; other databases will differ):

```text
How much revenue was generated this month?
Which product made the most profit?
Compare this month with last month.
Which shop performed best?
```

Revenue/profit formulas are **not hard-coded**. The planner must infer them from fields such as `quantity`, `sellingPrice`, and `purchasePrice`.

## Usage

1. Open http://localhost:5173
2. Go to **Settings** and choose Ollama, Gemini, or Groq
3. Test the provider
4. Enter a MongoDB connection string and **Save & connect**. It is stored in this project’s local store (`server/data/app-store.json`) so it survives API restarts.
5. Add more databases the same way, or pick another database on the same server from the Database page.
6. Inspect **Collections** and **Schema**
7. Open **Chat**, choose the database in **Chat with database**, and ask a question
8. Expand **MongoDB Query** to see the read-only operation
9. Open **Query History** and click **Continue chat** on a previous question to restore that database’s thread
10. **Disconnect** closes the live client but keeps saved databases. **Remove** forgets a saved URI.

## Query safety

The application is **read-only**. Allowed operations: `find`, `aggregate`, `count`, `distinct`.

Rejected: insert/update/delete/drop, `$where`, `$function`, `$out`, `$merge`, unknown collections, oversized pipelines, and similar.

Optional **Require query approval** reviews the plan before execution. Validation always runs.

Dates such as “this month” are resolved on the backend in `APP_TIMEZONE` (default `Asia/Kolkata`) using UTC bounds — not by trusting the model’s arithmetic.

## Security

- No `eval`, `Function`, or shell execution of model output
- Only validated MongoDB JSON operations
- Result size and query timeouts are capped
- API keys and MongoDB passwords are not returned from the API
- Saved connection strings and AI settings live in `server/data/app-store.json` (gitignored, never sent to the model)
- Structured logs include request id, provider, model, collection, operation, timing, result count — not secrets

This is a **local developer tool**. There is no user authentication layer.

## Scripts

```bash
npm run dev          # API + Vite together
npm run build
npm start
npm run lint
npm test             # unit tests
npm run test:e2e     # connection → introspect → plan → validate → execute → explain
npm run seed:test
```

## Troubleshooting

**Unable to connect to MongoDB**

Check connection string, username/password, network access, Atlas IP whitelist, and database name.

**AI provider unavailable**

Check provider, API key, model name, and whether Ollama is running.

**Query rejected**

The planner produced something the safety validator blocked. Enable Developer Mode to inspect the plan, or rephrase the question.

**Insufficient data**

The schema has no reliable field/collection for that question. The app prefers this over guessing.

**Gemini / Groq live tests**

Providers are fully implemented. Live tests require your API key in Settings (or `server/.env`).

## Project layout

```text
server/src/
  config/            env + runtime settings (UI overrides env)
  services/ai/       AIProvider + Ollama/Gemini/Groq factory
  services/mongodb/  connection, introspection, inference, validator, executor
  services/chat/     planner, explainer, two-stage pipeline
  prompts/           query planner + result explanation
client/src/
  pages/ components/ hooks/  dashboard UI
```

## License

Use and modify freely for internal/developer tooling.
