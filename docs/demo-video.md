# Ripple Demo Video Kit

This kit is for a short, honest launch demo that shows Ripple's value without
overclaiming.

Open the recording page:

```txt
docs/demo-video.html
```

Recommended output:

```txt
Format: 16:9 MP4
Resolution: 1280 x 720 or 1920 x 1080
Length: about 78 seconds
Tone: technical, calm, proof-first
```

## Core Message

```txt
AI agents can edit code, but they often miss blast radius.
Ripple gives them fresh local codebase context before they edit.
```

## Voiceover Script

### 0:00-0:12

AI coding agents can search your codebase, but search is not the same as fresh
architecture context.

Before changing shared JavaScript or TypeScript code, the agent should know what
imports the file, which symbols have callers, what tests may be affected, and
whether the file has a large blast radius.

### 0:12-0:25

Here is the problem without Ripple.

On a local clone of `sindresorhus/ky`, a temporary change around
`source/utils/merge.ts::mergeHeaders` surfaced three likely related files through
manual diff and text search.

That is useful, but it does not give a risk level, changed-symbol history, or a
verification route.

### 0:25-0:42

With Ripple, the same project scan found 52 files, 103 symbols, 349 import
edges, and 41 call edges.

For the same change, Ripple surfaced 19 potentially impacted files, marked the
edit dangerous, recorded the changed symbol, and generated verification targets.

This does not mean Ripple understands everything. It means it exposes local
blast-radius signals that are easy to miss manually.

### 0:42-0:58

Ripple turns that graph into files AI agents can read.

Agents can start from `.ripple/.cache/context.json`, open the target focus file,
check risk, importers, callers, and suggested checks, and stop for confirmation
before changing dangerous files.

### 0:58-1:10

Ripple is local-first.

There is no account, no telemetry, no cloud indexing, and no code upload.
Generated history and context live inside the workspace and use project-relative
paths.

### 1:10-1:18

Ripple is a VS Code extension for JavaScript and TypeScript projects.

Less guessing. More context. Safer edits.

## Recording Checklist

- Open `docs/demo-video.html` in Chrome, Edge, or VS Code Live Preview.
- Set the browser window to a 16:9 shape before recording.
- Start recording before pressing `Restart`.
- Record one full pass of the auto-playing storyboard.
- Export as MP4 for the landing page and Marketplace.
- Use the existing `resources/ripple-value-demo.gif` in README for lightweight
  GitHub rendering.

Review any individual scene by adding a query string:

```txt
docs/demo-video.html?scene=0
docs/demo-video.html?scene=1
docs/demo-video.html?scene=2
docs/demo-video.html?scene=3
docs/demo-video.html?scene=4
docs/demo-video.html?scene=5
```

## Honest Claims To Keep

- JS/TS first.
- Local-first.
- No telemetry.
- No code upload.
- Practical static analysis signal, not a mathematical proof.
- Validated on a local clone of `sindresorhus/ky`.
- The Ky validation does not imply endorsement by Ky maintainers.

## Claims To Avoid

- Do not say Ripple understands the whole codebase.
- Do not say Ripple prevents all bad AI edits.
- Do not say Ripple replaces tests, review, or engineering judgment.
- Do not imply support for every framework-specific convention yet.
- Do not imply the Ky project endorses Ripple.
