# @getripple/core

**Core engine for Ripple's local drift-control system for AI coding agents.**

`@getripple/core` scans repositories, builds local dependency intelligence, tracks architectural relationships, records approved work boundaries, and powers Ripple's CLI, MCP server, CI integrations, and editor experiences.

Most users should start with:

```txt
@getripple/cli
```

or

```txt
@getripple/mcp
```

and use `@getripple/core` only when building custom integrations.

---

## Install

```bash
npm install @getripple/core
```

---

## Basic Usage

```ts
import { GraphEngine } from "@getripple/core";

const engine = new GraphEngine(process.cwd());

try {
  await engine.initialScan();

  const blastRadius = engine.blastRadius(["src/auth.ts"]);
  const importers = engine.downstreamFiles("src/auth.ts");
  const imports = engine.upstreamFiles("src/auth.ts");

  console.log({
    blastRadius,
    importers,
    imports,
  });
} finally {
  engine.dispose();
}
```

---

## What Core Powers

`@getripple/core` is the shared engine behind Ripple's public interfaces.

```txt
@getripple/cli
@getripple/mcp
VS Code integrations
CI workflows
Custom integrations
```

The engine provides local signals used to answer:

```txt
What should an agent read before editing?

What files may be affected?

What symbols may be affected?

What was approved?

What changed?

Did the agent drift?

Can the agent continue?

Does a human need to review?
```

---

## Core Capabilities

Ripple builds and maintains local repository intelligence.

```txt
dependency graph

reverse imports

exported symbols

call relationships

blast radius analysis

architectural history

focused context generation

saved change intents

approval tracking

trust-boundary validation

drift detection

continue / stop gate summaries
```

These capabilities power the Ripple workflow:

```txt
plan work

save intent

agent edits code

check changes

detect drift

repair or review

continue safely
```

---

## Trust Boundary Contract

The Trust Boundary Contract is the core safety model used throughout Ripple.

Ripple compares:

```txt
planned work
```

against

```txt
actual changes
```

to determine whether an AI coding agent stayed within the work it was trusted to perform.

The Trust Boundary Contract consists of:

```txt
planned work       -> what the human approved

approved boundary  -> file, function, task, brainstorm, or PR scope

actual changes     -> what the agent modified

drift result       -> whether the agent left the approved work

gate decision      -> continue, repair, human-review, or restore-readiness
```

The Trust Boundary Contract enables Ripple to:

```txt
detect intent drift

detect boundary drift

require repair

require human review

produce continue/stop decisions

protect approved workflows
```

This contract is consumed by:

```txt
humans

AI coding agents

CI systems

automation pipelines
```

---

## Context Modes

Core supports multiple context-generation modes.

```txt
lean
```

Uses graph and history cache for fast checks and gates.

```txt
on-demand
```

Builds targeted context for MCP tools and focused requests.

```txt
full
```

Generates broader workflow context for file-oriented agent workflows.

---

## Ripple Workspace

Machine cache:

```txt
.ripple/.cache/
```

Workflow and audit state:

```txt
.ripple/policy.json
.ripple/history.json
.ripple/intents/
.ripple/approvals/
```

---

## Language Support

| Language   | Support |
| ---------- | ------- |
| JavaScript | Deep    |
| TypeScript | Deep    |
| Python     | Basic   |

JavaScript and TypeScript currently provide the strongest experience.

Python support includes:

```txt
imports

functions

classes

basic call relationships
```

Framework detection and configuration analysis remain heuristic.

Ripple reports local repository signals rather than perfect semantic truth.

---

## Privacy

Ripple operates locally.

```txt
No telemetry

No cloud indexing

No code upload

No remote dependency required

No account required
```

Repositories are scanned on the user's machine.

---

## Status

Public alpha.

The most stable public contracts are:

```txt
@getripple/cli

@getripple/mcp
```

Core APIs may evolve as Ripple's graph, context, drift-control, and approval systems mature.

---

## What Core Is Not

`@getripple/core` is not:

```txt
a coding agent

a code generator

a code review replacement

a test replacement

a typechecker replacement

a sandbox

a compiler
```

Instead, it is the local intelligence engine that helps Ripple determine whether an AI coding agent remained inside the work it was trusted to perform.

---

## License

MIT
