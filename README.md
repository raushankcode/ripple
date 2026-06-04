# Ripple - Local AI-Agent Workflow Engine

Ripple helps AI coding agents make safer changes in real codebases.

It does four practical things:

```txt
Plan before edit.
Check after edit.
Catch drift.
Tell the agent exactly what to fix.
```

Ripple is not trying to be a magical codebase brain. It is a local workflow
engine that gives humans and AI agents fresh architectural context at the moment
they are about to change code.

The honest product sentence:

> Ripple is a local AI-agent workflow engine that plans before edit, checks
> after edit, catches drift, and tells the agent what to fix.

---

## Current Status

Ripple is in public alpha.

What exists today:

- A pure local core engine: `@getripple/core`
- A terminal and CI interface: `@getripple/cli`
- An MCP interface for AI agents: `@getripple/mcp`
- A VS Code extension as the human interface
- Generated `.ripple/` workflow files for portable agent context
- Deep JavaScript and TypeScript static analysis
- Basic Python static analysis

What is still early:

- First-release onboarding and distribution polish
- Python depth beyond basic imports, symbols, and call signals
- Framework-specific intelligence
- Perfect semantic accuracy
- Team/cloud features

Ripple is useful now, but it should be treated as a strong local safety signal,
not mathematical proof.

---

## The Problem

AI coding agents can search your repo, read files, and write code.

The hard part is not whether the model can produce code. The hard part is:

```txt
Does the agent understand what this change may affect?
```

In real projects, agents often miss:

- Shared utilities with many importers
- Public API files
- Symbols with many callers
- Tests that should be checked after a change
- Files that were only meant to be read as context, not edited
- Drift from the original task after several edits

That is the problem Ripple is built around.

---

## What Ripple Does

Ripple scans a repo locally and builds architectural context:

- File dependency graph
- Reverse imports
- Exported symbols
- Basic call edges
- Blast radius
- File risk: `safe`, `caution`, `dangerous`
- Verification targets
- Token-budgeted read plans
- Saved change intents
- Saved agent control boundaries
- Staged-change drift checks
- Boundary drift checks
- Repair actions for agents
- Local workflow files under `.ripple/`

The key idea is simple:

```txt
Before editing, Ripple tells the agent what to read.
After editing, Ripple checks whether the staged change still matches the plan.
```

---

## Core Workflow

This is the workflow Ripple is built for:

```bash
ripple init
```

`ripple init` writes the default local trust policy and GitHub CI gate:

```txt
.ripple/policy.json
.github/workflows/ripple.yml
```

It is safe to run again. Existing setup files are left alone unless you pass
`--force`.

```bash
ripple plan --file src/auth.ts --task "change token refresh behavior" --mode file --agent --save
```

Ripple returns a focused plan:

```txt
readFirst:
  - src/auth.ts
  - src/session.ts

readIfNeeded:
  - tests/auth.test.ts

avoidInitially:
  - docs/
  - unrelated UI files

risk: caution
editableFiles:
  - src/auth.ts
controlMode: file
humanGate: required-before-edit
allowedFiles:
  - src/auth.ts
contextFiles:
  - src/session.ts
verificationTargets:
  - tests/auth.test.ts
```

If `humanGate` is required, the human records approval after reviewing the plan:

```bash
ripple approve --intent latest --gate before-risky-edit
```

Then the agent edits only the planned editable files.

After staging:

```bash
git add src/auth.ts
ripple check --staged --agent --intent latest
```

Ripple checks the staged change against the saved intent.

If the agent changed an unplanned file, edited a context-only file, touched an
unexpected symbol, crossed the saved control boundary, or created contract risk,
Ripple reports drift.

The agent should read the `handoff` block first. It is the compact final command:
continue, audit, repair, restore readiness, or ask the human.

Then:

```bash
ripple repair --agent --intent latest
```

Ripple returns concrete repair actions, such as:

```txt
unstage-file: src/session.ts was context-only
review-symbol: src/auth.ts::refreshToken changed outside the plan
review-contract: public contract may have changed
verify: run tests/auth.test.ts
replan: create a new Ripple plan if the task scope has changed
```

This is the core product: plan, approve if required, edit, check, obey handoff,
repair or audit.

---

## Trust Boundaries

Ripple now saves the freedom level the agent was given before editing:

This is implemented in the CLI, MCP tools, and core staged-check validation.

```bash
ripple plan --file src/auth.ts --symbol refreshToken --task "fix retry behavior" --mode function --agent --save
```

Supported modes:

```txt
brainstorm -> no edits allowed
function   -> only approved symbols/functions
file       -> only the selected file
task       -> planned task files
pr         -> low-risk PR workflow, still human-reviewed before merge
```

After staging, Ripple checks both:

```txt
intent drift   -> did the edit leave the task plan?
boundary drift -> did the edit cross the human-selected freedom level?
```

Those checks are part of the current engine, not a future roadmap promise.

If function mode allowed only `src/auth.ts::refreshToken` but the agent also
changed `src/auth.ts::login`, `ripple check` reports `boundary_verdict: DANGER`
or `DRIFT` and `ripple repair` tells the agent exactly what symbol to undo or
which wider boundary needs human approval.

You can run the product-level agent-control proof from this checkout:

```bash
npm run proof:agent-control
```

Before a public package release, run the release gate:

```bash
npm run release:check
```

That command runs the product proof plus release checklist validation. The human
publishing checklist lives in `RELEASE.md`. To review the public product
identity without running the full release gate:

```bash
npm run release:identity
```

To run the read-only npm registry preflight before publishing:

```bash
npm run release:npm-preflight -- --live
```

You can also call the full gate as:

```bash
npm run proof:release-check
```

After packages are published, verify the public install path with:

```bash
npm run smoke:post-publish -- --live
```

That single command proves the current end-to-end control contract:

```txt
initialize repo setup
install packed CLI into a fresh repo
install packed MCP stdio server into a fresh repo
verify npm package metadata and pack contents
plan before edit
check after edit
catch drift
require human approval when policy says so
return continue / repair / human-review / restore-readiness
prove the same gate language in CLI, CI, MCP host, and MCP stdio
```

You can also run the focused proofs one by one:

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

The drift proof creates a temporary repo, saves a function-only intent for
`src/auth.ts::refreshToken`, stages an accidental edit to `src/auth.ts::login`,
and proves that Ripple blocks the change with a repair action.

The approval proof creates a human-gated payment edit, proves audit blocks before
approval, proves audit and CI pass after approval, then proves the approval goes
stale when the saved intent changes.

The package-install proofs pack `@getripple/core`, `@getripple/cli`, and
`@getripple/mcp`, install them into clean consumer repos, then prove the installed
CLI and installed MCP stdio server can reach the same readiness and gate
contract.

The publish-readiness proof validates the npm-facing surface for
`@getripple/core`, `@getripple/cli`, and `@getripple/mcp`: package metadata, Node engine,
public publish config, README install commands, entry points, binaries, MCP
published config, and `npm pack --dry-run` contents.

The full product proof also proves the compact gate language across CLI, CI,
MCP host, and real MCP stdio. The focused drift, approval, handoff, CI, and MCP
gate proofs also run inside `npm run test:cli` and `npm run test:mcp`, while the
package-install and publish-readiness proofs stay available as launch-readiness
checks and run inside `npm run proof:agent-control`.

You can also save repo-level trust defaults:

```bash
ripple init
ripple policy init
ripple policy explain --file src/auth.ts
```

`ripple init` creates `.ripple/policy.json` and `.github/workflows/ripple.yml`
together. `ripple policy init` only creates the policy file.

The policy file is where a repo can define default control mode, sensitive path
rules, and human gates for AI-agent edits. `ripple plan`
uses that policy when saving a change intent and prints `policy_source`,
`policy_matches`, and `policy_explanation` in agent output. `ripple plan --json`
also returns `policyExplanation` for machine-readable agent automation.
Saved intent files also keep that `policyExplanation` snapshot, and `check` /
`repair` surface it again as the plan-time trust boundary. If the effective
policy for that target changes after the plan is saved, Ripple reports
`policyDrift` and asks for human review before continuing. `ripple policy
explain` shows the matching rule, effective mode, policy risk, and human gate
before an agent starts work.

---

## Drift Verdict Contract

When Ripple checks staged changes against a saved intent, it now returns one
clear verdict for humans and agents:

```txt
PASS   -> continue
DRIFT  -> fix-before-commit
DANGER -> stop-and-ask-human
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

This is the heart of Ripple's narrow direction:

```txt
You planned X.
You edited Y.
This passes / drifted / is dangerous.
Here is exactly what to do next.
```

---

## Agent Handoff Contract

For AI agents, the most important field is now `handoff`.

`handoff` is returned by:

```txt
ripple check --staged --json --intent latest
ripple repair --json --intent latest
ripple audit --json --intent latest
ripple_check_staged
ripple_repair_intent_drift
ripple_audit_change
```

Agents should read `handoff` first, then use `driftVerdict`,
`boundaryVerdict`, `policyDrift`, `readinessDrift`, `approvalStatus`, and
`repairPlan` as evidence.

Shape:

```json
{
  "handoff": {
    "protocol": "ripple-agent-handoff",
    "canContinue": false,
    "mustStop": true,
    "needsHuman": true,
    "decision": "human-review",
    "nextRequiredPhase": "approval_gate",
    "nextRequiredAction": "Stop editing and ask the human to record approval with ripple approve before continuing.",
    "summary": "Record or verify human approval for the saved gate before continuing.",
    "why": ["Human approval is required for this saved intent."],
    "fixNow": ["Ask the human to approve the saved intent gate."],
    "askHuman": ["Review the saved plan and approve the before-risky-edit gate."],
    "commands": {
      "doctor": [],
      "plan": [],
      "check": [],
      "audit": [],
      "repair": [],
      "approve": [
        "ripple approval --intent latest --agent",
        "ripple approve --intent latest --gate before-risky-edit"
      ],
      "unstage": [],
      "verify": []
    }
  }
}
```

The agent rule is simple:

```txt
handoff.mustStop=true  -> stop and follow handoff.fixNow / handoff.askHuman
handoff.needsHuman=true -> do not self-approve; ask the human
handoff.canContinue=true -> continue only after the listed verify commands
```

---

## Why This Matters

Most AI coding workflows rely on one of two weak patterns:

1. Give the model a large prompt and hope it chooses the right files.
2. Let the model edit first, then manually inspect the damage.

Ripple adds a local control loop:

```txt
repo structure -> focused plan -> bounded edit -> staged check -> repair plan
```

It helps an agent avoid wasting context on irrelevant files and helps a human
review whether the agent stayed inside the intended scope.

---

## Live Agent Workflow Context

Ripple can generate and refresh local agent workflow context from the repo.

The generated files live in `.ripple/`:

```txt
.ripple/
  WORKFLOW.md
  history.json
  intents/
    latest.json
  approvals/
    <intent-id>/
      before-risky-edit.json
  .cache/
    context.json
    context.files.json
    context.symbols.json
    focus/
      <file>.json
```

The VS Code extension keeps this context updated as the project changes.

The CLI and MCP server can rescan and return fresh context whenever an agent
starts a task or checks staged changes.

Honest wording:

```txt
Ripple keeps local workflow context fresh from static repo analysis.
```

Not honest wording:

```txt
Ripple perfectly understands every runtime effect of every edit.
```

Ripple is intentionally careful with words like `may affect`, `likely used by`,
and `possible blast radius`.

---

## Interfaces

Ripple is built as one engine with multiple interfaces.

```txt
packages/core   -> local architectural context engine
packages/cli    -> terminal and CI interface
packages/mcp    -> agent-queryable MCP interface
src/extension.ts -> VS Code human interface
```

The engine is the product. The interfaces are how humans and agents use it.

### Core

`@getripple/core` is the pure Node.js engine.

It scans the repo, builds the graph, plans context, validates staged changes,
and creates repair actions.

### CLI

`@getripple/cli` is for terminal, CI, and local agent workflows.

Main commands:

```bash
ripple init
ripple doctor
ripple doctor --agent
ripple agent
ripple scan .
ripple focus src/auth.ts
ripple blast src/auth.ts
ripple imports src/auth.ts
ripple importers src/auth.ts
ripple symbols src/auth.ts
ripple callers src/auth.ts::validateToken
ripple history --last 10
ripple plan --file src/auth.ts --task "change auth behavior" --agent --save
ripple check --staged --agent --intent latest
ripple check --changed --base origin/main --strict
ripple audit --agent --intent latest
ripple approval --intent latest --agent
ripple approve --intent latest --gate before-risky-edit
ripple repair --agent --intent latest
ripple ci --base origin/main --intent latest --github-annotations
ripple init-ci
ripple policy init
ripple policy explain --file src/auth.ts
```

In CI, `--github-annotations` emits GitHub errors for intent drift, boundary
drift, contract drift, and policy drift. If repo policy changed after the saved
intent was created, the step summary includes the changed policy fields. CI uses
the same audit decision as `ripple audit` and `ripple_audit_change`: `pass`,
`repair-required`, or `human-review-required`.

If a saved plan has a human gate, record the review locally before continuing:

```bash
ripple approval --intent latest --agent
ripple approve --intent latest --gate before-risky-edit --reason "plan reviewed"
```

The approval is stored under `.ripple/approvals/` and is tied to the saved
intent fingerprint, so changing the intent makes the approval stale.

### MCP

`@getripple/mcp` lets MCP-compatible agents ask Ripple directly instead of reading
generated files by hand.

Available tools:

```txt
ripple_get_agent_workflow
ripple_doctor
ripple_get_focus
ripple_get_blast_radius
ripple_explain_policy
ripple_plan_context
ripple_check_staged
ripple_check_changed
ripple_audit_change
ripple_get_approval_status
ripple_repair_intent_drift
ripple_get_recent_changes
```

`ripple_plan_context` includes `policyExplanation`, so agents can get the read
plan and the repo trust boundary in one call.
`ripple_audit_change` returns the compact post-edit report: saved intent,
current policy, drift verdict, boundary verdict, repair plan, approval state,
and final `handoff`.
Audit, repair, and staged-check responses include `handoff`, so an agent can see
whether to ask for approval, repair, restore readiness, run audit, or finish
without guessing.
`ripple_doctor` reports enforcement readiness: advisory, local drift-check
ready, or CI-gate ready.
In CLI mode, `ripple doctor --agent` prints the same readiness signal as a
compact `RIPPLE_DOCTOR` handoff for agents.
`ripple_get_agent_workflow` also returns a machine-readable runtime contract:
ordered phases, source-of-truth calls, stop conditions, and proceed conditions
for any MCP or CLI-driven coding agent.
Use `ripple_explain_policy` only when an agent needs the trust boundary without
creating a task plan.

### VS Code

The VS Code extension is the human interface.

It provides:

- Impact Lens
- caller counts
- focus files
- generated `.ripple/WORKFLOW.md`
- copyable agent prompts
- setup panel for agent instruction files

VS Code is still supported, but Ripple is no longer only a VS Code extension.

---

## Install

Use the CLI directly from npm:

```bash
npx -y @getripple/cli doctor
npx -y @getripple/cli init
npx -y @getripple/cli plan --file src/auth.ts --task "change auth behavior" --agent --save
npx -y @getripple/cli check --staged --agent --intent latest
```

Or install it globally:

```bash
npm install -g @getripple/cli
ripple doctor
```

For MCP-compatible agents:

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

Developers building on top of Ripple can install the engine directly:

```bash
npm install @getripple/core
```

## Use From Source

For local development of Ripple itself:

```bash
git clone https://github.com/raushankcode/ripple.git
cd ripple
npm install
npm run build:core
npm run build:cli
npm run build:mcp
```

Run the CLI from this checkout:

```bash
node packages/cli/dist/index.js doctor
node packages/cli/dist/index.js agent
node packages/cli/dist/index.js plan --file src/auth.ts --task "change auth behavior" --agent --save
node packages/cli/dist/index.js approval --intent latest --agent
node packages/cli/dist/index.js approve --intent latest --gate before-risky-edit
node packages/cli/dist/index.js check --staged --agent --intent latest
node packages/cli/dist/index.js audit --agent --intent latest
node packages/cli/dist/index.js repair --agent --intent latest
```

Run the MCP server from this checkout:

```bash
node packages/mcp/dist/server.js --workspace /absolute/path/to/your/repo
```

Example local MCP config:

```json
{
  "mcpServers": {
    "ripple": {
      "command": "node",
      "args": [
        "/absolute/path/to/ripple/packages/mcp/dist/server.js",
        "--workspace",
        "/absolute/path/to/your/repo"
      ]
    }
  }
}
```

---

## VS Code Extension

The VS Code extension can be installed from the Marketplace:

```bash
code --install-extension rippleai.ripple
```

Open a JavaScript or TypeScript project and wait for:

```txt
Ripple: ready
```

Then use:

- Ripple sidebar
- Impact Lens
- CodeLens caller counts
- `Ripple: Copy Agent Prompt`
- `Ripple: Show AI Setup Panel`

The extension writes and refreshes `.ripple/` context locally.

---

## Agent Protocol

A good agent workflow with Ripple:

```txt
1. Run ripple init once per repo.
2. Run ripple doctor.
3. Run ripple plan with a target file and task.
4. Read only the planned high-value files first.
5. Edit only editableFiles unless the task must expand.
6. Stage changes.
7. Run ripple check --staged --intent latest.
8. If drift is found, run ripple repair --intent latest.
9. Fix, replan, or ask the human before widening the scope.
```

This protocol is designed to protect the human builder's intent.

The agent should not silently turn a focused task into a broad refactor.

---

## What Ripple Can Catch After Editing

Ripple can check staged or changed files and report:

- Unplanned files changed
- Context-only files edited
- Unplanned symbols changed
- Possible public contract changes
- Dangerous files touched
- Verification targets to run
- Files with many importers
- Drift from the saved change intent

It can then produce a repair plan:

- `verify`
- `unstage-file`
- `review-symbol`
- `review-contract`
- `replan`
- `create-intent`

This is the practical after-edit value.

---

## Language Support

Ripple is adapter-based.

Current support:

```txt
JavaScript / TypeScript
  Status: deep adapter
  Extensions: .ts, .tsx, .js, .jsx
  Tracks: imports, reverse imports, exports, symbols, basic call edges,
          risk, focus context, staged drift

Python
  Status: basic adapter
  Extensions: .py
  Tracks: static imports, from-imports, functions, classes, methods,
          basic call signals, file-level staged checks

Generic files
  Status: limited
  Tracks: repository/config signals when useful
```

Ripple should not claim support for every tech stack yet.

The long-term architecture can support many stacks through adapters, but the
current strongest experience is JavaScript and TypeScript.

---

## Privacy

Ripple is local-first.

- No account required
- No telemetry
- No cloud indexing
- No hidden code upload
- No remote model call required by the engine

Your repo is scanned on your machine.

---

## Known Limitations

Ripple uses static analysis.

It can miss or approximate:

- Dynamic imports
- Runtime dependency injection
- Decorator-driven framework behavior
- Complex aliasing
- Reflection
- Some generated code
- Some framework routing conventions
- Runtime-only call paths

Ripple does not replace tests, typechecking, code review, or human judgment.

The correct mindset is:

```txt
Ripple gives the agent a better map.
It does not guarantee the terrain is complete.
```

---

## Validation Example

Ripple was tested on a local clone of the open-source `sindresorhus/ky`
TypeScript project.

For a temporary edit around:

```txt
source/utils/merge.ts::mergeHeaders
```

manual search found a small number of direct text matches, while Ripple surfaced
a larger file-level blast radius from import relationships and marked the edit
as dangerous.

Full validation details:

[docs/validation.md](docs/validation.md)

Demo video:

[raushankcode.github.io/ripple/demo-video.mp4](https://raushankcode.github.io/ripple/demo-video.mp4)

![Ripple demo](resources/ripple-value-demo.gif)

This validation does not imply endorsement by the Ky project or maintainers.

---

## Roadmap

Near-term:

- Run post-publish smoke checks against the public npm packages
- Improve first-run onboarding from VS Code to CLI and MCP
- Improve `ripple_plan_context` quality with better ranking
- Strengthen staged repair actions
- Add more regression fixtures
- Improve Python adapter depth carefully

Later:

- Framework-specific adapters
- Better test-target mapping
- PR summaries
- More languages
- Richer architectural memory over time

---

## Contributing

Repository:

```txt
https://github.com/raushankcode/ripple
```

Issues and pull requests are welcome.

If Ripple misses an import, caller, framework pattern, or staged-change risk,
please open an issue with a small reproduction.

---

## License

MIT
