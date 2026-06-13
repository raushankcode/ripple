# @getripple/cli

**The human, hook, and CI enforcer for Ripple's local authorization gate for AI coding agents.**

`@getripple/cli` initializes Ripple in a repository, installs the local Git
gate, powers CI checks, and gives humans a way to audit or debug agent work.

Most AI-agent workflows should use `@getripple/mcp` for planning and gate
decisions. The CLI is the enforcement surface around that workflow:

```txt
MCP plans.
Agent edits.
CLI hook gates the commit.
CLI CI gate audits the pull request.
Human reviews only when the boundary breaks.
```

---

## Install Once

Run this at the root of a Git repository:

```bash
npx -y @getripple/cli init
```

`ripple init` creates the local control layer:

- `.ripple/policy.json` with repo trust defaults from local project signals.
- `.github/workflows/ripple.yml` for pull request gating.
- `.ripple/.cache/` in `.gitignore`.
- A managed Ripple section in `AGENTS.md`, `CLAUDE.md`, or `.cursorrules`.
- Pre-commit and post-commit hook blocks that check active agent intents.

After that, connect the MCP server to your agent:

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

You should not need to manually run `ripple plan` for normal MCP-capable agent
work. The agent should call Ripple MCP tools before and after editing.

---

## What The CLI Enforces

When an active local intent exists, the pre-commit hook runs:

```bash
ripple gate --staged --intent latest --agent --strict
```

If the staged diff crosses the approved boundary, Ripple blocks the commit and
prints a review packet.

Example:

```txt
[RIPPLE STOP] Commit blocked by Ripple active-intent boundary.

Decision: human-review
Can continue: no
Must stop: yes

Allowed:
  - src/auth.ts::refreshToken

Changed outside boundary:
  - symbol: src/auth.ts::login

Fix now:
  - Undo or replan unapproved symbol: src/auth.ts::login
  - Ask the human to approve a wider boundary before keeping these changes.
```

Ripple does not silently delete code. It stops the workflow and tells the agent
or human exactly what crossed the boundary.

Human developers can intentionally bypass local hooks with:

```bash
git commit --no-verify
```

Ripple is a control system, not a prison.

---

## CI Gate

`ripple init` writes a GitHub Actions workflow at:

```txt
.github/workflows/ripple.yml
```

You can also generate or refresh it explicitly:

```bash
ripple init-ci
```

Run the CI gate manually:

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
verification gaps
```

It exits non-zero when work should not merge.

---

## Readiness And Debugging

Manual CLI usage is not the main product loop. It is available for humans,
scripts, hooks, CI, and debugging.

```bash
npm install -g @getripple/cli
ripple doctor   # check repository readiness
ripple gate     # ask the compact continue/stop question
ripple audit    # generate a fuller review packet
ripple history  # inspect recent architectural history
```

Useful debugging commands:

```txt
ripple scan        refresh local graph data
ripple focus       show focused context for a file
ripple blast       show files affected by a target file
ripple symbols     show exported symbols for a file
ripple verify      record verification evidence on an intent
ripple repair      get concrete repair actions after drift
```

Use these when you are inspecting a failure, wiring automation, or building a
custom workflow. They are not meant to be busywork for every normal agent edit.

---

## Trust Boundaries

Ripple stores the freedom level the agent was given before editing.

| Mode | Agent is allowed to |
| --- | --- |
| `brainstorm` | Suggest and explain only. No edits. |
| `function` | Edit only the approved symbol. |
| `file` | Edit only the approved file. |
| `task` | Edit files in the saved task plan. |
| `pr` | Complete low-risk PR work for human review before merge. |

When an MCP agent calls `ripple_plan_context`, it chooses one of these control
modes and saves the active intent. The CLI hook and CI gate then enforce that
saved boundary against the real Git diff.

---

## Verification Evidence

Ripple can treat missing, failed, skipped, or stale verification as a stop
condition.

From the CLI, record verification with:

```bash
ripple verify --run "npm test -- tests/auth.test.ts" --intent latest
```

or report evidence from an external runner:

```bash
ripple verify --command "npm test -- tests/auth.test.ts" --status passed --intent latest
```

After verification evidence is recorded, run the gate again so the final
continue/stop decision includes that evidence.

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
AGENTS.md / CLAUDE.md / .cursorrules
```

Recommended git behavior:

```txt
commit: .ripple/policy.json
commit: .github/workflows/ripple.yml
commit: agent instruction files if your team wants shared agent rules
commit: .ripple/intents/ only if your team wants saved intent records
ignore: .ripple/.cache/
```

`.ripple/.cache/` is machine cache.

---

## Relationship To MCP

Use `@getripple/mcp` when you want agents to call Ripple directly.

Use `@getripple/cli` when you want:

```txt
repo initialization
Git hook enforcement
CI gates
terminal audits
debugging commands
release proofs
```

The two packages are meant to work together.

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

Your repository is scanned on your machine.

---

## Honest Limits

Ripple is deterministic infrastructure, not a magical AI wrapper.

- Ripple is not a coding agent.
- Ripple is not a sandbox.
- Ripple relies on standard Git hooks, which humans can intentionally bypass.
- Ripple uses static analysis.
- Ripple does not replace your compiler, test suite, code review, or judgment.

---

## License

MIT
