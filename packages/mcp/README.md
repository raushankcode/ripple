# @getripple/mcp

**The agent-facing wire for Ripple's local authorization gate.**

`@getripple/mcp` lets MCP-compatible AI coding agents ask Ripple what they are
allowed to change, record verification evidence, and receive a final
continue/repair/human-review decision.

Use this package when you want the agent itself to call Ripple:

```txt
What should I read before editing?
What boundary is approved?
What verification is required?
Did my staged changes drift?
Can I continue?
What must I fix?
```

For Git hooks, CI, terminal audits, and repository initialization, use
`@getripple/cli`.

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

Before relying on MCP in a repo, initialize the local control layer:

```bash
npx -y @getripple/cli init
```

---

## Agent Workflow

Agents should use the Ripple MCP tools in this order:

```txt
1. ripple_doctor
   Check repo readiness.

2. ripple_plan_context
   Plan before editing and save the approved intent.

3. Agent edits code
   Stay inside allowed_files and allowed_symbols.

4. ripple_check_staged or ripple_check_changed
   Compare the real Git diff against the saved intent.

5. ripple_record_verification
   Record the result of required tests, typechecks, or manual verification.

6. ripple_gate
   Get the final continue, repair, human-review, or restore-readiness decision.

7. ripple_repair_intent_drift
   If the gate stops, get exact repair actions.
```

Agent rule:

```txt
canContinue=true  -> continue only after required verification
mustStop=true     -> stop and follow fixNow
needsHuman=true   -> ask the human; do not self-approve
```

Do not claim Ripple passed unless you called a Ripple MCP tool and the final
gate allowed the work to continue.

---

## Plan Before Edit

Call:

```txt
ripple_plan_context
```

Pass:

```txt
task
targetFile
controlMode
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
policyExplanation
human gate state
```

When `saveIntent: true` is used, Ripple saves the approved boundary for later
drift checks.

---

## Record Verification

After editing, the agent must run or report the narrowest relevant verification
target before final handoff when Ripple asks for it.

Call:

```txt
ripple_record_verification
```

Example reported evidence:

```txt
command: npm test -- tests/auth.test.ts
status: passed
note: auth retry tests passed after boundary-scoped change
```

Supported statuses:

```txt
passed
failed
skipped
unknown
```

Failed evidence blocks as repair. Skipped or unknown evidence requires human
review. Stale evidence must be rerun against the current changed files.

After recording verification evidence, call `ripple_gate` again so the final
decision includes that evidence.

---

## Ask The Gate

Call:

```txt
ripple_gate
```

`ripple_gate` is the compact continue/stop decision.

Example stop response:

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

If the agent crossed a function boundary, the gate can return evidence like:

```txt
Allowed:
  - src/auth.ts::refreshToken

Changed outside boundary:
  - symbol: src/auth.ts::login

Fix now:
  - Undo or replan unapproved symbol: src/auth.ts::login
  - Ask the human to approve a wider boundary before keeping these changes.
```

Ripple does not silently delete code. It stops the workflow and tells the agent
what must be fixed or when a human must review.

---

## Available Tools

```txt
ripple_get_agent_workflow      full agent workflow guide and output contracts
ripple_doctor                  check project readiness
ripple_get_intent_status       check whether saved intent is missing, active, closed, or invalid
ripple_plan_context            plan before editing and optionally save intent
ripple_check_staged            check staged files against saved intent
ripple_check_changed           check changed files against a git base ref
ripple_audit_change            audit a completed change for drift signals
ripple_gate                    compact continue/stop decision
ripple_get_approval_status     check whether a human gate is required
ripple_record_verification     record passed/failed/skipped/unknown verification evidence
ripple_repair_intent_drift     get repair actions when drift is detected
ripple_get_focus               focused context for one file
ripple_get_blast_radius        files that depend on a target file
ripple_explain_policy          explain the active trust-boundary policy
ripple_get_recent_changes      recent architectural changes from history
```

---

## Trust Boundaries

Ripple saves the freedom level the agent was given before editing and checks
whether the agent stayed inside it after editing.

| Mode | Agent is allowed to |
| --- | --- |
| `brainstorm` | Suggest and explain only. No edits. |
| `function` | Edit only the approved symbol. |
| `file` | Edit only the approved file. |
| `task` | Edit files in the saved task plan. |
| `pr` | Complete low-risk PR work for human review before merge. |

Example function boundary:

```txt
tool: ripple_plan_context
task: fix retry behavior
targetFile: src/auth.ts
symbol: refreshToken
controlMode: function
saveIntent: true
```

If `function` mode approves only `refreshToken` but the agent also changes
`login`, Ripple stops the workflow and tells the agent what to fix.

---

## Protocol

The server communicates over stdio using JSON-RPC.

Only MCP protocol messages are written to stdout. Non-protocol scan/cache output
is kept off stdout so MCP clients can parse responses reliably.

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

---

## CLI Relationship

The MCP package is for agents.

The CLI package is for humans, terminals, hooks, scripts, and CI.

Use MCP when you want:

```txt
agents to call Ripple directly
structured tool responses
stdio JSON-RPC protocol
agent-readable handoff decisions
verification evidence recorded into the saved intent
```

Use CLI when you want:

```txt
repo initialization
Git hook enforcement
CI gates
local terminal workflows
release proofs
human-controlled checks
```

---

## Language Support

| Language | Status |
| --- | --- |
| TypeScript / JavaScript | Deep support for imports, exports, symbols, callers, staged drift, and blast radius |
| Python | Basic support for imports, functions, classes, methods, and file-level staged checks |

Ripple uses static analysis. It can miss runtime-only behavior, dynamic imports,
reflection, decorators, generated code, and framework-specific magic.

---

## Privacy

Ripple runs locally.

```txt
No account required.
No telemetry.
No cloud indexing.
No code upload.
No remote model call required.
```

Your repository is scanned on your machine. The MCP server does not require
sending your code to a cloud service.

---

## Honest Limits

Ripple is deterministic infrastructure, not a magical AI wrapper.

- Ripple is not a coding agent.
- Ripple is not a sandbox.
- Ripple relies on agents actually calling the MCP tools.
- Ripple uses static analysis.
- Ripple does not replace your compiler, test suite, code review, or judgment.

---

## License

MIT
