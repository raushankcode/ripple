# Changelog

All notable user-facing changes to Ripple are documented here.

Ripple is a local-first AI-agent workflow engine for planning before edits, checking after edits, catching drift, and telling agents what to fix. It ships as a VS Code extension, CLI, MCP server, and shared core engine.

## [1.0.7] - 2026-06-08

### Added
- Add Ripple gate risk explanations with level, score, summary, reasons, evidence, affected files/symbols, and required actions.
- Surface risk explanations through CLI gate output, JSON output, MCP gate responses, and CI summaries.
- Add golden proofs for CLI gate risk output, MCP gate risk contracts, CI risk summaries, and blast-radius risk evidence.

### Changed
- Explain crossed boundaries with stronger evidence from saved intent, graph/blast-radius signals, policy risk, public-contract risk, and verification targets.
- Update README and landing page language around unverifiable authorization, boundary risk, and evidence-based handoff.

### Validation
- Manually validated `@getripple/cli@1.0.7` on a local clone of `sindresorhus/ky` for saved intents, file-boundary drift, risk explanations, blast-radius evidence, repair handoff, policy-based human approval, CI blocking, and GitHub annotations.
- Confirmed real-repo symbol discovery on `source/core/Ky.ts` and critical risk evidence for `source/types/options.ts` with 27 direct importers.

### Fixed
- Fix `.ripple/history.json` recording during cached `ripple scan` runs so stale files are refreshed through the core mutation paths that append structural history events.
- Preserve architectural history after real repo changes by recording events such as `symbol_modified`, `symbol_created`, `symbol_deleted`, `import_added`, `import_removed`, `call_added`, and `call_removed` when scan detects changed files.
- Add regression coverage proving a cached scan records semantic history after a file changes.

### Notes
- JavaScript and TypeScript remain the deepest supported languages.
- Python support remains basic: static imports/from-imports, functions, classes, methods, basic call signals, and file-level staged checks.

## [1.0.6] - 2026-06-07

### Fixed
- Keep the MCP stdio server quiet during scans so agent clients do not receive scan/cache logs on stderr.
- Report blocked Git execution clearly when Node.js cannot launch `git`, instead of reducing every failure to "not inside a git worktree".

### Changed
- Prepare package metadata and changelogs for the fixed npm release.
- Show the product demo more prominently on the landing page while keeping the README demo contained for GitHub readers.

## [1.0.5] - 2026-06-04

### Changed
- Refresh the root README and package READMEs so GitHub and npm users see the same product story: Ripple as a local drift-control engine for AI coding agents.
- Clarify setup, trust-boundary, MCP, CLI, release-check, and known-limitations documentation.
- Keep npm package docs honest about JavaScript/TypeScript depth, basic Python support, and static-analysis limits.

## [1.0.4] - 2026-06-03

### Added
- Publishable npm package identities for `@getripple/core`, `@getripple/cli`, and `@getripple/mcp`.
- Release readiness checks for package metadata, packed installs, MCP stdio wiring, npm registry preflight, and post-publish smoke testing.
- Agent control gates that use the same continue/stop contract across CLI, CI, and MCP.

### Changed
- Position Ripple as a local AI-agent workflow engine: plan before edit, check after edit, catch drift, and tell the agent what to fix.
- Ripple is now available as standalone npm packages. Install `@getripple/cli` to run architecture checks in your terminal and CI pipeline without VS Code. Install `@getripple/mcp` to give AI agents direct structured access to Ripple's architectural context.

### Fixed
- Add executable CLI and MCP package entry points for `ripple` and `ripple-mcp`.
- Harden release proof coverage around package installs, trust-boundary checks, and MCP stdio behavior.

## [1.0.3] - 2026-06-03

### Added
- Initial standalone core extraction for local graph scanning, context planning, risk signals, and focused file summaries.
- CLI commands for initializing Ripple, planning context, checking staged or changed files, auditing saved intent, and producing CI gate decisions.
- MCP tool host for agent-facing focus, blast radius, policy explanation, plan context, staged checks, drift repair, and gate summaries.

### Changed
- Use Ripple from more places: VS Code for visual discovery, the CLI for terminal and CI checks, and MCP for agent-native structured context.
- Generate clearer release and product documentation for the local AI-agent workflow engine.

## [1.0.2] - 2026-05-14

### Changed
- Prefer project-relative paths across Impact Lens, Copy Agent Prompt, caller details, Safety Check, and generated context so records stay portable, readable, and useful outside one developer machine.
- Improve path-qualified history output so files with the same basename remain unambiguous for humans and AI agents.
- Reuse the richer Safety Check test-file detection in companion-test and verification suggestions.
- Sort generated `WORKFLOW.md` high-blast and focus summaries by risk/importer count, and point setup guidance to `AGENTS.md`, `CLAUDE.md`, and `.cursorrules`.

### Fixed
- Rebuild the dependency graph when project configuration changes affect TypeScript path aliases or workspace package resolution.
- Detect source-file changes made outside Ripple, including edits from AI agents, formatters, or other disk writers.
- Persist symbol hashes in the graph cache so cross-session edits can still produce accurate `symbol_modified` history events.
- Record `call_removed` history when a deleted or changed symbol used to call other symbols.

### Documentation
- Clarify Ripple's local-first privacy posture, supported file types, generated files, and known static-analysis limits.
- Document real-project validation from a local clone of `sindresorhus/ky`, including the impact signals found during the test.
- Update the README, landing page, marketplace metadata, and package links for consistent launch positioning.

## [1.0.1] - 2026-05-05

### Changed
- Update the marketplace icon.
- Update the package description with the Context Rot framing.
- Update the display name to `Ripple - Live Architectural Intelligence`.
- Add a Machine Learning marketplace category for better discoverability.

### Fixed
- Sync generated `WORKFLOW.md` guidance to `CLAUDE.md` and `AGENTS.md` on every save.
- Fix the `generateWorkflow` closing-brace issue that caused TypeScript compile errors.

## [1.0.0] - 2026-05-04

### Added
- Initial public release of Ripple for `.ts`, `.tsx`, `.js`, and `.jsx` projects.
- Impact Lens sidebar for exploring a file's dependency graph and downstream risk before editing.
- CodeLens caller counts above function declarations.
- Safety Check warnings for staged changes that may affect many files or important dependency paths.
- Copy Agent Prompt command for turning a selected file into a more grounded AI-agent prompt.
- Generated `.ripple/WORKFLOW.md` guidance that updates from the current codebase.
- Focus files with compact per-file architectural summaries.
- Persistent `.ripple/history.json` for recording architectural changes over time.
- Generated context files including `context.json`, `context.files.json`, and `context.symbols.json`.
- Initial framework and package signals for common React, Node, monorepo, styling, data, routing, and backend patterns.
