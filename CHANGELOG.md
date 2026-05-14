# Changelog

All notable user-facing changes to Ripple are documented here.

Ripple is a local-first VS Code extension for JavaScript and TypeScript projects. It builds practical codebase context for AI agents by mapping imports, callers, risky dependency paths, focus files, and persistent project history.

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
