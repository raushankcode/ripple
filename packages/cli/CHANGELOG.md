# @getripple/cli Changelog

## [1.0.5] - 2026-06-04

### Changed
- Refresh package README wording for npm users.
- Restore the first-run `npx -y @getripple/cli doctor` readiness command.
- Clarify the plan/check/gate workflow, control modes, CI gate behavior, and local privacy posture.

## [1.0.4] - 2026-06-03

### Fixed
- Executable entry point for the `ripple` binary.
- Publishable package identity under `@getripple/cli`.
- Release readiness checks for packed installs and CI gate behavior.
- Package-specific README and changelog included in the npm tarball.

## [1.0.3] - 2026-06-03

### Added
- Initial release of the Ripple CLI.
- Commands for `scan`, `focus`, `blast`, `plan`, `check`, `audit`, `repair`, `gate`, `doctor`, `agent`, `init`, and `init-ci`.
- GitHub Actions workflow generation with `ripple init-ci`.
- Drift checks against saved change intent, control boundary, current policy, and readiness snapshot.
- Trust-boundary checking with `--mode function`, `--mode file`, `--mode task`, and `--mode pr`.

### Notes
- Public alpha. The strongest current experience is JavaScript and TypeScript.
