# ↯ Ripple

Your AI agent's context goes stale the moment you save a file.
Ripple fixes this. Automatically. On every save.

---

**Context Rot** is when your manually written CLAUDE.md or .cursorrules
describes a codebase that no longer exists. The agent follows outdated
instructions and breaks things you didn't ask it to touch.

Ripple ends Context Rot permanently. It reads your entire project and
auto-generates a live WORKFLOW.md on every save — then syncs it to
your agent's instruction file automatically. Set it up once. Never
touch it again.

---

I gave an AI agent a refactor task on `SacredButton.tsx`.
28 files depended on it.

The agent read the Ripple focus file. Saw the risk. Stopped and confirmed before touching anything. Changed only the internals. Every caller kept working.

**3 minutes 23 seconds. Zero debugging.**

That is what Ripple does for every file in your project.

---

## Install

Search **Ripple** in the VS Code Extensions marketplace.

Open any TypeScript or JavaScript project. Ripple starts working immediately.

---

## The Problem

You build with AI. Changes happen fast. But when your agent changes a function, does it know which 28 other files depend on it? Does it know that changing the return type will cascade through 4 layers of your architecture?

It does not. Unless it has already read your entire project.

Ripple already has.

---

## Three Live Features

### ↯ Impact Lens — Sidebar

Open any file. See instantly what imports it and what it imports.

```
RIPPLE: IMPACT LENS

Used by (7):
  SepsisGalaxy.tsx
  RingDisplay.tsx
  ScorePanel.tsx
  ConditionJourney.tsx
  +3 more

Depends on (3):
  IntuitionTypes.ts
  rings.ts
  db-client.ts
```

Click any file to open it. Includes CSS and style file dependencies.

---

### ↯ Ripple CodeLens — Caller Count

Every function shows its caller count permanently above the declaration.

```typescript
↯ 28 callers — click to see details
export const SacredButton = ({ onClick, children, variant = 'guardian' }: Props) => {

↯ 7 callers — click to see details
export function validateToken(token: string): User | null {

↯ no external callers
const handleSubmit = () => {
```

Click any hint to open the full caller panel. No hovering required. Always visible.

---

### ↯ Safety Check — Pre-Commit

Stage any file for a git commit. Within 2 seconds Ripple shows which untested files in the blast radius will be affected.

```
↯ Ripple: authService.ts → 4 untested files affected:
  loginRoute.ts, sessionMiddleware.ts, userProfile.tsx +1 more

[View details]  [Understood]
```

Never blocks your commit.

---

## The AI Agent Feature

### Copy Agent Prompt

Right-click any TypeScript file → **↯ Ripple: Copy Agent Prompt**

```
[DESCRIBE YOUR TASK HERE]

Before making any changes:
1. Read the focus file for this file:
   Relative: .ripple/focus/bookings-lib-handleCancelBooking.json
   Absolute: C:\projects\myapp\.ripple\focus\bookings-lib-handleCancelBooking.json
2. STOP — 7 files import this. Confirm before proceeding.
3. Check calledBy for every symbol you will modify
4. Only touch the layer the user requested (logic/ui/handler/state/data)

File: handleCancelBooking.ts | Risk: DANGEROUS | 7 importers
Symbols: handleCancelBooking [logic], getCancelledEventName [logic]
Project rules: .ripple/WORKFLOW.md
```

Fill in your task. Paste to Claude Code, Cursor, Copilot, or any AI agent.

### WORKFLOW.md — Zero Repeated Prompts

Copy `.ripple/WORKFLOW.md` to `CLAUDE.md` (Claude Code) or `.cursorrules` (Cursor) once. Every one-line prompt then works safely — agents read the full protocol automatically before every task.

```
You type: "Refactor the scoring logic in calculateRisk"

Agent automatically:
1. Reads .ripple/focus/scoring-lib-calculateRisk.json (200 tokens)
2. Sees: risk=caution, 3 importers, layer=logic
3. Checks every caller before touching anything
4. Makes a safe, targeted change
```

### Planning for Complex Multi-File Tasks

WORKFLOW.md includes a built-in planning protocol for tasks that touch multiple files. Before writing any code, the agent:

1. Identifies the starting file and reads its focus file
2. Chains through `imports` and `importedBy` 1-2 levels deep using Ripple's graph
3. Presents a numbered plan with file names and risk levels to the user
4. Waits for confirmation before writing a single line of code

```
Agent: "To add Passkey support, I will change:
  1. types/auth.ts       — add PasskeyCredential type  [caution, 3 importers]
  2. lib/authService.ts  — update login() logic         [dangerous, 7 importers]
  3. components/LoginButton.tsx — update UI handler     [safe, 0 importers]
  Shall I proceed in this order?"
```

This replaces guesswork with graph-driven precision.

### First-Time Setup

When Ripple finishes scanning, a panel shows you the highest-risk file in your actual project with its real dependents. One click creates `AGENTS.md` automatically.

---

## The `.ripple/` Directory

```
.ripple/
  history.json           — permanent architectural memory (keep this)
  context.json           — project summary (~500 tokens)
  context.files.json     — full file dependency map (~3000 tokens)
  context.symbols.json   — full symbol call graph (~5000 tokens)
  WORKFLOW.md            — agent instruction file
  graph.cache.json       — startup cache (gitignore this)
  focus/
    bookings-lib-handleCancelBooking.json  — 200 tokens for handleCancelBooking.ts
    components-booking-BookingListItem.json — 200 tokens for BookingListItem.tsx
    ...
```

Focus file keys use a 3-segment path formula (`grandparent-parent-filename`) to avoid collisions in projects where multiple directories share the same name (e.g. multiple `lib/` folders in a monorepo).

### Token Usage

| Task                     | Tokens              |
| ------------------------ | ------------------- |
| Modify one specific file | ~200 (focus file)   |
| Add a new component      | ~500 (context.json) |
| Check file dependencies  | ~3000               |
| Trace a call chain       | ~5000               |
| Deep multi-file refactor | ~15000              |

A 300-file project never needs 250,000 tokens.

---

## Focus File — What Agents Actually Read

`packages/features/bookings/lib/handleCancelBooking.ts`
→ `.ripple/focus/bookings-lib-handleCancelBooking.json`

```json
{
  "file": "handleCancelBooking.ts",
  "modificationRisk": "dangerous",
  "changeCount": 14,
  "dataQuality": "complete",
  "totalImporterCount": 7,
  "focusKey": "bookings-lib-handleCancelBooking",
  "instructions": [
    "DANGER: This file has 7 importers. Top importers: api/cancel/route.ts, BookingListItem.tsx, handleNewBooking.ts. Any change has wide blast radius.",
    "calledBy uses project/relative/file.tsx::functionName format — use it to locate callers directly.",
    "Use layer field to confirm you are modifying the correct layer (logic/ui/handler)."
  ],
  "importedBy": [
    {
      "file": "apps/web/components/booking/BookingListItem.tsx",
      "modificationRisk": "safe"
    },
    { "file": "apps/api/cancel/route.ts", "modificationRisk": "caution" }
  ],
  "imports": [
    "packages/lib/EventManager.ts",
    "packages/features/webhooks/lib/getWebhooks.ts"
  ],
  "symbols": [
    {
      "name": "handleCancelBooking",
      "kind": "function",
      "layer": "logic",
      "callerCount": 3,
      "calledBy": [
        "apps/web/components/booking/BookingListItem.tsx::CancelBookingButton",
        "apps/api/cancel/route.ts::DELETE"
      ],
      "calls": [
        "packages/lib/EventManager.ts::createEvent",
        "packages/features/webhooks/lib/sendPayload.ts::sendWebhook"
      ]
    }
  ]
}
```

Every path in `importedBy`, `imports`, `calledBy`, and `calls` is a project-relative path — unique across the entire project, usable as a direct lookup key in `context.files.json`.

---

## Settings

| Setting                  | Default | Description                                    |
| ------------------------ | ------- | ---------------------------------------------- |
| `ripple.enabled`         | `true`  | Enable or disable Ripple entirely              |
| `ripple.showCodeLens`    | `true`  | Show caller counts above function declarations |
| `ripple.safetyCheck`     | `true`  | Show blast radius warnings before git commits  |
| `ripple.generateContext` | `true`  | Write `.ripple/` context files on every save   |

When `ripple.generateContext` is disabled, the live graph still builds — Impact Lens and CodeLens still work — but no files are written to `.ripple/`. Useful for projects where you want Ripple's UI features without the generated files.

---

## Recommended .gitignore

```gitignore
# Ripple — regenerated automatically on every session
.ripple/graph.cache.json
.ripple/context.json
.ripple/context.files.json
.ripple/context.symbols.json
.ripple/focus/
.ripple/WORKFLOW.md

# Keep history.json — this is your permanent architectural memory.
# It records every function change, import edge, and blast radius
# since Ripple was installed. Useful for code reviews and audits.
# .ripple/history.json
```

---

## Setup

1. Install from the VS Code Marketplace
2. Open any TypeScript or JavaScript project
3. Wait for `↯ Ripple: ready` in the status bar
4. Click **Activate AI Mode** in the setup panel (or copy `.ripple/WORKFLOW.md` to `CLAUDE.md` manually)
5. Done — one-line prompts work safely from this point

To reopen the panel: `Ctrl+Shift+P` → **Ripple: Show AI Setup Panel**

---

## What Ripple Tracks

```
✓ Named imports           import { validateToken } from './auth'
✓ Default imports         import Button from './Button'
✓ @/ alias imports        import { db } from '@/lib/db'
✓ tsconfig path aliases   import x from '~components/x'
✓ Style imports           import styles from './Button.module.css'
✓ Barrel file re-exports  export { x } from './index'
✓ Named function decls    export function handleLogin() {}
✓ Arrow function decls    const handleSubmit = () => {}
✓ Class declarations      export class EventManager {}
✓ MobX class stores       class CycleStore { @action fetch() {} }
✓ JSX component usage     <Button /> counted as a caller
```

## Known Limitations

```
✗ Namespace imports        import * as Utils from './utils'
✗ Aliased imports          import { Button as Btn } from './ui'
✗ Dynamic imports          await import('./module')
✗ require() calls          require('./config')
✗ Monorepo workspace pkgs  @calcom/lib/* resolved via Turborepo workspace
  (cross-package edges not tracked — project-internal files only)
✗ Constructor calls         new ClassName() not tracked as calledBy edge
```

---

## Framework Support

**Detected automatically at install:**

| Framework                    | Detection                | Context                                        |
| ---------------------------- | ------------------------ | ---------------------------------------------- |
| Next.js (App + Pages Router) | `next.config.ts`         | Route conventions, server components           |
| Vite                         | `vite.config.ts`         | No SSR assumptions                             |
| React Router                 | `react-router.config.ts` | SPA conventions                                |
| Turborepo                    | `turbo.json`             | Monorepo directory scanning                    |
| MobX                         | `package.json` + imports | Class stores detected, correct constraint rule |
| React Query / tRPC / SWR     | `package.json`           | Data-fetching state detected                   |
| Prisma                       | Method names             | DB methods classified as `data` layer          |
| Tailwind                     | `tailwind.config.ts`     | Styling constraint in WORKFLOW.md              |

Works with: React · Node.js · NestJS · Remix · Astro · Any TypeScript/JS project

---

## Privacy

Entirely local. No data leaves your machine. No telemetry. No account. No network requests.

---

## Roadmap

- MCP server — agents call `ripple_get_blast_radius()` directly without reading files
- Architecture Rules Engine — define layer boundaries, flag violations in real time
- Cursor Marketplace listing
- Dynamic import tracking

---

## Contributing

GitHub: https://github.com/raushankcode/ripple

Issues, feature requests, and pull requests welcome.

---

MIT License

---

_↯ Ripple — AI agents that use Ripple behave like senior engineers who have read your entire codebase._
