# Ripple

**A local authorization gate for AI coding agents.**

Ripple is a local authorization gate for AI coding agents that defines what an
agent may change, checks the real Git diff, and returns continue, repair, or
human review.

In practice, Ripple saves the approved boundary and turns the actual Git diff
into a clear decision:

```txt
CONTINUE
REPAIR
HUMAN REVIEW
```

It runs locally in your repository. No account, no telemetry, no code upload,
no cloud indexing, and no remote model call required.

Ripple tells AI coding agents when they may continue, when they must repair,
and when a human must review before work proceeds.

```txt
Plan before edit.
Save intent.
Choose a trust boundary.
Check after edit.
Catch drift.
Continue / stop / human review.
```

These are signals, not proofs. Ripple does not replace tests, typechecking,
code review, or human judgment.

[![npm cli](https://img.shields.io/npm/v/@getripple/cli.svg)](https://www.npmjs.com/package/@getripple/cli)
[![npm mcp](https://img.shields.io/npm/v/@getripple/mcp.svg)](https://www.npmjs.com/package/@getripple/mcp)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

![Ripple gate demo](resources/ripple-gate-demo.gif)

## The Problem

AI coding agents can plan, edit files, stage changes, and prepare pull
requests. That speed is useful. The trust problem is deeper:

```txt
Was the agent authorized to make this change?
```

Example:

```txt
Approved boundary:
  src/auth.ts::refreshToken

Actual staged changes:
  src/auth.ts::refreshToken
  src/auth.ts::login

Ripple:
  HUMAN REVIEW. The agent crossed the approved function boundary.
```

Most tools focus on helping the agent write code. Ripple focuses on deciding
whether the agent may continue, must repair, or must stop for human review.

## What Ripple Blocks

Ripple does not silently delete code. It stops the workflow and tells the agent or human exactly what crossed the boundary.

Example stop report:

```txt
Ripple gate: STOP
Agent must stop and repair the staged change before continuing.

Decision: human-review
Can continue: no
Must stop: yes

Review packet:
  protocol: ripple-review-packet
  task: fix retry behavior
  declared scope: function src/auth.ts
  human gate: required-before-edit
  boundary risk: high
  changed files
    - src/auth.ts
  outside boundary symbols
    - src/auth.ts::login
  tests run: unknown
  can continue: no
  must stop: yes
  needs human: yes
  reviewer notes
    - Function scope crossed: review changed symbols outside the declared function boundary.
    - Verification evidence is required before handoff.

Intent:
  Task: fix retry behavior
  Boundary: function
  Target: src/auth.ts
  Human gate: required-before-edit
  Approval: missing

Allowed:
  - src/auth.ts::refreshToken
Changed outside boundary:
  - symbol: src/auth.ts::login

Why:
  - Changed symbol outside function boundary: src/auth.ts::login
Fix now:
  - Undo or replan unapproved symbol: src/auth.ts::login
  - Ask the human to approve a wider boundary before keeping these changes.

Risk: CRITICAL 100/100
Risk summary: CRITICAL risk 100/100: Agent changed symbols outside the approved Ripple boundary.
```

Human developers can intentionally bypass a local Git hook with
`git commit --no-verify`. Ripple is a control system, not a prison.

## Install Once

**1. Initialize your repository:**

```bash
npx -y @getripple/cli init
```

`ripple init` creates the local control layer:

- `.ripple/policy.json` with repo trust defaults from local project signals.
- `.github/workflows/ripple.yml` for pull request gating.
- `.ripple/.cache/` in `.gitignore`.
- A managed Ripple section in `AGENTS.md`, `CLAUDE.md`, or `.cursorrules`.
- Pre-commit and post-commit hook blocks that check active agent intents.

**2. Connect your AI agent:**

Add the MCP server to your agent or editor configuration:

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

**3. Code normally:**

```txt
Agent plans via MCP before editing.
Agent edits code.
Git hook blocks unauthorized drift before commit.
CI audits the pull request before merge.
```

If the agent stays inside the approved boundary, Ripple lets work continue. If
the agent crosses the boundary, Ripple stops and gives a concrete review packet.

## The Control Model

Ripple is one local engine exposed through MCP, CLI, hooks, CI, and VS Code.

| Layer | What it means |
| --- | --- |
| Policy | Permanent repo rules in `.ripple/policy.json` |
| Intent | Temporary approved boundary for the current task |
| Git diff | The staged or changed files Ripple checks |
| MCP | Structured tools for AI agents |
| Hook | Local pre-commit gate before code enters history |
| CI | Pull request gate before merge |

The model is intentionally small:

```txt
Policy says what is sensitive.
Intent says what is approved right now.
Git shows what actually changed.
Gate decides whether the agent may continue.
```

## Trust Boundaries

Ripple stores the freedom level the agent was given before editing.

| Mode | Agent is allowed to |
| --- | --- |
| `brainstorm` | Suggest and explain only. No edits. |
| `function` | Edit only the approved symbol. |
| `file` | Edit only the approved file. |
| `task` | Edit files in the saved task plan. |
| `pr` | Complete low-risk PR work for human review before merge. |

When an agent calls `ripple_plan_context`, it chooses one of these control
modes and can save that boundary as the active local intent.

Example MCP-style plan:

```txt
tool: ripple_plan_context
task: fix retry behavior
targetFile: src/auth.ts
symbol: refreshToken
mode: function
saveIntent: true
```

If the agent also changes `login`, Ripple stops the workflow and tells the
agent what to undo or when to ask for a wider human-approved boundary.

## Agent Workflow

Agents that support MCP should use Ripple directly:

```txt
1. Call ripple_plan_context before editing.
2. Save the intent for the task.
3. Stay inside allowed_files and allowed_symbols.
4. Call ripple_gate after editing.
5. If mustStop=true or needsHuman=true, stop.
6. If canContinue=true, continue only after required verification.
```

Important MCP tools:

```txt
ripple_get_agent_workflow
ripple_plan_context
ripple_get_intent_status
ripple_check_staged
ripple_gate
ripple_repair_intent_drift
ripple_get_blast_radius
ripple_explain_policy
```

Ripple is strongest when the agent, hook, CI, and human all obey the same
continue/stop contract.

## What Ripple Detects

Ripple can report:

- **Intent drift**: the agent changed work outside the saved task.
- **Boundary drift**: the agent crossed the selected mode, such as function or file.
- **Policy drift**: repo trust rules changed after the plan was saved.
- **Readiness drift**: local Ripple setup became weaker.
- **Contract risk**: exported or public symbols may affect downstream callers.
- **Verification gaps**: relevant tests or checks still need to be run.

## Advanced CLI

Manual CLI usage is not the main product loop. It is available for debugging,
scripting, hooks, CI, and human-controlled workflows.

```bash
npm install -g @getripple/cli
ripple doctor   # check repository readiness
ripple gate     # ask the compact continue/stop question
ripple audit    # generate a fuller review packet
ripple history  # inspect recent architectural history
```

The normal product loop is:

```txt
MCP plans.
Agent edits.
Hook gates.
CI governs.
Human reviews only when the boundary breaks.
```

## Interfaces

| Interface | Use it for |
| --- | --- |
| `@getripple/mcp` | Direct AI-agent access through MCP tools |
| `@getripple/cli` | Terminal, Git hooks, CI, local proofs |
| `@getripple/core` | Custom integrations |
| `rippleai.ripple` | Optional VS Code visual context |

## Git Hooks

`ripple init` installs local pre-commit and post-commit hook blocks.

When an active local intent exists, the pre-commit hook runs:

```bash
ripple gate --staged --intent latest --agent --strict
```

When no active intent exists, the hook runs a staged policy and contract
awareness check instead of pretending the work was approved.

After a successful commit, the post-commit hook clears consumed local intents so
old approvals do not create ghost blocks.

## CI

Generate or refresh the GitHub Actions workflow:

```bash
ripple init-ci
```

Run Ripple in CI:

```bash
ripple ci --base origin/main --intent latest --github-annotations
```

Ripple emits annotations for drift and exits non-zero when work should not
merge.

## Local Files

Ripple writes local state under `.ripple/`.

```txt
.ripple/
  policy.json
  history.json
  intents/
    latest.json
  approvals/
  .cache/
```

Recommended `.gitignore`:

```gitignore
.ripple/.cache/
```

Commit `policy.json` and CI workflow files if your team wants shared rules.
Treat intents and approvals as workflow or audit records; teams can decide
whether to commit them.

## Language Support

| Language | Status |
| --- | --- |
| TypeScript / JavaScript | Deep support for imports, exports, symbols, callers, staged drift, and blast radius |
| Python | Basic support for imports, functions, classes, methods, and file-level staged checks |

Ripple uses static analysis. It can miss runtime-only behavior, dynamic imports,
reflection, decorators, generated code, and framework-specific magic.

Use Ripple as a local control signal, not as perfect semantic truth.

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

## Honest Limits

Ripple is not a magical AI wrapper. It is deterministic infrastructure.

- **Ripple is not a coding agent.** It does not write code.
- **Ripple is not a sandbox.** It does not block file-system writes in real-time.
- **Ripple relies on standard Git hooks.** Humans can intentionally bypass blocks using `git commit --no-verify`, ensuring developers are never locked out of their own repositories.
- **Ripple uses static analysis.** It can miss runtime-only behavior, dynamic imports, decorators, generated code, and framework-specific magic.

Ripple is a mathematically strict authorization gate based on AST and Git diffs. It gives a strong local signal; it does not replace your compiler, your test suite, or your human judgment.

## Status

Public alpha.

Stable enough to try:

- CLI plan/check/gate/repair workflow
- MCP agent workflow
- Git hook integration
- GitHub Actions gate
- JavaScript and TypeScript analysis
- basic Python analysis

Still improving:

- Python depth
- framework-specific adapters
- test-target mapping
- large-repo performance
- team policy workflows

## Demo And Proofs

These commands are for people working inside this repository.

Run the one-command product demo:

```bash
npm run demo:agent-control
```

Run the agent-control proof suite:

```bash
npm run proof:agent-control
```

Run the external install smoke:

```bash
npm run smoke:external-install
```

Run package readiness checks:

```bash
npm run proof:publish-readiness
npm run proof:mcp-package-install
```

Run release checks:

```bash
npm run release:check
npm run proof:release-check
npm run release:identity
npm run release:npm-preflight -- --live
```

After publishing, run the live post-publish smoke:

```bash
npm run smoke:post-publish -- --live
```

See [RELEASE.md](RELEASE.md) for publish steps.

Full demo walkthrough: [Ripple Demo: Catching AI Boundary Drift](docs/demo.md).

## Contributing

Issues and pull requests are welcome.

The most useful reports include:

```txt
minimal repo
exact command
expected result
actual result
small explanation of project structure
```

## License

MIT
