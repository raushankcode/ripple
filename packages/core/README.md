# @getripple/core

The graph engine that powers Ripple's VS Code extension, CLI, and MCP server.

Scans JavaScript, TypeScript, and basic Python repositories, builds a local
dependency graph, and exposes the architectural context that AI agents need
before editing code.

**Most users should not start here.**
Install [`@getripple/cli`](https://npmjs.com/package/@getripple/cli) for terminal
and CI workflows.
Install [`@getripple/mcp`](https://npmjs.com/package/@getripple/mcp) to give AI
agents direct structured access to Ripple's context.

## Install

```bash
npm install @getripple/core
```

## Basic Usage

```ts
import { GraphEngine } from "@getripple/core";

const engine = new GraphEngine(process.cwd());
await engine.initialScan();

// What does this file affect?
const blastRadius = engine.blastRadius(["src/auth.ts"]);

// What depends on this file?
const importers = engine.downstreamFiles("src/auth.ts");

// What does this file import?
const imports = engine.upstreamFiles("src/auth.ts");
```

## What the Engine Tracks

```
File dependency graph      — every import and reverse import
Symbol and call edges      — exported functions and who calls them
Blast radius               — all files affected by a change
Risk signals               — dangerous / caution / safe per file
Focused context            — per-file summaries for AI agents
Change history             — structural changes since first install
Layer classification       — logic / ui / handler / state / data / effect
Framework/config signals   — Next.js, Vite, React Router, Turborepo, Tailwind,
                             tests, tsconfig paths, and package conventions
```

## What It Powers

**VS Code extension (`ripple`)** — Impact Lens sidebar, CodeLens caller counts,
Safety Check pre-commit warnings, and Copy Agent Prompt.

**CLI (`@getripple/cli`)** — `ripple plan`, `ripple check`, `ripple gate`, and
the full CI pipeline integration.

**MCP server (`@getripple/mcp`)** — `ripple_plan_context`, `ripple_check_staged`,
`ripple_gate`, and twelve other tools agents can call directly.

## Trust Boundary Contract

The core engine is the single source of truth for control modes, editable files,
context-only files, human gates, and continue/stop decisions. The CLI and MCP
packages consume this contract directly — humans, CI pipelines, and AI agents
all see the same workflow state.

## Supported Languages

Deep support: JavaScript and TypeScript — `.ts`, `.tsx`, `.js`, `.jsx`.

Basic support: Python — `.py`.

Framework and config signals are heuristic. Ripple detects common files and
package conventions, then tells agents what to trust and what to verify.

## Privacy

The engine runs entirely on your machine. No data leaves the local file system.
No network calls, telemetry, or account required.

## Status

Public alpha. Core APIs may change while the CLI and MCP workflow contracts
harden toward a stable 1.x release.

## License

MIT
