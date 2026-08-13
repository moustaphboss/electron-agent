# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An Electron desktop app ("Mustipix") with an AI agent that answers questions
about a local photo library. The agent's tools are exposed by a standalone
MCP server backed by SQLite (seeded from real photo EXIF data), and the
agent loop that drives the conversation is implemented **two ways** —
hand-rolled directly against the Anthropic Messages API, and via LangGraph
— selectable per-message in the UI.

## Repo layout: three independent npm packages

This is **not** an npm workspace. `mcp-server/` and `eval/` each have their
own `package.json`, `tsconfig.json`, and `node_modules`, and must be
installed/built separately from the root.

`mcp-server/` is structured this way deliberately: the MCP server is a
standalone process spawned over stdio, not a library the Electron app
imports — its dependencies need to exist as real `node_modules` so
`node dist/index.js` runs on its own (e.g. under the MCP Inspector or
Claude Desktop), independent of Electron entirely.

`eval/` is separate for a narrower reason: root `package.json` is
`"type": "commonjs"` (irrelevant to the Vite-bundled main/preload/renderer
code, but it does govern how Node interprets any `.ts` file run directly).
`eval/`'s scripts run under Node's native TypeScript support, which needs
`"type": "module"`. Rather than change the root package's module type,
`eval/src/agent.ts` re-implements a trimmed, non-streaming version of the
hand-rolled tool loop instead of importing `src/main/agentLoop.ts`
directly — see `eval/README.md`.

**Critical consequence**: the Electron main process spawns the MCP
server's _compiled_ output (`mcp-server/dist/index.js`, hardcoded in
`src/main/mcpClient.ts`), not its TypeScript source. After changing
anything under `mcp-server/src/`, you must rebuild that package before the
Electron app will see the change — `npm run dev` at the root does **not**
rebuild `mcp-server`.

## Commands

Root (Electron app):

```
npm install
npm run dev      # electron-vite dev — does NOT typecheck
npx tsc -b        # typecheck only (both tsconfig.node.json + tsconfig.web.json)
npm run build     # typecheck + production build (tsc -b && electron-vite build)
npm run format    # prettier --write . — covers both packages, repo-root config
```

`mcp-server/` (run from inside that directory, or `cd mcp-server && ...`):

```
npm install
npm run build     # tsc -b only, compiles to dist/
npm run seed       # rebuilds, then re-runs the EXIF seed script against PHOTOS_ROOT
npm run start        # node dist/index.js — runs the compiled server standalone
npx @modelcontextprotocol/inspector node dist/index.js   # interactive tool testing
```

There is no lint command (no ESLint config) and no automated test suite
(`mcp-server`'s `test` script is an unimplemented placeholder; there's no
Playwright/Vitest/Jest anywhere in the repo). CI (`.github/workflows/ci.yml`)
only runs `npm ci && npm run build` for the root package — `mcp-server` is
not covered by CI.

Electron dev/build requires `ELECTRON_RUN_AS_NODE` to be **unset** in the
shell — if set, `require("electron")` resolves to a plain binary path
instead of the Electron API object and every `electron.*` call throws.

## Architecture

**Process/module boundaries**, and why data flows the way it does:

```
Electron renderer (React, src/renderer/)
      │  contextBridge (src/preload/) — the only surface the renderer can call
      ▼
Electron main process (src/main/main.ts)
      │  holds the Anthropic client AND an MCP client (src/main/mcpClient.ts)
      │  spawns mcp-server/dist/index.js as a child process over stdio
      ▼
mcp-server (standalone process, mcp-server/src/index.ts)
      │  3 tools, each wrapped in withLogging() for structured stderr logs
      ▼
SQLite (mcp-server/data/photos.db, seeded from real EXIF data)
```

**Two agent implementations, one shared contract.** `src/main/agentLoop.ts`
(hand-rolled: explicit turn loop against `anthropic.messages.stream()`,
`MAX_TURNS` safety cutoff) and `src/main/langGraphAgentLoop.ts`
(`createReactAgent` from `@langchain/langgraph/prebuilt`, tools loaded from
the _same already-connected_ MCP client via `@langchain/mcp-adapters`'
`loadMcpTools()`). Both return `Promise<AgentReply>` (`{ text, images }`)
and both stream text deltas through a callback rather than resolving all
at once. `main.ts`'s `ask-agent-stream` handler branches on a `mode`
parameter to pick one — if you change one implementation's behavior
(error handling, image extraction, logging), check whether the other needs
the same change.

**IPC is event-based, not request/response**, because replies stream.
`ipcMain.on("ask-agent-stream", ...)` (not `.handle`) pairs with the main
process pushing `agent-chunk` (text delta), `agent-reset` (the streamed
text so far was intermediate tool-call reasoning, not the final answer —
discard it), `agent-done`, and `agent-error` back over
`event.sender.send(...)`. The preload/renderer side mirrors this with
`askAgentStream` (fire-and-forget send) plus `onAgentChunk` /
`onAgentReset` / `onAgentDone` / `onAgentError` listeners, correlated by a
`requestId` the renderer generates per question.

**Images are never sent through the model.** `src/main/extractImages.ts`
deterministically parses `file_path` fields straight out of the tool
call's raw JSON result (used by both agent loops) — the model only ever
sees path strings as text, never pixels, and the renderer never trusts the
model to repeat a path correctly in prose. Local files are then served to
the renderer through a custom `photo-file://` protocol
(`protocol.registerSchemesAsPrivileged` + `protocol.handle` in `main.ts`),
specifically to avoid disabling Electron's `webSecurity`.

**Module resolution differs between the two packages on purpose.** Root
uses `moduleResolution: "Bundler"` (tsconfig.node.json/tsconfig.web.json)
since electron-vite bundles everything with Vite/esbuild. `mcp-server`
uses `"NodeNext"` since it compiles to plain JS that Node runs directly
with no bundler — relative imports in its `.ts` files need explicit `.js`
extensions (they're importing the compiled output's module graph, not the
source). Don't "fix" `mcp-server`'s import extensions to match root's
style; they're required there.

**Tool schemas are Zod, converted at two different boundaries.** MCP tool
`inputSchema` is a Zod raw shape (object of field name → Zod type, not a
single `z.object()`) passed to `server.registerTool()`. The hand-rolled
loop renames `inputSchema` → `input_schema` for Anthropic's Messages API;
`loadMcpTools()` does the equivalent conversion automatically for
LangGraph.

**Observability**: `mcp-server/src/index.ts`'s `withLogging()` wraps every
tool handler, logging JSON lines to **stderr only** (stdout is the stdio
MCP transport's protocol channel — anything written there corrupts it).
Uses the protocol's own per-call `requestId` as the default correlation
id, and reads an optional `_meta.traceId` (set by the hand-rolled loop,
not currently wired through the LangGraph path) so multiple tool calls
within one agent turn can be threaded into a single trace.

**The photo library isn't generic.** `mcp-server/src/seed.ts`'s
`PHOTOS_ROOT` is a hardcoded personal path, and country/city detection
relies on a hardcoded `KNOWN_CITIES` allowlist plus an `EXCLUDED_DIRS` set
for non-photo subfolders (`raw`, `edit`, etc.) — both need updating for a
different photo library's folder structure. There's no GPS data in the
seeded set (camera photos, not phone photos), so location matching is
entirely date-range-based.

**Icon duplication is intentional.** `resources/icon.png` is read via
Node `fs` from the main process (window/dock icon) and cannot be reached
by Vite-bundled renderer code, since it's outside the renderer's root — a
second copy lives at `src/renderer/src/assets/icon.png` specifically for
the sidebar logo `<img>` import.
