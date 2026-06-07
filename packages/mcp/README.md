# @getripple/mcp

Plan before edit. Check after edit. Catch drift. Tell the agent what to fix.

**MCP stdio server for Ripple's local drift-control gate for AI coding agents.**

`@getripple/mcp` lets MCP-compatible AI coding agents call Ripple directly from inside their workflow.

Use this package when you want an agent to ask Ripple:

```txt
What should I read before editing?
What boundary was approved?
Did my staged changes drift?
Can I continue?
What must I fix?
```

Ripple helps agents work inside a human-approved boundary:

```txt
plan before edit
save intent
check after edit
catch drift
tell the agent what to fix
continue / repair / human review
```

The MCP server is best when the AI agent should call Ripple tools directly.

For terminal, CI, and human-controlled workflows, use `@getripple/cli`.

---

## Setup

Add Ripple to any MCP-compatible client.

Replace the workspace path with the absolute path to your repo:

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

Path examples:

```txt
macOS / Linux: /Users/yourname/projects/myapp
Windows:       C:\\Users\\yourname\\projects\\myapp
```

No global install is required. `npx` fetches and runs the MCP server.

---

## Agent Workflow

Use the Ripple MCP tools in this order.

```txt
1. Check readiness
2. Plan before edit
3. Save the approved intent
4. Let the agent edit inside the boundary
5. Check after edit
6. Catch drift
7. Tell the agent what to fix
8. Continue, repair, or ask the human
```

---

## 1. Check Readiness

Call:

```txt
ripple_doctor
```

This checks whether the repo is ready for Ripple's saved-intent workflow.

If the result says `mustStop=true`, fix readiness before editing.

---

## 2. Plan Before Edit

Call:

```txt
ripple_plan_context
```

Pass:

```txt
task
target file
control mode
saveIntent: true
```

The tool returns:

```txt
readFirst
readIfNeeded
avoidInitially
allowedFiles
allowedSymbols
editableFiles
verificationTargets
risk
human gate state
```

When `saveIntent: true` is used, Ripple saves the human-approved boundary for later drift checks.

The saved intent becomes the trust boundary for the agent's work.

---

## 3. Check After Edit

After the agent edits code and the intended files are staged, call:

```txt
ripple_check_staged
```

This compares staged changes against the saved intent and reports:

```txt
intent drift
boundary drift
policy drift
contract drift
approval state
handoff
```

For changed files against a base branch, call:

```txt
ripple_check_changed
```

---

## 4. Ask the Gate

Call:

```txt
ripple_gate
```

`ripple_gate` is the compact continue/stop decision.

It answers one question:

```txt
Can the AI agent continue?
```

Example:

```json
{
  "status": "closed",
  "decision": "human-review",
  "canContinue": false,
  "mustStop": true,
  "needsHuman": true,
  "nextRequiredAction": "Ask the human to approve the crossed boundary before continuing."
}
```

Agent rule:

```txt
canContinue=true  -> continue only after required verification
mustStop=true     -> stop and follow fixNow
needsHuman=true   -> ask the human; do not self-approve
```

---

## 5. Repair Drift

Call:

```txt
ripple_repair_intent_drift
```

This tells the agent what to fix.

It may return:

```txt
which files to unstage
which symbols to undo
which contracts to review
which tests to run
when to create a wider human-approved intent
when to ask the human
```

If the task scope changed, the agent should not silently continue.

It should ask for a wider human-approved intent.

---

## Available Tools

```txt
ripple_get_agent_workflow      full agent workflow guide and output contracts
ripple_doctor                  check project readiness
ripple_plan_context            plan before editing and optionally save intent
ripple_check_staged            check staged files against saved intent
ripple_check_changed           check changed files against a git base ref
ripple_audit_change            audit a completed change for drift signals
ripple_gate                    compact continue/stop decision
ripple_get_approval_status     check whether a human gate is required
ripple_repair_intent_drift     get repair actions when drift is detected
ripple_get_focus               focused context for one file
ripple_get_blast_radius        files that depend on a target file
ripple_explain_policy          explain the active trust-boundary policy
ripple_get_recent_changes      recent architectural changes from history
```

---

## Example Agent Loop

A safe AI-agent workflow should look like this:

```txt
1. Call ripple_doctor
2. Call ripple_plan_context with saveIntent=true
3. Read only the suggested context
4. Edit only inside the approved boundary
5. Stage the intended changes
6. Call ripple_check_staged
7. Call ripple_gate
8. Continue, repair, or stop based on the gate
```

If `mustStop=true`, the agent must stop.

If `needsHuman=true`, the agent must ask the human.

If `canContinue=true`, the agent may continue only after required verification passes.

---

## Trust Boundaries

Ripple saves the freedom level the agent was given before editing and checks whether the agent stayed inside it after editing.

Supported control modes:

| Mode         | Boundary                                     |
| ------------ | -------------------------------------------- |
| `brainstorm` | No edits allowed. Suggest and explain only.  |
| `function`   | Only the approved symbol may change.         |
| `file`       | Only the selected file may change.           |
| `task`       | Files in the saved task plan may change.     |
| `pr`         | Full task scope. Human reviews before merge. |

Example function boundary:

```txt
file: src/auth.ts
symbol: refreshToken
mode: function
task: fix retry behavior
saveIntent: true
```

If `function` mode approves only `refreshToken` but the agent also changes `login`, Ripple stops the workflow and tells the agent what to fix.

---

## Gate Decisions

`ripple_gate` returns the decision an agent should obey.

Possible decisions include:

```txt
continue
repair
human-review
restore-readiness
```

Example stop decision:

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

---

## Run Manually

Run without installing:

```bash
npx -y @getripple/mcp --workspace /absolute/path/to/your/repo
```

Or install globally:

```bash
npm install -g @getripple/mcp
ripple-mcp --workspace /absolute/path/to/your/repo
```

---

## Protocol

The server communicates over stdio using JSON-RPC.

Only MCP protocol messages are written to stdout.

Non-protocol scan/cache output is kept off stdout so MCP clients can parse responses reliably.

This matters because MCP clients expect clean JSON-RPC messages on stdout.

---

## Local Files

Ripple may create local workflow state in the target repo:

```txt
.ripple/policy.json
.ripple/history.json
.ripple/intents/latest.json
.ripple/approvals/
.ripple/.cache/
```

Recommended git behavior:

```txt
commit: .ripple/policy.json
commit: .ripple/history.json if you want shared audit history
commit: .ripple/intents/ if your team wants saved intent records
ignore: .ripple/.cache/
```

`.ripple/.cache/` is machine cache.

Policy, history, intents, and approvals are durable workflow/audit state.

---

## CLI Relationship

The MCP package is for agents.

The CLI package is for humans, terminals, scripts, and CI.

Use CLI when you want:

```txt
manual commands
CI gates
local terminal workflows
release proofs
human-controlled checks
```

Use MCP when you want:

```txt
agents to call Ripple directly
structured tool responses
stdio JSON-RPC protocol
agent-readable handoff decisions
```

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

The MCP server does not require sending your code to a cloud service.

---

## Status

Public alpha.

Ripple is a local signal and gate.

It is not:

```txt
a sandbox
a test replacement
a typechecker replacement
a code review replacement
a CI replacement
a human judgment replacement
```

Ripple helps an agent know whether it stayed inside the work it was trusted to do.

---

## License

MIT
