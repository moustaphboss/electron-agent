# eval

A small evaluation harness for the agent's **tool-selection quality**: given
a set of representative user queries, does the model call the right MCP
tool with roughly the right arguments? Run against the real, compiled
`mcp-server` — same process the Electron app spawns, not a mock.

## Why a separate package

Root `package.json` is `"type": "commonjs"` (electron-vite bundles
`src/main`/`src/preload`/`src/renderer` with Vite, so the source's own
module type doesn't matter there). This package runs plain `.ts` files
directly under Node's native TypeScript support, which requires
`"type": "module"`. The two don't resolve across a shared `import` without
changing the root package's type — a bigger, riskier change than this
harness is worth. So `eval/src/agent.ts` re-implements a trimmed,
non-streaming version of `src/main/agentLoop.ts`'s tool loop rather than
importing it directly. What's being evaluated (tool selection) doesn't
depend on the streaming/turn-discard mechanics that differ between the two.

## Running

```
npm install        # once
npm run eval        # tsc -b && node dist/run.js
```

Needs `ANTHROPIC_API_KEY` in the repo-root `.env`, and `mcp-server` already
built (`cd ../mcp-server && npm run build`).

## What's covered

- `search_photos` argument construction: country filters, aperture/ISO
  range direction ("f/8 or narrower" → `minAperture: 8`, not `maxAperture`).
- A regression guard for a real bug: an exploratory tool call (e.g. "what's
  the earliest date in this trip?") followed by a narrower one used to leak
  _every_ photo from the exploratory round into the UI. `eval/src/cases.ts`
  encodes the fix as an assertion so it can't silently come back.

Each case's `check()` returns a failure reason string (or `null` to pass) —
add a case by pushing onto the `cases` array in `eval/src/cases.ts`.
