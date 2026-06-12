# Ripple

**A local authorization gate for AI coding agents.**

Ripple saves what an AI coding agent was allowed to change, compares that boundary against the actual Git diff, and returns a clear decision:

```txt
CONTINUE
REPAIR
HUMAN REVIEW
```

It runs locally in your repository. No account, no telemetry, no code upload, no cloud indexing, and no remote model call required.

[![npm cli](https://img.shields.io/npm/v/@getripple/cli.svg)](https://www.npmjs.com/package/@getripple/cli)
[![npm mcp](https://img.shields.io/npm/v/@getripple/mcp.svg)](https://www.npmjs.com/package/@getripple/mcp)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

![Ripple gate demo](resources/ripple-gate-demo.gif)

## The Problem

AI coding agents can move fast. They can plan, edit files, stage changes, and prepare pull requests.

The hard question is not only:

```txt
Is the generated code correct?
```

The deeper question is:

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
  STOP. The agent crossed the approved function boundary.
```

Ripple is built for that moment. It gives humans, agents, hooks, and CI the same continue/stop contract.

## What Ripple Does

Ripple helps teams control AI-agent changes without sending code to a cloud service.

```txt
1. Plan before edit
2. Save the approved boundary
3. Let the agent work
4. Check the staged diff
5. Return continue, repair, or human review
```

When a boundary is crossed, Ripple returns evidence and repair instructions:

```json
{
  "decision": "human-review",
  "canContinue": false,
  "mustStop": true,
  "needsHuman": true,
  "why": [
    "Changed symbol outside approved boundary: src/auth.ts::login"
  ],
  "fixNow": [
    "Undo the accidental change to src/auth.ts::login, or ask the human to approve a wider boundary."
  ]
}
```

Ripple does not judge whether code is beautiful. It checks whether the agent stayed inside the work it was trusted to do.

## Try It In One Command

From this repository:

```bash
npm run demo:agent-control
```

The demo creates a temporary repo and runs the real Ripple CLI:

```txt
1. Init: local Ripple policy and hooks created
2. Plan: saved function boundary src/auth.ts::refreshToken
3. Approval: human approved that narrow boundary
4. Agent edit: changed refreshToken and also changed login
5. Gate: STOP (human-review)
6. Evidence: changed outside boundary src/auth.ts::login
7. Repair: undo the unapproved login change, or ask for a wider boundary
```

That is Ripple's core product in one command.

See the full walkthrough: [Ripple Demo: Catching AI Boundary Drift](docs/demo.md).

## Install

Run without installing globally:

```bash
npx -y @getripple/cli init
```

Install the CLI:

```bash
npm install -g @getripple/cli
```

Run the MCP server for agents:

```bash
npx -y @getripple/mcp --workspace /absolute/path/to/your/repo
```

Install the VS Code interface:

```bash
code --install-extension rippleai.ripple
```

## 2-Minute Workflow

Initialize Ripple in a repo:

```bash
ripple init
```

Plan before the agent edits:

```bash
ripple plan \
  --file src/auth.ts \
  --symbol refreshToken \
  --task "fix refresh token retry behavior" \
  --mode function \
  --agent \
  --save
```

If a human gate is required, record approval:

```bash
ripple approve \
  --intent latest \
  --gate before-risky-edit \
  --reason "approved refreshToken only"
```

After the agent edits, stage the intended files:

```bash
git add src/auth.ts
```

Ask the gate:

```bash
ripple gate --intent latest
```

If the staged changes stayed inside the approved boundary:

```txt
Ripple gate: CONTINUE
```

If the staged changes crossed the boundary:

```txt
Ripple gate: STOP

Decision: human-review
Can continue: no
Must stop: yes
Needs human: yes

Changed outside boundary:
  src/auth.ts::login

Fix now:
  Undo the accidental change to src/auth.ts::login,
  or ask the human to approve a wider boundary.
```

Get exact repair actions:

```bash
ripple repair --agent --intent latest
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

Example:

```bash
ripple plan \
  --file src/auth.ts \
  --symbol refreshToken \
  --task "fix retry behavior" \
  --mode function \
  --agent \
  --save
```

If the agent also changes `login`, Ripple stops the workflow and tells the agent what to undo or when to ask for a wider human-approved boundary.

## The Ripple Control Model

Ripple is built around six local control layers:

| Layer | Purpose |
| --- | --- |
| Policy | Permanent repo rules in `.ripple/policy.json` |
| Intent | Temporary approved boundary for the current task |
| Git diff | The staged or changed files Ripple checks |
| MCP | Direct structured tools for AI agents |
| Hook | Local pre-commit check for staged drift |
| CI | Pull request gate for merge-time enforcement |

This model keeps the workflow practical:

```txt
Policy says what is sensitive.
Intent says what is approved right now.
Git shows what actually changed.
Gate decides whether the agent may continue.
```

## What Ripple Detects

Ripple can report:

- **Intent drift**: the agent changed work outside the saved task.
- **Boundary drift**: the agent crossed the selected mode, such as function or file.
- **Policy drift**: repo trust rules changed after the plan was saved.
- **Readiness drift**: local Ripple setup became weaker.
- **Contract risk**: exported or public symbols may affect downstream callers.
- **Verification gaps**: relevant tests or checks still need to be run.

## Interfaces

One local engine powers multiple interfaces:

| Interface | Use it for |
| --- | --- |
| `@getripple/cli` | Terminal, Git hooks, CI, local proofs |
| `@getripple/mcp` | Direct AI-agent access through MCP tools |
| `@getripple/core` | Custom integrations |
| `rippleai.ripple` | VS Code visual context |

## CLI

Common commands:

```bash
ripple init
ripple doctor
ripple plan --file src/auth.ts --task "..." --mode function --symbol refreshToken --agent --save
ripple approve --intent latest --gate before-risky-edit --reason "approved"
ripple check --staged --agent --intent latest
ripple gate --intent latest
ripple repair --agent --intent latest
ripple ci --base origin/main --intent latest --github-annotations
```

Graph and context commands:

```bash
ripple scan .
ripple focus src/auth.ts
ripple blast src/auth.ts
ripple importers src/auth.ts
ripple symbols src/auth.ts
ripple callers src/auth.ts::refreshToken
ripple history --last 10
```

Git hook setup:

```bash
ripple hook install
```

The hook checks staged changes before commit. It uses the local CLI when possible and falls back to `npx` only as a last resort.

## MCP

Add Ripple to an MCP-compatible agent:

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

Important tools:

```txt
ripple_doctor
ripple_plan_context
ripple_get_intent_status
ripple_check_staged
ripple_gate
ripple_repair_intent_drift
ripple_get_blast_radius
ripple_explain_policy
```

Recommended agent loop:

```txt
Call ripple_plan_context before editing.
Call ripple_gate after editing.
If mustStop=true, stop.
If needsHuman=true, ask the human.
If canContinue=true, continue only after required verification.
```

## CI

Generate a GitHub Actions workflow:

```bash
ripple init-ci
```

Run Ripple in CI:

```bash
ripple ci --base origin/main --intent latest --github-annotations
```

Ripple emits annotations for drift and exits non-zero when work should not merge.

## Local Files

Ripple writes workflow state under `.ripple/`.

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

Treat intents and approvals as workflow or audit records. Teams can decide whether to commit them.

## Language Support

| Language | Status |
| --- | --- |
| TypeScript / JavaScript | Deep support for imports, exports, symbols, callers, staged drift, and blast radius |
| Python | Basic support for imports, functions, classes, methods, and file-level staged checks |

Ripple uses static analysis. It can miss runtime-only behavior, dynamic imports, reflection, decorators, generated code, and framework-specific magic.

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

Ripple is not:

- a coding agent
- a code generator
- a sandbox
- a test replacement
- a typechecker replacement
- a code review replacement
- a guarantee that an agent cannot act badly if it ignores the tool

Hooks can be bypassed. CI must be configured. MCP agents must actually call the tools.

Ripple is strongest when agents, hooks, CI, and humans obey the same continue/stop contract.

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

## Development Proofs

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
```

Review release identity and npm registry readiness:

```bash
npm run release:identity
npm run release:npm-preflight -- --live
```

Run the release-check proof directly:

```bash
npm run proof:release-check
```

After publishing, run the live post-publish smoke:

```bash
npm run smoke:post-publish -- --live
```

See [RELEASE.md](RELEASE.md) for publish steps.

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
