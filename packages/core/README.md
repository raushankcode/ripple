# @getripple/core

The core graph engine that powers Ripple's VS Code extension, CLI, and MCP server.
It scans a local repository, builds architectural context, and exposes the `GraphEngine`
used by Ripple's plan-before-edit and check-after-edit workflow.

Most users should not start here. Install `@getripple/cli` for terminal and CI
workflows, or `@getripple/mcp` to give AI agents direct structured access to
Ripple's architectural context.

## Install

```bash
npm install @getripple/core
```

## Basic Usage

```ts
import { GraphEngine } from "@getripple/core";

const engine = new GraphEngine(process.cwd());
await engine.initialScan();

const plan = engine.planContext(
  "refactor token handling",
  "src/auth.ts",
  4000
);
```

## What It Powers

- file dependency and reverse-import graph
- symbol and call-edge signals for JavaScript and TypeScript
- focused context plans for AI coding agents
- staged and changed-file checks against saved intent
- trust-boundary, policy, readiness, and drift summaries

## Trust Boundary Contract

Ripple's core engine is the source of truth for control modes, editable files,
context-only files, human gates, and continue/stop decisions. The CLI and MCP
packages use this contract so humans, CI, and AI agents see the same workflow
state.

## Status

Public alpha. APIs may change while Ripple's CLI and MCP workflows harden.

## License

MIT
