# Ripple — Local AI-Agent Workflow Engine

> Ripple is a local AI-agent workflow engine that plans before edit, checks
> after edit, catches drift, and tells the agent what to fix.

It does four practical things:

```
Plan before edit.
Check after edit.
Catch drift.
Tell the agent exactly what to fix.
```

Ripple is not a magical codebase brain. It is a local workflow engine that gives
humans and AI agents fresh architectural context at the exact moment they are
about to change code.

![Ripple demo](resources/ripple-value-demo.gif)

---

## The Problem

AI coding agents can search your repo, read files, and write code. That part
works. The harder question is:

```
Does the agent understand what this change may affect?
```

In real projects, agents routinely miss:

- Shared utilities with many importers
- Public API files with wide blast radius
- Symbols with many callers across the codebase
- Tests that must be verified after a change
- Files that were meant to be read as context, not edited
- Drift from the original task after several sequential edits

That is the problem Ripple is built around.

---

## Quick Start

Initialize Ripple in a repo:

```bash
npx -y @getripple/cli init
```

Plan before editing a file:

```bash
npx -y @getripple/cli plan --file src/auth.ts --task "change token refresh behavior" --mode file --agent --save
```

After editing and staging changes, check for drift:

```bash
git add src/auth.ts
npx -y @getripple/cli check --staged --agent --intent latest
```

Get the compact continue/stop decision:

```bash
npx -y @getripple/cli gate --intent latest
```

---

## Core Workflow

### 1. Initialize

```bash
ripple init
```

Writes the main setup files and runs an initial scan:

```
.ripple/policy.json
.github/workflows/ripple.yml
```

The scan may also refresh `.ripple/WORKFLOW.md`, history, and cache files.
Setup files are left alone unless you pass `--force`.

---

### 2. Plan Before Editing

```bash
ripple plan --file src/auth.ts --task "change token refresh behavior" --mode file --agent --save
```

Ripple returns a focused plan:

```
readFirst:
  - src/auth.ts
  - src/session.ts

readIfNeeded:
  - tests/auth.test.ts

avoidInitially:
  - docs/
  - unrelated UI files

risk:              caution
editableFiles:     src/auth.ts
controlMode:       file
humanGate:         none | required-before-edit, depending on policy
allowedFiles:      src/auth.ts
contextFiles:      src/session.ts
verificationTargets: tests/auth.test.ts
```

If `humanGate` is required, record human approval after reviewing the plan:

```bash
ripple approve --intent latest --gate before-risky-edit
```

---

### 3. Edit Inside the Planned Boundary

The agent reads only `readFirst` files, edits only `editableFiles`, and does
not touch `contextFiles` or anything outside the saved boundary.

---

### 4. Check After Staging

```bash
git add src/auth.ts
ripple check --staged --agent --intent latest
```

If the agent changed an unplanned file, edited a context-only file, crossed the
control boundary, or created contract risk — Ripple reports drift.

The `handoff` field in the response is what the agent reads first. It gives the
compact final command: continue, audit, repair, restore readiness, or ask the human.

---

### 5. Repair If Needed

```bash
ripple repair --agent --intent latest
```

Returns concrete repair actions:

```
unstage-file:      src/session.ts was context-only
review-symbol:     src/auth.ts::refreshToken changed outside the plan
review-contract:   public contract may have changed
verify:            run tests/auth.test.ts
replan:            create a new Ripple plan if the task scope has changed
```

This is the core loop: plan → approve if required → edit → check → obey handoff → repair or continue.

---

## Trust Boundaries

Ripple saves the freedom level the agent was given before editing and checks
whether the agent stayed inside it.

```bash
ripple plan --file src/auth.ts --symbol refreshToken --task "fix retry behavior" --mode function --agent --save
```

Supported modes:

| Mode         | What the agent is allowed to touch           |
| ------------ | -------------------------------------------- |
| `brainstorm` | No edits allowed — suggest and explain only  |
| `function`   | Only the approved symbol                     |
| `file`       | Only the selected file                       |
| `task`       | All files in the saved plan                  |
| `pr`         | Full task scope — human reviews before merge |

After staging, Ripple checks two things independently:

```
intent drift    → did the edit leave the task plan?
boundary drift  → did the edit cross the chosen freedom level?
```

If `function` mode allowed only `src/auth.ts::refreshToken` but the agent also
changed `src/auth.ts::login`, Ripple reports `boundary_verdict: DANGER` and
`ripple repair` tells the agent exactly which symbol to undo or which wider
boundary needs human approval.

---

## Drift Verdict Contract

Every check returns one clear verdict:

```
PASS   → continue
DRIFT  → fix-before-commit
DANGER → stop-and-ask-human
```

The same contract appears in CLI JSON, agent text output, and MCP tool results:

```json
{
  "driftVerdict": {
    "status": "drift",
    "decision": "fix-before-commit",
    "label": "DRIFT",
    "summary": "DRIFT: staged changes left the saved Ripple plan.",
    "why": ["Context-only file changed: src/session.ts"],
    "fix": ["Unstage context-only file: src/session.ts"]
  }
}
```

You planned X. You edited Y. This passes / drifted / is dangerous. Here is
exactly what to do next.

---

## Agent Handoff Contract

For AI agents, the most important field in every response is `handoff`.

It is returned by `ripple check`, `ripple repair`, `ripple audit`,
`ripple_check_staged`, `ripple_repair_intent_drift`, and `ripple_audit_change`.

```json
{
  "handoff": {
    "protocol": "ripple-agent-handoff",
    "canContinue": false,
    "mustStop": true,
    "needsHuman": true,
    "decision": "human-review",
    "nextRequiredAction": "Stop editing and ask the human to record approval with ripple approve before continuing.",
    "summary": "Record or verify human approval for the saved gate before continuing.",
    "why": ["Human approval is required for this saved intent."],
    "fixNow": ["Ask the human to approve the saved intent gate."],
    "askHuman": [
      "Review the saved plan and approve the before-risky-edit gate."
    ],
    "commands": {
      "approve": ["ripple approve --intent latest --gate before-risky-edit"]
    }
  }
}
```

The agent rule:

```
handoff.mustStop=true    → stop. follow handoff.fixNow and handoff.askHuman
handoff.needsHuman=true  → do not self-approve. ask the human
handoff.canContinue=true → continue only after the listed verify commands pass
```

---

## Interfaces

Ripple is one engine with multiple interfaces.

```
packages/core    → @getripple/core    — local architectural context engine
packages/cli     → @getripple/cli     — terminal and CI interface
packages/mcp     → @getripple/mcp     — MCP interface for AI agents
src/extension.ts → ripple (VS Code)   — human interface
```

### CLI — `@getripple/cli`

```bash
npm install -g @getripple/cli
```

Full command reference:

```bash
ripple init                                                   # initialize repo
ripple doctor                                                 # check readiness
ripple agent                                                  # print agent guide
ripple scan .                                                 # scan the repo
ripple focus src/auth.ts                                      # file context
ripple blast src/auth.ts                                      # blast radius
ripple imports src/auth.ts                                    # what this imports
ripple importers src/auth.ts                                  # what imports this
ripple symbols src/auth.ts                                    # exported symbols
ripple callers src/auth.ts::validateToken                     # symbol callers
ripple history --last 10                                      # recent changes
ripple plan --file src/auth.ts --task "..." --agent --save    # plan before edit
ripple check --staged --agent --intent latest                 # check after edit
ripple check --changed --base origin/main --strict            # CI check
ripple audit --agent --intent latest                          # audit a change
ripple approval --intent latest --agent                       # check gate status
ripple approve --intent latest --gate before-risky-edit       # record approval
ripple repair --agent --intent latest                         # get repair plan
ripple gate --intent latest                                   # compact decision
ripple ci --base origin/main --intent latest --github-annotations  # CI gate
ripple init-ci                                                # generate CI file
ripple policy init                                            # create policy
ripple policy explain --file src/auth.ts                      # explain policy
```

In CI, `--github-annotations` emits GitHub errors for intent drift, boundary
drift, contract drift, and policy drift. The gate exits non-zero when drift
blocks merge.

### MCP — `@getripple/mcp`

Paste into any MCP-compatible client. Replace the workspace path with your project path.

```json
{
  "mcpServers": {
    "ripple": {
      "command": "npx",
      "args": [
        "-y",
        "@getripple/mcp",
        "--workspace",
        "/absolute/path/to/your/repo"
      ]
    }
  }
}
```

**macOS / Linux:** `/Users/yourname/projects/myapp`
**Windows:** `C:\\Users\\yourname\\projects\\myapp`

Available tools:

```
ripple_get_agent_workflow      full agent workflow guide and loop
ripple_doctor                  check project readiness
ripple_plan_context            plan before editing a target file
ripple_check_staged            check staged changes against saved intent
ripple_check_changed           check changed files against a git base ref
ripple_audit_change            audit a completed change for drift signals
ripple_gate                    compact continue/stop decision
ripple_get_approval_status     check whether a human gate is required
ripple_repair_intent_drift     get repair actions when drift is detected
ripple_get_focus               focused context for a single file
ripple_get_blast_radius        files that depend on a target file
ripple_explain_policy          explain the active trust boundary policy
ripple_get_recent_changes      recent architectural changes from history
```

`ripple_plan_context` returns the read plan and the repo trust boundary in one
call. `ripple_audit_change` returns intent drift, boundary drift, policy drift,
repair plan, approval state, and `handoff` together. `ripple_gate` is the
compact continue/stop signal when the agent only needs a decision.

### VS Code Extension

Install from the Marketplace:

```bash
code --install-extension rippleai.ripple
```

Open any JavaScript or TypeScript project and wait for `Ripple: ready` in the
status bar. Provides:

- Impact Lens sidebar — what depends on this file, what it depends on
- CodeLens caller counts above every function
- Safety Check pre-commit blast radius warnings
- Copy Agent Prompt right-click command
- Setup panel for AGENTS.md, CLAUDE.md, and .cursorrules

### Core — `@getripple/core`

The pure Node.js engine. Not for direct use in most cases. Install the CLI or
MCP package instead.

```ts
import { GraphEngine } from "@getripple/core";

const engine = new GraphEngine(process.cwd());
await engine.initialScan();

const importers = engine.downstreamFiles("src/auth.ts");
const blastRadius = engine.blastRadius(["src/auth.ts"]);
```

---

## What Ripple Checks After Editing

When you run `ripple check` or `ripple_check_staged`, Ripple compares staged
changes against the saved intent and reports:

```
Unplanned files changed
Context-only files edited
Unplanned symbols changed
Possible public contract changes
Dangerous files touched
Verification targets to run
Files with many importers
Policy drift since intent was saved
```

Repair actions:

```
verify             run the narrowest test or compile check
unstage-file       remove a context-only file from staging
review-symbol      a symbol changed outside the plan
review-contract    a public contract may have changed
replan             create a new intent if the task scope expanded
create-intent      no saved intent found, create one first
```

---

## Trust Policy

You can define repo-level trust defaults in `.ripple/policy.json`:

```json
{
  "defaultMode": "file",
  "riskRules": [
    {
      "paths": ["src/auth/**", "src/security/**"],
      "risk": "high",
      "requireHumanBeforeEdit": true,
      "requireHumanBeforeMerge": true
    },
    {
      "paths": ["src/payments/**", "migrations/**"],
      "risk": "critical",
      "requireHumanBeforeEdit": true,
      "requireHumanBeforeDeploy": true
    },
    {
      "paths": ["docs/**"],
      "risk": "low",
      "allowPrMode": true
    }
  ]
}
```

`ripple plan` reads this policy, applies the matching rule, and includes
`policyExplanation` in the agent output. If the policy changes after an intent
is saved, Ripple reports `policyDrift` and requires human review before
continuing.

---

## Generated Files

Ripple writes workflow context to `.ripple/`:

```
.ripple/
  WORKFLOW.md                    agent operating protocol
  history.json                   structural changes since install
  policy.json                    repo trust defaults
  intents/
    latest.json                  most recently saved change intent
  approvals/
    <intent-id>/
      before-risky-edit.json     recorded human approval
  .cache/
    context.json                 project routing and risk summary
    context.files.json           full file dependency map
    context.symbols.json         full symbol call graph
    focus/
      <file>.json                per-file focused context
```

These files are updated by the VS Code extension on every save and rebuilt by
the CLI whenever a scan runs. They are portable — project-relative paths, no
local machine paths embedded.

---

## What Ripple Tracks

```
File dependency graph          every import and reverse import
Symbol and call edges          exported functions and who calls them
Blast radius                   all files affected by a change
Risk signals                   dangerous / caution / safe per file
Focused context                per-file summaries for AI agents
Change history                 structural changes since first install
Layer classification           logic / ui / handler / state / data / effect
Framework signals              Next.js, Vite, Turborepo, MobX, Prisma, Tailwind
Saved change intents           what the agent was allowed to do
Approval records               human gate decisions tied to intent fingerprints
```

---

## Language Support

Ripple is adapter-based.

| Language                | Status | Tracks                                                                                                  |
| ----------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| TypeScript / JavaScript | Deep   | Imports, reverse imports, exports, symbols, call edges, risk, focus context, staged drift               |
| Python                  | Basic  | Static imports, from-imports, functions, classes, methods, basic call signals, file-level staged checks |

The strongest current experience is JavaScript and TypeScript.

---

## Run the Product Proof

Verify the full end-to-end control contract from this checkout:

```bash
npm run proof:agent-control
```

This proves the complete loop: initialize repo, install CLI and MCP packages,
plan before edit, check after edit, catch drift, require human approval when
policy says so, and return the correct gate decision across CLI, CI, MCP host,
and MCP stdio.

Run focused proofs individually:

```bash
npm run proof:init
npm run proof:package-install
npm run proof:drift-control
npm run proof:approval-control
npm run proof:agent-handoff
npm run proof:ci-gate
npm run proof:mcp-gate
npm run proof:mcp-stdio-gate
npm run proof:mcp-package-install
npm run proof:publish-readiness
```

Before any public package release, run the full release gate:

```bash
npm run release:check
```

Release checklist:

```bash
npm run release:identity
npm run release:npm-preflight -- --live
npm run proof:release-check
npm run smoke:post-publish -- --live
```

The human publishing checklist lives in `RELEASE.md`.

---

## Validation

Ripple was tested on a local clone of `sindresorhus/ky`, a real-world TypeScript
HTTP library. For a targeted edit around `source/utils/merge.ts::mergeHeaders`,
Ripple surfaced a file-level blast radius larger than a direct text search found
and marked the edit as dangerous based on importer count.

Full validation: [docs/validation.md](docs/validation.md)
Demo video: [raushankcode.github.io/ripple](https://raushankcode.github.io/ripple)

_This validation does not imply endorsement by the ky project or its maintainers._

---

## Known Limitations

Ripple uses static analysis. It can miss or approximate:

- Dynamic imports and runtime dependency injection
- Decorator-driven framework behavior
- Complex aliasing and reflection
- Some generated code and framework routing conventions
- Runtime-only call paths

Ripple does not replace tests, typechecking, code review, or human judgment.

```
Ripple gives the agent a better map.
It does not guarantee the terrain is complete.
```

Language in Ripple output is intentionally careful: _may affect_, _likely used
by_, _possible blast radius_. These are signals, not proofs.

---

## Privacy

Ripple is entirely local.

- No account required
- No telemetry
- No cloud indexing
- No code upload
- No remote model call required by the engine

Your repo is scanned on your machine. Nothing leaves the local file system.

---

## Current Status

Public alpha.

What exists today:

- Core engine: `@getripple/core`
- CLI and CI interface: `@getripple/cli`
- MCP interface: `@getripple/mcp`
- VS Code extension: `rippleai.ripple`
- Plan/check/repair workflow with trust boundaries
- Intent drift and boundary drift detection
- Human approval gates
- GitHub Actions CI gate
- JavaScript and TypeScript deep support
- Python basic support

What is still early:

- Python depth beyond basic imports and symbols
- Framework-specific intelligence beyond detection
- Perfect semantic accuracy on complex aliasing
- Team policy tooling
- More language adapters

---

## Roadmap

Near-term:

- Improve `ripple_plan_context` context ranking quality
- Strengthen repair action specificity
- Add more regression fixtures
- Deepen Python adapter carefully

Later:

- Framework-specific adapters
- Better test-target mapping
- PR summaries
- More language adapters
- Richer architectural memory over time

---

## Contributing

```
https://github.com/raushankcode/ripple
```

Issues and pull requests welcome.

If Ripple misses an import, caller, framework pattern, or staged-change risk,
open an issue with a small reproduction. The most useful reports come with a
minimal repo and the exact command that produced the wrong result.

---

## License

MIT
