---
id: "002"
title: Share history with ccburn when it is installed
status: in_progress      # pending | in_progress | complete
blocked_by: []
blocks: []
---

# Share history with ccburn

## Overview

Spec 001 found that the mod API only reports rate limits from the session's own last reply. An idle pane's chart moves with time, but its usage line never sees what other sessions on the same account burn. ccburn already solves this outside Claude Code: `ccburn collect` in the status line records a reading from **every** session into ccburn's history database.

This spec makes the mod and ccburn share that history when ccburn is installed. The mod reads ccburn's history through `ccburn history --json` (ccburn spec 004) once a minute and writes its own readings through `ccburn collect`. Both are host commands run with `$.process.run`, the API's sanctioned way to reach a host tool. Without ccburn, the mod works exactly as in spec 001.

JJ, 2026-10-05: *"how can we make it so that they share the storage. So if somebody already has CC Burn installed, the mod can just leverage that data and the other way around as well."*

> **Completion rule:** This spec is not complete until all acceptance criteria are verified through `claude plugin test` and the live check in a real pane. Build-only verification is insufficient. The agent must iterate until verification passes.

## Goals

- With ccburn installed and `ccburn collect` in the status line, an idle pane's usage line follows every session on the account, within a minute.
- ccburn's own TUI sees the readings the mod collects, even without the status line.
- Nothing changes for someone without ccburn.

## Requirements

### Functional Requirements

- **FR1 — Read.** At session start and on every minute tick, the mod runs `ccburn history --json --since-hours 168` and merges the snapshots into its readings: each limit in a snapshot becomes a reading `{ provider: "claude-code", kind, timestamp, percentUsed: used_percentage, resetsAt }`. The merged readings redraw the pane. They are kept in the mod's state only; the mod's own store keeps only the readings it saw itself.
- **FR2 — Write.** When the mod gets fresh readings from `session.measure`, it runs `ccburn collect` with stdin `{"rate_limits": {"<kind>": {"used_percentage": n, "resets_at": <epoch seconds>}}}` (the status line's shape) and ignores stdout.
- **FR3 — Detection.** ccburn counts as available while `ccburn history` exits 0 with JSON of `version` 1. When it is missing or fails, the mod stops calling it (read and write) until the next session start.
- **FR4 — Setting.** A `useCcburn` boolean `userConfig` option (default `true`) turns both directions off.
- **FR5 — Profile.** The commands inherit the session's environment, so `CLAUDE_CONFIG_DIR` selects the same profile's ccburn database.

### Non-Functional Requirements

- **NFR1.** No hook waits on a ccburn command: reads run on the clock timer, and the write runs on a zero-delay timer after the measure hook returns.
- **NFR2.** A ccburn call that takes over 10 s is abandoned (`timeoutMs`).

### Technical Constraints

- **TC1.** Requires ccburn with the `history` command (spec 004, released after 0.7.2). The mod never parses SQLite.
- **TC2.** The same reading can arrive twice: once from the status line's `collect` and once from the mod's write. Repeats are harmless (the merge keys on time and drops repeats within a minute), so no deduplication is attempted in ccburn.

## Implementation Tasks

- [x] Parse `ccburn history` JSON into readings (pure, tested).
- [x] Build the `collect` stdin from readings (pure, tested).
- [x] Wire the read on start and on the tick, the write after a measure, detection, and `useCcburn`.
- [x] Test-world support for `process.run`.
- [x] README: the "with ccburn" section.

## Acceptance Criteria

- [x] AC1: Given `ccburn history` output with readings newer than the mod's own, the pane's gauge shows the newer percentage after the next tick, with no `session.measure`. — `integration` (mocked `process.run`, mocked clock)
- [x] AC2: A `session.measure` reading results in one `ccburn collect` run whose stdin parses to the status-line shape with `resets_at` in epoch seconds. — `integration`
- [x] AC3: When `ccburn` fails (non-zero exit), the mod stops calling it and still draws from its own readings. — `integration`
- [x] AC4: With `useCcburn: false`, no command runs. — `integration` (`test(name, { options })`)
- [x] AC5: The parser skips malformed snapshots and limits; the stdin builder round-trips through ccburn's `collect` field names. — `unit`
- [ ] AC6: Live: in the test pane (work profile, `ccburn collect` in its status line), with the pane's session idle while other agents work, the usage gauge moves within two minutes. — `manual` (needs real sessions burning the account)

## Testing Approach

`claude plugin test .` with `process.run` answered by the test world; `claude plugin validate .`; `tsc`. Then the live check in the test pane.

## Out of Scope

- Monthly credits.
- Reading ccburn's database directly.
- Any change to ccburn other than spec 004.

## References

- ccburn spec 004 (`ccburn history --json`), `src/ccburn/collect.py`.
- Spec 001 → Findings: the idle-refresh measurement.
