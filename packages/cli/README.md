# @getripple/cli

Plan before edit. Check after edit. Catch drift. Tell the agent what to fix.

**Terminal and CI interface for Ripple's local drift-control gate for AI coding agents.**

`@getripple/cli` is the command-line interface for Ripple. Use it when you want to plan before an AI coding agent edits, check after edit, catch drift, and tell the agent what to fix.

Ripple helps agents work inside a human-approved boundary:

```txt
plan before edit
save intent
check after edit
catch drift
tell the agent what to fix
continue / repair / human review
```

The CLI is best for:

```txt
terminal workflows
CI gates
release checks
local repo scanning
human-controlled agent workflows
```

For MCP-compatible AI agents, use `@getripple/mcp`.

---

## 60-Second Start

Initialize Ripple in a repo:

```bash
npx -y @getripple/cli init
```

Create a saved intent before editing:

```bash
npx -y @getripple/cli plan \
  --file src/auth.ts \
  --task "refactor token handling" \
  --mode file \
  --agent \
  --save
```

Let your AI coding agent edit the code, then stage the intended files:

```bash
git add src/auth.ts
```

Ask Ripple whether work may continue:

```bash
npx -y @getripple/cli gate --intent latest
```

If the agent stayed inside the saved plan, Ripple returns:

```txt
continue
```

If the agent crossed the boundary, Ripple returns:

```txt
repair
```

or:

```txt
human-review
```

with the exact reason and next action.

---

## Why This Exists

AI coding agents can edit quickly.

The hard question is not only:

```txt
Is the code good?
```

The deeper question is:

```txt
Was the agent allowed to make this change?
```

Ripple keeps a local record of what the human approved, then checks the actual staged changes against that approval.

Example:

```txt
Approved:
- src/auth.ts

Agent changed:
- src/auth.ts
- src/payments/webhook.ts

Ripple:
human-review — agent changed a file outside the approved boundary
```

Ripple does not replace tests, code review, or human judgment.

Ripple checks whether the agent stayed inside the work it was trusted to do.

---

## Install

Use with `npx`:

```bash
npx -y @getripple/cli doctor
```

Or install globally:

```bash
npm install -g @getripple/cli
```

Then run:

```bash
ripple init
ripple doctor
ripple plan --file src/auth.ts --task "refactor token handling" --mode file --agent --save
ripple check --staged --agent --intent latest
ripple gate --intent latest
```

---

## Core Workflow

```txt
1. Initialize Ripple
2. Plan before edit
3. Save the human-approved intent
4. Let the agent edit
5. Stage the intended files
6. Check after edit
7. Catch drift
8. Tell the agent what to fix
9. Continue, repair, or ask the human
```

---

## 1. Initialize

```bash
ripple init
```

Creates local workflow and CI files:

```txt
.ripple/policy.json             repo trust defaults
.github/workflows/ripple.yml    GitHub Actions gate
.gitignore                      .ripple/.cache/ hygiene
.ripple/.cache/graph.cache.json local graph cache after scan
```

Normal CLI `scan`, `check`, and `gate` runs stay lean. They do not dump broad agent files unless you ask.

Generate file-based agent instructions explicitly:

```bash
ripple workflow
```

MCP-capable agents should prefer `@getripple/mcp` instead of reading generated files.

---

## 2. Plan Before Edit

```bash
ripple plan \
  --file src/auth.ts \
  --task "refactor token handling" \
  --mode file \
  --agent \
  --save
```

This creates a saved intent.

The saved intent tells Ripple:

```txt
what task was approved
which file or symbol may change
which files are context only
which tests should be verified
which human gate applies
```

The saved intent becomes the trust boundary for the agent's work.

---

## 3. Check After Edit

After the agent edits code and you stage the intended files:

```bash
git add src/auth.ts
ripple check --staged --agent --intent latest
```

For the compact continue/stop decision:

```bash
ripple gate --intent latest
```

`ripple gate` answers one question:

```txt
Can the agent continue?
```

---

## 4. Catch Drift

Ripple checks two forms of drift:

```txt
intent drift    -> did the edit leave the saved task?
boundary drift  -> did the edit cross the chosen freedom level?
```

If the agent stayed inside the approved work, Ripple allows the workflow to continue.

If the agent crossed the approved work, Ripple returns a repair or human-review decision.

---

## 5. Tell the Agent What to Fix

When drift is found, Ripple gives the agent a concrete handoff:

```txt
what changed
why it is risky
what must be undone
what needs verification
when to ask the human
```

For detailed repair actions:

```bash
ripple repair --agent --intent latest
```

Repair may tell the agent to:

```txt
unstage an unplanned file
undo a symbol outside the approved boundary
review a possible public contract change
run a verification target
create a wider intent if the task expanded
ask the human for approval
```

---

## Trust Boundaries

Choose how much freedom the agent gets when you plan:

| Mode         | Boundary                                     |
| ------------ | -------------------------------------------- |
| `brainstorm` | No edits allowed. Suggest and explain only.  |
| `function`   | Only the approved symbol may change.         |
| `file`       | Only the selected file may change.           |
| `task`       | Files in the saved task plan may change.     |
| `pr`         | Full task scope. Human reviews before merge. |

Example function boundary:

```bash
ripple plan \
  --file src/auth.ts \
  --symbol refreshToken \
  --task "fix retry behavior" \
  --mode function \
  --agent \
  --save
```

If `function` mode approves only `refreshToken` but the agent also changes `login`, Ripple stops the workflow and tells the agent what to fix.

---

## Gate Decisions

`ripple gate` is the command an agent or CI system should obey:

```bash
ripple gate --intent latest
```

Example output:

```txt
STOP: agent crossed approved function boundary.

Allowed:
- src/auth.ts::refreshToken

Changed outside boundary:
- src/auth.ts::login

Fix:
- undo src/auth.ts::login
- or create a wider human-approved intent
```

Machine-readable output includes:

```json
{
  "status": "closed",
  "decision": "human-review",
  "canContinue": false,
  "mustStop": true,
  "needsHuman": true,
  "why": ["Changed symbol outside approved boundary: src/auth.ts::login"],
  "fixNow": ["Undo src/auth.ts::login or replan with human approval."]
}
```

Agent rule:

```txt
canContinue=true  -> continue after required verification
mustStop=true     -> stop and follow fixNow
needsHuman=true   -> ask the human; do not self-approve
```

---

## Check and Repair

For detailed drift information:

```bash
ripple check --staged --agent --intent latest
```

For concrete repair actions:

```bash
ripple repair --agent --intent latest
```

Use `check` when you want evidence.

Use `gate` when you want a compact decision.

Use `repair` when the agent needs exact next actions.

---

## CI Gate

Generate the workflow:

```bash
ripple init-ci
```

Run the gate in CI:

```bash
ripple ci --base origin/main --intent latest --github-annotations
```

The CI gate emits GitHub annotations for:

```txt
intent drift
boundary drift
contract drift
policy drift
readiness drift
```

It exits non-zero when work must not merge.

---

## Useful Commands

```txt
ripple init              initialize policy, CI, git hygiene, and graph cache
ripple doctor            check project readiness
ripple scan              refresh the local graph cache
ripple workflow          generate .ripple/WORKFLOW.md for file-based agents
ripple plan              plan context before editing and optionally save intent
ripple check             check staged or changed files against saved intent
ripple audit             audit a completed change for drift signals
ripple repair            get concrete repair actions
ripple gate              compact continue/stop decision
ripple approval          check saved human gate status
ripple approve           record human approval for a gate
ripple ci                run the CI gate against a base ref
ripple agent             print the agent workflow guide
ripple focus             show focused context for a file
ripple blast             show files affected by a target file
ripple imports           show files imported by a target file
ripple importers         show files that import a target file
ripple symbols           show exported symbols for a file
ripple callers           show callers of a symbol
ripple history           show recent architectural history
ripple policy init       create repo trust policy
ripple policy explain    explain active policy for a file
```

---

## Example Agent Loop

A safe CLI-based agent workflow should look like this:

```txt
1. Run ripple doctor
2. Run ripple plan with --save
3. Read the suggested context
4. Edit only inside the approved boundary
5. Stage the intended files
6. Run ripple check --staged
7. Run ripple gate
8. Continue, repair, or stop based on the gate
```

If `mustStop=true`, the agent must stop.

If `needsHuman=true`, the agent must ask the human.

If `canContinue=true`, the agent may continue only after required verification passes.

---

## Local Files

Ripple may create local workflow state in the target repo:

```txt
.ripple/policy.json
.ripple/history.json
.ripple/intents/latest.json
.ripple/approvals/
.ripple/.cache/
.github/workflows/ripple.yml
```

Recommended git behavior:

```txt
commit: .ripple/policy.json
commit: .github/workflows/ripple.yml
commit: .ripple/intents/ only if your team wants saved intent records
ignore: .ripple/.cache/
```

`.ripple/.cache/` is machine cache.

Policy, CI, intents, and approvals are workflow/audit state.

---

## MCP

For MCP-compatible AI agents, use:

```bash
npx -y @getripple/mcp --workspace /absolute/path/to/your/repo
```

The CLI is best for terminal, CI, scripts, and human-controlled workflows.

The MCP server is best when the agent should call Ripple tools directly.

---

## Language Support

Strongest today:

```txt
JavaScript
TypeScript
```

Basic support:

```txt
Python imports
Python functions
Python classes
Python methods
file-level staged checks
```

---

## Privacy

Ripple runs locally.

```txt
No account required
No telemetry
No cloud indexing
No code upload
No remote model call required
```

Your repo is scanned on your machine.

---

## Status

Public alpha.

Ripple is a strong local signal and gate.

It is not:

```txt
a sandbox
a test replacement
a typechecker replacement
a code review replacement
a CI replacement
a human judgment replacement
```

Ripple helps you check whether an AI coding agent stayed inside the work it was trusted to do.

---

## License

MIT
