# @getripple/cli

Run Ripple's architecture checks in your terminal and CI pipeline without VS Code.

```bash
npx -y @getripple/cli plan --file src/auth.ts --task "refactor token handling"
```

Ripple is a local AI-agent workflow engine: plan before edit, check after edit,
catch drift, and tell the agent what to fix.

## Quick Start

Initialize Ripple in a repo:

```bash
npx -y @getripple/cli init
```

Create a saved plan before editing:

```bash
npx -y @getripple/cli plan --file src/auth.ts --task "refactor token handling" --mode file --save
```

After editing and staging files, check the change against the saved plan:

```bash
npx -y @getripple/cli check --staged --intent latest
```

For the smallest continue/stop answer:

```bash
npx -y @getripple/cli gate --intent latest
```

## Install

```bash
npm install -g @getripple/cli
```

Then run:

```bash
ripple init
ripple plan --file src/auth.ts --task "refactor token handling" --mode file --save
ripple check --staged --intent latest
ripple gate --intent latest
```

Check setup readiness:

```bash
npx -y @getripple/cli doctor
```

## CI Gate

Generate a GitHub Actions workflow:

```bash
ripple init-ci
```

Use Ripple as a pull-request gate:

```bash
ripple ci --base origin/main --intent latest --github-annotations
```

The gate speaks the same compact language used by CLI and MCP:

```txt
open/continue
closed/repair
closed/human-review
closed/restore-readiness
```

## Commands

```txt
ripple scan
ripple focus
ripple blast
ripple plan
ripple check
ripple audit
ripple repair
ripple gate
ripple doctor
ripple agent
ripple init
ripple init-ci
```

## Privacy

Ripple runs locally. No account, telemetry, cloud indexing, or remote model call
is required by the CLI.

## Status

Public alpha. The strongest current experience is JavaScript and TypeScript.

## License

MIT
