# @getripple/cli

Run Ripple's architecture checks in your terminal and CI pipeline without VS Code.

Plan before edit. Check after edit. Catch drift. Tell the agent what to fix.

```bash
npx -y @getripple/cli plan --file src/auth.ts --task "refactor token handling" --save
```

## Quick Start

**Step 1 — Initialize Ripple in your repo:**

```bash
npx -y @getripple/cli init
```

Scans your project, builds the dependency graph, and writes `.ripple/` context
files. Run this once per project.

**Step 2 — Plan before editing a file:**

```bash
npx -y @getripple/cli plan --file src/auth.ts --task "refactor token handling" --mode file --save
```

Returns the files to read first, the risk level, the allowed boundary, and what
to verify. `--save` records the intent so the next check can detect drift.

**Step 3 — After editing and staging, check for drift:**

```bash
npx -y @getripple/cli check --staged --intent latest
```

Compares your staged changes against the saved plan. Returns a verdict:
intent drift, boundary drift, or clean.

**Step 4 — Get the compact continue/stop decision:**

```bash
npx -y @getripple/cli gate --intent latest
```

Returns one of four decisions the agent or CI pipeline acts on directly:

```
open/continue
closed/repair
closed/human-review
closed/restore-readiness
```

## Install

```bash
npm install -g @getripple/cli
```

Then use `ripple` directly:

```bash
ripple init
ripple plan --file src/auth.ts --task "refactor token handling" --mode file --save
ripple check --staged --intent latest
ripple gate --intent latest
```

Check that the project is ready before running anything else:

```bash
npx -y @getripple/cli doctor
```

Or, after global install:

```bash
ripple doctor
```

## CI Gate

Generate a GitHub Actions workflow file:

```bash
ripple init-ci
```

Add Ripple as a pull-request gate in CI:

```bash
ripple ci --base origin/main --intent latest --github-annotations
```

The gate emits GitHub annotations for each drift finding and writes a summary
to the Actions step summary panel. Exits non-zero when drift blocks merge.

## Control Modes

Pass `--mode` to `ripple plan` to set the trust boundary:

| Mode         | What the agent is allowed to touch                   |
| ------------ | ---------------------------------------------------- |
| `brainstorm` | No edits allowed — suggest and explain only          |
| `function`   | Only the approved symbol                             |
| `file`       | Only the planned file                                |
| `task`       | All files listed in the saved intent                 |
| `pr`         | Full task scope — agent prepares PR for human review |

After staging, `ripple check --staged` detects whether the agent stayed inside
the boundary and reports boundary drift separately from intent drift.

## All Commands

```
ripple init              Initialize Ripple in the current repo
ripple doctor            Check project readiness
ripple scan              Scan the repo and rebuild the graph
ripple focus             Show focused context for a file
ripple blast             Show files that depend on a target file
ripple imports           Show what a file imports
ripple importers         Show what imports a file
ripple symbols           Show exported symbols in a file
ripple callers           Show callers of a symbol
ripple history           Show recent architectural changes
ripple plan              Plan context before editing a file
ripple check             Check staged or changed files against saved intent
ripple audit             Audit a completed change for drift signals
ripple repair            Get repair actions when drift is detected
ripple gate              Compact continue/stop decision
ripple agent             Print the agent workflow guide
ripple init-ci           Generate a GitHub Actions workflow file
ripple ci                Run the CI gate against a base ref
```

## Privacy

Ripple runs entirely on your machine. No account, telemetry, cloud indexing, or
remote model call is required by the CLI.

## Status

Public alpha. The strongest current experience is JavaScript and TypeScript.

## License

MIT
