# Ripple Validation Report

Validation date: June 9, 2026
Validated package: `@getripple/cli@1.0.7`
Validation target: local clone of `sindresorhus/ky`
Environment: Windows PowerShell

This document records the current honest validation state for Ripple before the
`1.0.8` npm release. It focuses on what was tested, what worked, what was not
proven, and what limitation was found.

Ripple's current validated promise is:

```txt
Plan before edit.
Save intent.
Choose a trust boundary.
Check after edit.
Catch drift.
Explain risk with evidence.
Return continue / repair / human-review.
```

This validation does not imply endorsement by the Ky project or its maintainers.
Ky was used only as a real-world open-source TypeScript codebase for local
testing.

---

## Summary

Ripple was manually tested on a cloned copy of `sindresorhus/ky`, a real
open-source TypeScript HTTP client repository. This was not a toy fixture.

The validation confirmed that Ripple can:

```txt
- initialize inside a real TypeScript repo
- scan the repo and build graph/cache signals
- detect symbols in real source files
- create saved file and function boundaries
- detect file-boundary drift after staged edits
- explain risk with concrete evidence
- surface blast-radius evidence from downstream importers
- return repair actions and verification targets
- require and record human approval for high-risk policy paths
- block CI with GitHub annotations when a staged change crosses the approved boundary
```

The validation also found one important limitation:

```txt
.ripple/history.json recorded the baseline snapshot, but did not append
structural history events from `ripple scan` after adding/modifying a symbol.
```

So the gate/risk workflow is validated, but `history.json` should not yet be
described as a complete architectural change log.

---

## Project Tested

```txt
Project: sindresorhus/ky
Test type: local clone
Language: TypeScript
Package tested: @getripple/cli@1.0.7
Environment: Windows PowerShell
```

Ky was chosen because it is a real TypeScript project with runtime source files,
type files, tests, shared utility code, ESM-style imports, and enough dependency
structure to make boundary and blast-radius testing meaningful.

---

## Baseline Scan

Ripple initialized and scanned the repo. The observed baseline was:

```txt
Files: 52
Symbols: 103
Call edges: 41
History event: baseline_snapshot initial_scan
Metadata: files:52|symbols:103
```

The baseline confirmed that Ripple could read the repository and generate its
initial local graph/cache state.

---

## Symbol Detection Proof

The command below was run on a real Ky source file:

```bash
ripple symbols source/core/Ky.ts
```

Ripple detected 8 symbols:

```txt
source/core/Ky.ts::cloneInitHookOptions
source/core/Ky.ts::cloneRetryOptions
source/core/Ky.ts::cloneSearchParametersForInitHook
source/core/Ky.ts::createTextDecoder
source/core/Ky.ts::isRequestInstance
source/core/Ky.ts::isResponseInstance
source/core/Ky.ts::Ky
source/core/Ky.ts::validateJsonWithSchema
```

This validates that the JS/TS adapter can extract real symbols from Ky's source
code, not only from small fixtures.

---

## File Boundary Drift Proof

A saved file-boundary intent was created for:

```txt
Allowed file: source/core/Ky.ts
Task: adjust retry behavior in Ky core
Control mode: file
```

Then a staged change intentionally touched both:

```txt
source/core/Ky.ts          allowed
source/types/options.ts    outside approved boundary
```

Ripple gate returned a closed repair/handoff decision and the JSON risk summary
included:

```txt
Risk: CRITICAL 100/100
Summary: Agent changed files outside the approved Ripple boundary.
```

Risk evidence included:

```txt
allowed file: source/core/Ky.ts
changed outside boundary: source/types/options.ts
unplanned file: source/types/options.ts
source/types/options.ts is marked dangerous by Ripple graph risk
importer count: 27
27 direct importers may be affected
```

This validates the main risk explanation layer:

```txt
The agent crossed the approved boundary.
Ripple showed what was allowed.
Ripple showed what changed outside approval.
Ripple explained why it mattered.
Ripple gave evidence and required actions.
```

---

## Repair Handoff Proof

After the boundary drift, the repair command was run:

```bash
ripple repair --agent --intent latest
```

Ripple returned:

```txt
can_continue: false
must_stop: true
needs_human: false
decision: repair
next_required_action: Apply the repair actions, then rerun ripple check --staged --agent --intent latest.
```

It also returned exact repair guidance:

```txt
Unstage source/types/options.ts, or create a new saved intent if editing this file is intentional.
Unstage file outside boundary: source/types/options.ts
Ask the human to approve a wider boundary before keeping these changes.
```

And the concrete command:

```bash
git restore --staged -- source/types/options.ts
```

This validates the agent handoff loop:

```txt
stop -> repair -> unstage or replan -> check again
```

---

## Function / Class Boundary Planning Proof

A function-boundary intent was created for the `Ky` class:

```bash
ripple plan --file source/core/Ky.ts --symbol Ky --task "inspect Ky class boundary behavior" --mode function --agent --save
```

Ripple returned:

```txt
control_mode: function
allowed_files:
- source/core/Ky.ts

allowed_symbols:
- source/core/Ky.ts::Ky
```

It also returned useful context and verification signals such as:

```txt
read_first:
- source/core/Ky.ts
- source/utils/merge.ts
- source/index.ts

verify:
- test/browser.ts
- test/retry.ts
- test/stream.ts
- test/http-error.ts
- test/main.ts
- test/base-url.ts
- source/index.ts
- source/core/Ky.ts::cloneRetryOptions (1 callers)
- source/core/Ky.ts::cloneSearchParametersForInitHook (1 callers)
```

The gate later returned `continue` when no staged change existed. That is
correct behavior, because there was no staged edit to compare against the saved
function boundary.

This test validated function-boundary planning, not a full function-boundary
drift scenario. A separate staged edit inside/outside specific symbols should be
used for deeper function-boundary regression testing.

---

## Policy-Based Human Approval Proof

A policy was added requiring human approval before editing high-risk paths:

```json
{
  "riskRules": [
    {
      "paths": ["source/core/**"],
      "risk": "high",
      "requireHumanBeforeEdit": true
    },
    {
      "paths": ["source/types/**"],
      "risk": "high",
      "requireHumanBeforeEdit": true
    }
  ]
}
```

Planning against `source/core/Ky.ts` correctly returned:

```txt
human_gate: required-before-edit
human_required: true
boundary_risk: high
policy_matches: riskRules[0] paths=source/core/** risk=high
```

Before approval, Ripple gate stopped with:

```txt
Decision: human-review
Approval: missing
```

After approval was recorded with:

```bash
ripple approve --intent latest --gate before-risky-edit --reason "Ky real repo proof"
```

Ripple gate returned:

```txt
Decision: continue
Approval: approved
```

This validates the human approval gate on a real repo path.

---

## CI / GitHub Annotation Proof

A staged boundary violation was checked with:

```bash
ripple ci --base HEAD --intent latest --github-annotations
```

Ripple returned:

```txt
Status: human-review-required
Decision: human-review
Can proceed: false
drift: DANGER
boundary: DANGER
policy drift: PASS
readiness drift: PASS
```

It also emitted GitHub annotation lines, including examples like:

```txt
::error file=source/types/options.ts,title=Ripple intent drift
::error file=source/types/options.ts,title=Ripple boundary drift
::warning file=test/retry.ts,title=Ripple verify before commit
```

This validates that Ripple can act as a CI gate for agent boundary drift.

---

## History Validation Result

The history test found a limitation.

Initial history worked:

```json
[
  {
    "type": "baseline_snapshot",
    "source": "initial_scan",
    "metadata": "files:52|symbols:103"
  }
]
```

Then a new function was added to `source/utils/merge.ts`:

```ts
export function rippleHistoryProbe(): string {
  return "ripple-history-probe";
}
```

After running:

```bash
ripple scan .
```

Ripple reported:

```txt
Files: 52
Symbols: 104
```

So the scanner did see the new symbol.

However, `ripple history --last 10` and `.ripple/history.json` still showed only
the original `baseline_snapshot` event.

Then the symbol body was modified and an import was added. `ripple scan .` still
updated the graph/cache view, but history remained baseline-only.

Conclusion:

```txt
CLI scan refreshes graph/cache and detects the new symbol count,
but `.ripple/history.json` does not currently append structural history events
from `ripple scan` reliably.
```

Launch claim adjustment:

```txt
Do not claim history.json is a complete architectural change log yet.
It is safe to claim that Ripple creates an initial baseline snapshot and uses
local graph/cache signals for planning, gate checks, risk, and repair.
```

---

## What Was Validated

Validated:

```txt
- npm package execution through @getripple/cli@1.0.7
- repo initialization
- baseline scan
- symbol extraction from real TypeScript source
- saved file boundary
- saved function/class boundary planning
- staged file-boundary drift detection
- risk explanation with evidence
- blast-radius evidence from importer count
- repair handoff
- policy-based human approval
- approval recording
- CI blocking
- GitHub annotations
```

Not fully validated in this run:

```txt
- deep function-boundary drift with precise inside/outside symbol edits
- Python behavior on a real Python repo
- full product-flow intelligence across framework routes
- history.json as a complete structural event log
```

---

## Current Honest Product Claim

Based on this validation, Ripple can honestly claim:

```txt
Ripple checks whether an AI coding agent stayed inside the approved task and,
when it did not, explains the risk with evidence and required actions.
```

Ripple should not yet claim:

```txt
Ripple perfectly understands every affected product flow.
Ripple replaces tests, code review, CI, or human judgment.
Ripple's history.json is a complete architectural change log.
```

---

## Privacy Notes

The Ky validation was local.

```txt
No code was uploaded by Ripple.
No account was required by Ripple.
No remote model call was required by Ripple.
No telemetry was required by Ripple.
```

Generated Ripple state lived under local repo files such as:

```txt
.ripple/policy.json
.ripple/history.json
.ripple/intents/latest.json
.ripple/approvals/
.ripple/.cache/
.github/workflows/ripple.yml
```

The temporary test edits were restored after validation.

---

## Conclusion

The Ky validation is strong evidence that Ripple's current core loop works on a
real TypeScript repository:

```txt
plan -> save intent -> edit -> gate -> risk explanation -> repair / human-review -> CI block
```

The strongest validated behavior is:

```txt
Allowed: source/core/Ky.ts
Agent also changed: source/types/options.ts
Ripple: STOP / repair or human-review
Risk: CRITICAL 100/100
Evidence: outside boundary + 27 direct importers
Action: unstage outside file or create a wider human-approved intent
```

This is real value for AI-agent coding workflows.

The main launch note is that `history.json` should be described carefully until
structural history event recording from `ripple scan` is fixed.
