# Ripple Demo: Catching AI Boundary Drift

This demo shows Ripple's core job in one scenario:

```txt
A human approves one function.
An agent changes that function and another function.
Ripple catches the boundary drift and stops the workflow.
```

The goal is not to prove that the code is correct.

The goal is to prove whether the agent stayed inside the work it was trusted to do.

## Run The Demo

From the Ripple repo:

```bash
npm run demo:agent-control
```

The command creates a temporary repo under `test/.tmp/`, runs the real Ripple CLI, and prints the result.

Expected output:

```txt
Ripple agent-control demo passed

1. Init: local Ripple policy and hooks created
2. Plan: saved function boundary src/auth.ts::refreshToken
3. Approval: human approved that narrow boundary
4. Agent edit: changed refreshToken and also changed login
5. Gate: STOP (human-review)
6. Evidence: changed outside boundary src/auth.ts::login
7. Repair: Undo the accidental change to src/auth.ts::login, or ask the human to approve a wider boundary.

Result: HUMAN REVIEW REQUIRED before the agent may continue
```

## What The Demo Creates

The temporary repo contains a small auth file:

```ts
export function refreshToken(attempts = 1): string {
  if (attempts > 1) {
    return "retry-token";
  }

  return "token";
}

export function login(user: string): string {
  return `session:${user}`;
}
```

Ripple then saves a function-level boundary:

```txt
Approved boundary:
  src/auth.ts::refreshToken
```

This means the agent may edit `refreshToken`, but not `login`.

## Step 1: Initialize Ripple

The demo runs:

```bash
ripple init
```

This creates local Ripple workflow files:

```txt
.ripple/policy.json
.github/workflows/ripple.yml
.git/hooks/pre-commit
.git/hooks/post-commit
```

Ripple stays local. The demo does not upload code or call a remote model.

## Step 2: Save The Approved Boundary

The demo runs:

```bash
ripple plan \
  --file src/auth.ts \
  --symbol refreshToken \
  --task "fix refresh token retry behavior" \
  --mode function \
  --agent \
  --save
```

This saves the current task intent:

```txt
Task:
  fix refresh token retry behavior

Allowed file:
  src/auth.ts

Allowed symbol:
  src/auth.ts::refreshToken

Control mode:
  function
```

That saved intent is the trust boundary for the agent's work.

## Step 3: Record Human Approval

Because `src/auth.ts` is sensitive, the demo records a human approval:

```bash
ripple approve \
  --intent latest \
  --gate before-risky-edit \
  --approved-by "Ripple Demo" \
  --reason "Demo approves only the refreshToken function boundary."
```

This does not approve the whole file.

It approves only the saved function boundary.

## Step 4: Simulate Agent Drift

The demo simulates an agent making two changes.

Allowed change:

```txt
src/auth.ts::refreshToken
```

Unapproved change:

```txt
src/auth.ts::login
```

The resulting staged diff crosses the boundary.

This is exactly the kind of drift that can happen when an AI agent edits nearby code while trying to be helpful.

## Step 5: Ask The Gate

The demo stages `src/auth.ts` and runs:

```bash
ripple gate --intent latest --strict
```

Ripple returns a stop decision:

```txt
Decision:
  human-review

Can continue:
  no

Must stop:
  yes

Needs human:
  yes

Evidence:
  changed outside boundary src/auth.ts::login
```

The agent is not allowed to continue autonomously.

## Step 6: Get Repair Instructions

The demo runs:

```bash
ripple repair --agent --intent latest
```

Ripple tells the agent what to do next:

```txt
Undo the accidental change to src/auth.ts::login,
or ask the human to approve a wider boundary.
```

This is the important part.

Ripple does not just say "risk detected."

It tells the agent the exact boundary it crossed and the exact repair path.

## What This Proves

The demo proves the current end-to-end agent-control loop:

```txt
init
plan
approve
edit
stage
gate
repair
```

It proves that Ripple can:

- Save a human-approved function boundary.
- Compare staged changes against that boundary.
- Detect a symbol changed outside the approved scope.
- Return a stop decision.
- Require human review.
- Tell the agent what to fix.

## What This Does Not Prove

This demo is intentionally narrow.

It does not prove that Ripple understands every possible framework, runtime path, or semantic behavior.

Ripple uses static analysis and Git diff evidence. It can miss runtime-only behavior, dynamic imports, decorators, generated code, reflection, and framework-specific magic.

The honest claim is:

```txt
Ripple gives AI coding agents a local authorization gate.
It checks whether staged changes stayed inside the approved work boundary.
```

## Use This Pattern In Your Repo

In your own repository, the same workflow looks like this:

```bash
ripple init

ripple plan \
  --file src/auth.ts \
  --symbol refreshToken \
  --task "fix refresh token retry behavior" \
  --mode function \
  --agent \
  --save

ripple approve \
  --intent latest \
  --gate before-risky-edit \
  --reason "approved refreshToken only"

git add src/auth.ts

ripple gate --intent latest

ripple repair --agent --intent latest
```

For MCP-compatible agents, use:

```txt
ripple_plan_context
ripple_gate
ripple_repair_intent_drift
```

The rule is simple:

```txt
If canContinue=true, continue after required verification.
If mustStop=true, stop and fix.
If needsHuman=true, ask the human.
```

