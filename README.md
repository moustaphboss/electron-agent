# Mustipix

An Electron desktop app with an AI agent that can answer questions about your
local photo library — real EXIF data, real files, real tool calls. Ask it to
find photos by location, camera settings, or date, get a natural-language
answer with actual thumbnails inline, and click any photo to expand it.

The agent's tool access is powered by the **Model Context Protocol (MCP)**:
a standalone MCP server exposes 3 tools backed by a SQLite database seeded
from real photo EXIF metadata, and the Electron app connects to it as an
MCP client. The agent loop that drives the conversation is implemented
**two ways** — a hand-rolled loop written directly against the Anthropic
Messages API, and an equivalent built with LangGraph — toggleable live in
the UI, so you can compare a from-scratch implementation against the
ecosystem's standard tooling.

## Features

- **3 MCP tools**, each with a real, non-trivial Zod schema:
  - `search_photos` — filter by country (enum), city, exposure range
    (aperture/ISO), date range
  - `get_photo_details` — fetch full metadata for one photo by id
  - `suggest_photo_locations` — given a folder of unsorted photos, suggest
    which trip each belongs to by matching capture date against known trip
    date ranges
- **Two agent implementations**, switchable per-message in the UI:
  - a hand-rolled plan → execute → observe loop against the raw Anthropic
    Messages API
  - a LangGraph `createReactAgent`, using the official
    `@langchain/mcp-adapters` package to consume the same MCP tools
- **Chat UI** with conversation history (click a past chat to view it
  read-only), an Extensions panel showing live-connected MCP servers and
  their tools, and inline photo thumbnails that expand into a lightbox on
  click
- **Structured observability**: every tool call is logged as JSON to
  stderr, correlated by the protocol's own request id, with an optional
  cross-call trace id so a multi-tool-call agent turn threads together as
  one trace
- **Real failure handling**, not just happy-path demos: clean error
  messages instead of leaked internals when a tool fails, graceful
  handling of Anthropic API overload/rate-limit errors, and a safety
  cutoff on the agent loop's turn count

## Architecture

```
Electron renderer (React)
      │  IPC (contextBridge)
      ▼
Electron main process
      │  spawns as child process, connects as MCP client
      ▼
mcp-server (standalone Node process, stdio transport)
      │
      ▼
SQLite (seeded from real photo EXIF data)
```

The Electron main process holds both the MCP client connection and the
Anthropic API client. When you ask a question, main process either runs
the hand-rolled loop or the LangGraph agent (your choice), which calls
back into the MCP server's tools as needed, then returns the final answer
— plus any photo file paths pulled deterministically out of the tool
results — to the renderer over IPC. Local images are served to the
renderer through a custom `photo-file://` protocol handler rather than by
disabling Electron's `webSecurity`.

## Project structure

```
mcp-server/           standalone MCP server (own package.json)
  src/db.ts             SQLite schema
  src/seed.ts           walks a photo folder, extracts EXIF, seeds the DB
  src/exif.ts           shared EXIF-extraction logic
  src/index.ts           the 3 tools + stdio transport + structured logging

src/main/              Electron main process
  main.ts                app lifecycle, IPC handlers, photo-file:// protocol
  mcpClient.ts            connects to mcp-server as an MCP client
  agentLoop.ts             hand-rolled Anthropic tool-use loop
  langGraphAgentLoop.ts    LangGraph equivalent
  extractImages.ts          deterministic photo-path extraction from tool results

src/preload/            contextBridge — the only surface the renderer can call
src/renderer/            React UI
```

## Getting started

**Prerequisites**: Node 24+, an [Anthropic API key](https://console.anthropic.com), and a folder of real photos with EXIF data.

1. **Install dependencies** (two separate packages — the MCP server is
   standalone on purpose, see below):

   ```
   npm install
   cd mcp-server && npm install && cd ..
   ```

2. **Point the seed script at your photo library.** `mcp-server/src/seed.ts`
   has a `PHOTOS_ROOT` constant currently pointing at a personal folder —
   change it to your own photo directory before seeding. The seed script
   expects trip folders named by country (e.g. `Switzerland/`, with
   optional city subfolders like `Germany/Frankfurt/`).

3. **Seed the database**:

   ```
   cd mcp-server && npm run seed && cd ..
   ```

4. **Add your API key** — create a `.env` file at the repo root:

   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```

   Optionally, add LangSmith tracing for the LangGraph agent mode (get a key
   from [smith.langchain.com](https://smith.langchain.com/) → Settings → API
   Keys). This auto-instruments every LLM and tool call — no code changes —
   and is visible under the `mustipix` project on your LangSmith dashboard:

   ```
   LANGSMITH_TRACING=true
   LANGSMITH_API_KEY=lsv2_...
   LANGSMITH_PROJECT=mustipix
   ```

5. **Build the MCP server** (the Electron app spawns the compiled output,
   not the TypeScript source):

   ```
   cd mcp-server && npm run build && cd ..
   ```

6. **Run the app**:
   ```
   npm run dev
   ```

## Testing the MCP server standalone

Before wiring it into Electron, the server can be driven directly with the
[MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```
cd mcp-server && npx @modelcontextprotocol/inspector node dist/index.js
```

## Evaluating agent behavior

`eval/` is a standalone harness that runs a set of representative queries
against the real MCP server and asserts the model picked the right tool
with roughly the right arguments — including a regression guard for a bug
where an exploratory tool call's results used to leak into the final
answer's photos. See `eval/README.md` for why it's a separate package.

```
cd eval && npm install && npm run eval
```

## Tech stack

Electron · React · TypeScript · Tailwind CSS · electron-vite · Model
Context Protocol SDK · better-sqlite3 · Zod · Anthropic SDK · LangGraph ·
LangChain MCP adapters · Prettier

## Known limitations

- `PHOTOS_ROOT` in `mcp-server/src/seed.ts` is a hardcoded local path, not
  a configurable setting — this is a personal demo project, not a
  general-purpose tool.
- City detection uses a hardcoded allowlist (`KNOWN_CITIES` in `seed.ts`)
  rather than inferring cities generically — adapting this to a different
  photo library's folder structure means updating that list.
- No packaged/distributable build (no electron-builder config) — run from
  source via `npm run dev`.
