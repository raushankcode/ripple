# Ripple Product Persona

This document is internal truth before public marketing.

Its job is to protect Ripple from ego, vague positioning, and overclaiming.
Every README, landing page, CLI message, MCP response, demo, issue reply, and
future VS Code feature should be judged against this document.

## Founder Standard

Ripple is not sacred because it sounds important.

Ripple becomes worthy only when it helps a real builder keep control while AI
agents change real code.

The product must earn trust through proof:

```txt
Plan before edit.
Check after edit.
Catch drift.
Gate continue or stop.
Tell the agent what to fix.
```

If a claim cannot be connected to a working command, tool, check, or visible
proof, it does not belong in the public product story yet.

## Human Promise

Ripple exists to keep the human builder in command.

AI agents may move fast, but they should not silently cross boundaries, hide
risk, or leave humans to review chaos after the damage is already staged.

Ripple respects the human by making agent behavior:

- visible
- bounded
- auditable
- repairable

The product should never train users to surrender judgment to automation.

It should give humans a clearer moment to say:

```txt
Continue.
Repair this first.
Stop and ask me.
```

## Category

Ripple should own this category:

```txt
Local authorization gate for AI coding agents.
```

This is narrower and stronger than:

- AI coding assistant
- repo intelligence platform
- dependency graph viewer
- VS Code extension
- AI documentation generator
- codebase search tool

Ripple is not trying to be the agent.

Ripple is the local control layer that helps humans and agents understand:

```txt
What was the agent allowed to change?
What did the agent actually change?
Did the agent cross the approved boundary?
May work continue?
Does a human need to take control?
```

## Product Sentence

Use this sentence as the default public promise:

```txt
Ripple is a local authorization gate for AI coding agents that defines what an
agent may change, checks the real Git diff, and returns continue, repair, or
human review.
```

Short category form:

```txt
Local authorization gate for AI coding agents.
```

Human value form:

```txt
Ripple helps teams let AI agents move fast without losing human control.
```

## Enemy

Ripple is built against:

- blind autonomous edits
- silent scope drift
- agents touching risky files without review
- agents changing context-only files
- humans discovering risk only after a large diff exists
- CI passing while the agent crossed the agreed boundary
- prompt-only workflows that rely on hope instead of checks

Do not frame the enemy as "AI is bad" or "developers are careless."

The real enemy is unverified autonomy.

## User

Primary user:

- builders using AI coding agents on real repositories
- maintainers who let agents edit files, stage changes, or prepare pull requests
- teams experimenting with Claude Code, Codex, Cursor, OpenCode, Kiro-like
  flows, or other MCP-capable agent runtimes

Secondary user:

- humans in VS Code who want impact context before changing a file
- CI owners who want agent work to produce a clear continue/stop signal
- tool builders who want to build on Ripple's local graph and gate engine

Not the primary user right now:

- beginners looking only for autocomplete
- teams wanting cloud dashboards
- users expecting perfect semantic understanding of every runtime effect
- users wanting one tool that fully supports every language and framework today

## Persona

Ripple should feel like:

```txt
A calm local control tower for AI coding agents.
```

Its character:

- local
- strict
- calm
- technical
- honest
- auditable
- agent-native
- human-respecting

Ripple should not feel:

- magical
- loud
- mystical
- cute
- vague
- fear-based
- enterprise-bloated
- like a chatbot
- like a replacement for the developer

## Proof Map

Every public claim should map to a working surface.

| Claim | Proof |
| --- | --- |
| Plan before edit | `ripple plan`, `ripple_plan_context` |
| Check after edit | `ripple check`, `ripple_check_staged` |
| Catch drift | drift verdict, boundary verdict, policy drift |
| Gate continue or stop | `ripple gate`, `ripple_gate`, CI gate |
| Tell the agent what to fix | `ripple repair`, `ripple_repair_intent_drift` |
| Human control | approval gate, policy file, human-required handoff |
| Local-first | no account, no telemetry, local repo scan |
| Agent-native | MCP stdio server and structured tool responses |

If the proof is weak, improve the product before increasing the claim.

## Allowed Claims

These are allowed because they match the current product:

- Ripple plans context before an agent edits.
- Ripple checks staged changes against saved intent.
- Ripple detects intent drift and boundary drift.
- Ripple returns a continue, repair, human-review, or restore-readiness gate.
- Ripple can require human approval for risky planned work.
- Ripple runs locally and does not require a cloud account.
- Ripple has deep JavaScript and TypeScript support.
- Ripple has basic Python support.
- Ripple exposes CLI, CI, MCP, core, and VS Code interfaces.
- Ripple uses static analysis and should be treated as a strong local signal,
  not mathematical proof.

## Forbidden Claims

Do not say:

- Ripple perfectly understands your repo.
- Ripple prevents all unsafe AI changes.
- Ripple supports every tech stack deeply.
- Ripple replaces tests, typechecking, code review, or human judgment.
- Ripple makes autonomous agents safe by itself.
- Ripple is a full sandbox or permission system.
- Ripple is more powerful than every AI coding tool.
- Ripple guarantees no production risk.
- Ripple can stop an agent that ignores Ripple unless the agent, editor, CI, or
  write path is wired to obey Ripple's gates.

Use careful language:

```txt
may affect
likely used by
possible blast radius
local signal
human review required
static analysis limit
```

## Interface Roles

Do not blur the interfaces.

```txt
Core    = engine
CLI     = terminal, CI, and local workflow gate
MCP     = agent-native structured interface
VS Code = human visual context interface
```

Current truth:

- CLI and MCP contain the strongest plan/check/repair/gate workflow.
- VS Code is useful for visual context, Impact Lens, CodeLens, prompt copy, and
  safety warnings.
- VS Code is not yet equal to CLI/MCP for saved intent, repair, approval, and
  gate workflows.

Future direction:

- VS Code should become a visual shell over the same CLI/MCP workflow.
- It should not become a separate product with separate rules.

## Voice

Ripple's public voice should be:

- precise
- plain
- calm
- evidence-led
- builder-respecting
- honest about limits

Avoid:

- "revolutionary"
- "game-changing"
- "autonomous safety guaranteed"
- "understands everything"
- "one click to safe AI"
- "the most powerful"

Strong language is allowed only when it is attached to proof.

Good:

```txt
Ripple stops this staged change because the agent changed a context-only file.
```

Bad:

```txt
Ripple makes AI coding safe.
```

## Market Position

Ripple should not compete with AI coding agents as another coding assistant.

Ripple should become useful to all of them.

The strategic position:

```txt
Agents write code.
Ripple checks whether the agent stayed inside the plan.
```

This lets Ripple work beside Codex, Claude Code, Cursor, OpenCode, Kiro-like
tools, and future agent runtimes.

## Visual Direction

The icon and visual identity should communicate:

- boundary
- signal
- consequence
- local control
- agent workflow

The current icon is acceptable for launch, but not yet uniquely ownable.

Future visual work should evolve from a generic radar/target toward a clearer
Ripple-specific mark:

```txt
ripple signal + trust boundary + drift/gate moment
```

Do not delay functional release work for visual polish.

Improve visual identity after the product proof is public and users can tell us
what they remember.

## Decision Test

Before building a new feature, ask:

1. Does this help an agent plan before edit?
2. Does this help check after edit?
3. Does this catch drift or boundary crossing?
4. Does this tell the agent what to fix?
5. Does this make human review more precise?
6. Does this strengthen CLI, MCP, CI, or the shared core?
7. Does this avoid pretending Ripple is stronger than it is?

If the answer is mostly no, delay the feature.

## Next Product Priority

The highest priority after npm publication is not louder branding.

It is proof and user trust:

1. Confirm the published packages install and work in a fresh repo.
2. Create one undeniable demo of boundary drift caught after staging.
3. Ask real AI-agent users to try the CLI/MCP flow.
4. Fix the first real confusion or false-positive report.
5. Then improve landing page, icon, and VS Code workflow alignment.

The order matters.

Trust first. Persona second. Attention third.
