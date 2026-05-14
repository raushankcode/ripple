# ↯ Ripple — Live Codebase Context for AI Agents

**Ripple helps AI coding agents understand your JavaScript or TypeScript codebase before they change it.**

AI agents usually break real projects for one simple reason: they cannot see the architecture around the file they are editing.

They see the file you gave them. They may see a few nearby files. But they do not automatically understand what imports that file, what depends on it, which symbols are shared across the project, or how one small edit can ripple through the architecture.

Ripple scans your workspace locally, builds a dependency and symbol map, and turns that map into editor signals and AI-ready context.

**Less guessing. More context. Safer edits.**

Ripple is not a replacement for tests, code review, or engineering judgment. It is a local context layer that helps humans and AI agents make safer decisions before changing code.

---

## The Problem: Context Rot

You can write a perfect `CLAUDE.md`, `.cursorrules`, `AGENTS.md`, or long prompt for your AI agent.

For a while, it helps.

Then your code changes.

A file moves.
A component gets reused.
A service gains new callers.
A function becomes risky to edit.
A rule in your hand-written context becomes outdated.

But your AI agent does not automatically know that.

It keeps following stale instructions with confidence.

That is **Context Rot**.

Ripple fights Context Rot by generating live architectural context from your actual JavaScript or TypeScript codebase.

---

## Real Project Proof

![Ripple value demo showing manual search finding 3 likely files while Ripple finds 19 potentially impacted files](resources/ripple-value-demo.gif)

Ripple was validated on a local clone of the open-source `sindresorhus/ky` TypeScript project.

```txt
52 files scanned
103 symbols found
349 import edges
41 call edges
```

For the same temporary change to `source/utils/merge.ts::mergeHeaders`:

- Manual diff and text search found `3` likely related files
- Ripple identified `19` potentially impacted files
- Ripple marked the change as `dangerous`
- Ripple recorded the exact changed symbol as `symbol_modified`
- Ripple generated verification targets before the edit was treated as safe

The test was performed locally on a cloned repository and used only to validate Ripple's analysis behavior.

This validation does not imply endorsement by the Ky project or its maintainers.

Full technical validation: [docs/validation.md](https://github.com/raushankcode/ripple/blob/main/docs/validation.md)

---

## What Ripple Does

Ripple helps your AI agent ask the questions a careful engineer would ask before editing:

- What imports this file?
- What does this file import?
- Which functions are used elsewhere?
- How many callers does this symbol have?
- Is this file risky to change?
- Which files should be checked before the edit is treated as safe?
- Is this public API, internal logic, UI, state, handler, or data code?
- Should the agent continue, inspect callers first, or stop and ask for confirmation?

Ripple turns that information into:

- Live project context generated from your actual codebase
- Impact Lens sidebar
- CodeLens caller counts
- Safety Check for staged changes
- AI-agent prompt context
- `.ripple/WORKFLOW.md`
- `.ripple/history.json`
- focused `.ripple/.cache/focus/*.json` files

---

## Install

Install Ripple from the VS Code Marketplace.

Search:

```txt
Ripple
```

Or install from the command line:

```bash
code --install-extension rippleai.ripple
```

Then open any TypeScript or JavaScript project. Ripple starts analyzing your workspace automatically.

---

## Quick Start

1. Install Ripple
2. Open a TypeScript or JavaScript project
3. Wait for `↯ Ripple: ready` in the VS Code status bar
4. Open any `.ts`, `.tsx`, `.js`, or `.jsx` file
5. Use the Ripple sidebar to inspect imports and dependents
6. Right-click a file and run `↯ Ripple: Copy Agent Prompt`

To reopen the setup panel:

```txt
Ctrl+Shift+P → Ripple: Show AI Setup Panel
```

---

## Main Features

### 1. ↯ Impact Lens

Open a file and Ripple shows the local blast radius.

Example:

```txt
RIPPLE: IMPACT LENS

Current file:
  orderService.ts

Used by (7):
  checkoutRoute.ts
  paymentWebhook.ts
  orderSummary.tsx
  +4 more

Depends on (3):
  orderTypes.ts
  paymentClient.ts
  auditLog.ts
```

This helps you see whether a file is isolated or shared before asking an agent to refactor it.

---

### 2. ↯ CodeLens Caller Counts

Ripple adds caller-count hints above supported functions and components.

```typescript
↯ 28 callers — click to see details
export function verifySession(token: string): UserSession | null {

↯ no external callers
export const PrivacyNoticePage = () => {
```

This makes risky shared functions visible while you code.

---

### 3. ↯ Safety Check

When you stage files for a git commit, Ripple can warn when untested files may be affected.

```txt
↯ Ripple: orderService.ts → 4 untested files may be affected:
  checkoutRoute.ts, paymentWebhook.ts, orderSummary.tsx +1 more

[View details]  [Understood]
```

Ripple does not block your commit. It gives you impact awareness before you ship.

---

### 4. ↯ Copy Agent Prompt

Right-click a supported file and run:

```txt
↯ Ripple: Copy Agent Prompt
```

Ripple creates a task-ready prompt for Claude Code, Cursor, GitHub Copilot Chat, Continue, or another AI coding agent.

Example:

```txt
Refactor the order cancellation logic without changing its public API.

Before making changes:
1. Read the focus file for this file:
   .ripple/.cache/focus/orders-lib-cancelOrder.json
2. STOP — 7 files import this. Confirm before proceeding.
3. Check callers for every symbol you will modify.
4. Only touch the requested layer: logic, UI, handler, state, or data.

File: cancelOrder.ts
Risk: DANGEROUS
Importers: 7
Project rules: .ripple/WORKFLOW.md
```

You add the task. Ripple supplies the architecture context.

---

### 5. `.ripple/WORKFLOW.md`

Ripple generates a workflow file that tells AI agents how to work safely inside your project.

You can connect it to:

- `CLAUDE.md`
- `.cursorrules`
- `AGENTS.md`

If one of those files contains Ripple's managed section, Ripple refreshes only that section. Your own notes outside the Ripple section stay yours.

---

## Language Support

Ripple currently supports:

```txt
.ts
.tsx
.js
.jsx
```

Ripple is focused on JavaScript and TypeScript codebases first, including common React, Node.js, Next.js, Vite, Remix, Astro, NestJS, Turborepo, and pnpm workspace projects.

---

## Generated Files

Ripple creates a local `.ripple/` folder inside your workspace.

```txt
.ripple/
  history.json
  WORKFLOW.md
  .cache/
    graph.cache.json
    context.json
    context.files.json
    context.symbols.json
    focus/
      <focused-file-context>.json
```

Recommended `.gitignore`:

```gitignore
# Ripple generated cache
.ripple/.cache/

# Usually keep these for project memory:
# .ripple/history.json
# .ripple/WORKFLOW.md
```

`history.json` and `WORKFLOW.md` are project-relative and portable. The cache folder is regenerated automatically.

---

## What Ripple Tracks

Ripple currently tracks many common JavaScript and TypeScript patterns:

```txt
✓ Named imports
✓ Default imports
✓ Relative imports
✓ tsconfig path aliases
✓ Monorepo workspace imports
✓ Style imports
✓ Barrel re-exports
✓ Named function declarations
✓ Arrow function declarations
✓ Class declarations
✓ JSX component usage
✓ Common framework and package signals
```

Ripple v1 uses practical static analysis. It should be treated as a strong safety signal, not a mathematical proof.

---

## Known Limitations

Ripple is useful, but it is not magic.

Current known limitations:

```txt
✗ Namespace imports
  import * as Utils from './utils'

✗ Aliased imports
  import { CheckoutButton as PrimaryAction } from './ui'

✗ Dynamic imports
  await import('./module')

✗ CommonJS require calls
  require('./config')

✗ Constructor call edges
  new ClassName() is not always tracked as a calledBy edge
```

This is why Ripple uses careful language such as:

```txt
may affect
likely used by
possible blast radius
```

Full semantic resolution is planned for a later phase.

---

## Privacy

Ripple is local-first.

- No account required
- No telemetry
- No cloud indexing
- No code upload
- No hidden remote analysis

Your code stays on your machine. The `.ripple/` directory lives inside your workspace and belongs to you.

Saved history and generated context use project-relative paths, for example:

```txt
src/graph.ts::updateFile
```

Ripple uses exact absolute paths internally only while running, so VS Code can open and update the correct files on your machine.

---

## Who Ripple Is For

Ripple is for developers who use AI coding tools on real JavaScript or TypeScript projects.

Modern AI coding feels powerful until one small change breaks five unrelated files. Ripple is built for that moment: when the model is capable, but the context is missing.

It is especially useful if you:

- Use Claude Code, Cursor, Copilot, Continue, or another AI coding agent
- Work in a codebase with shared components, services, utilities, or hooks
- Want safer AI-assisted refactors
- Want agents to inspect dependencies before editing
- Are tired of repeating project context in every prompt

Ripple is not mainly for toy projects. It becomes more valuable as your codebase becomes harder to understand at a glance.

---

## Roadmap

### Agent Access

- MCP server support so agents can query Ripple directly
- `ripple_get_focus(filePath)`
- `ripple_get_blast_radius(filePath)`

### Analysis Improvements

- Improved monorepo intelligence
- Better handling for aliased imports
- Better handling for namespace imports
- Better handling for dynamic imports
- Richer framework-specific intelligence
- Deeper symbol and contract detection

### Verification

- Suggested test commands based on affected files
- Git summaries that explain architectural impact
- PR summaries that explain blast radius and residual risk
- Post-edit review with changed files and affected callers

---

## Contributing

Project links:

```txt
Repository: https://github.com/raushankcode/ripple
Issues:     https://github.com/raushankcode/ripple/issues
```

Issues, bug reports, feature requests, and pull requests are welcome.

If Ripple misses an import, caller, framework convention, or risky dependency path, please open an issue with a small reproduction.

---

## License

MIT License

---

_↯ Ripple helps AI agents inspect the codebase before changing it._
