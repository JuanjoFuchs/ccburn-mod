---
id: "001"
title: ccburn burn-up chart as a Claude Code mod
status: in_progress      # pending | in_progress | complete
blocked_by: []
blocks: []
---

# ccburn burn-up chart as a Claude Code mod

> **Reference implementation:** [ccburn](https://github.com/JuanjoFuchs/ccburn), expected as a sibling checkout at `../ccburn`; every `src/ccburn/...` and `tests/...` path below is in that repo.

## Overview

Claude Code now loads **mods**: plugins of function hooks (TypeScript, hot-reloaded) that can open a pane beside the transcript and draw in it. The point of this product is one thing: **render ccburn's burn-up chart, the way ccburn renders it today, inside Claude Code**, so the pace of the 5-hour and weekly windows is in view where the tokens are spent, without a second terminal.

The finding that makes it practical (mod API, build 2.1.289, `claude-code.d.ts`): **the engine hands a mod the rate-limit readings directly.** `$.session.usage()` answers `rateLimits: [{ kind, percentUsed, resetsAt }]` (`five_hour`, `seven_day`), and the `session.measure` event pushes the same figures after every main-thread turn and whenever a window moves a whole point. That is the data `ccburn collect` scrapes from the statusline JSON today, with no API call, no OAuth 429 and no cookie fallback. And the terminal surface has a `Raster` element (a grid of glyph + colour cells, braille included), which is what plotext draws ccburn's chart with.

> **Completion rule:** This spec is not complete until all acceptance criteria are verified through `claude plugin validate`, `tsc`, `claude plugin test` (unit + integration tests run against the engine) and the manual checks listed, in a live hot-reloaded session. Build-only verification is insufficient. The agent must iterate until verification passes.

## Decisions

### A native mod, not a shell over the ccburn CLI

| | **Native mod (chosen)** | Thin shell over `ccburn --json` |
|---|---|---|
| Data | engine-pushed readings, zero API calls | whatever the Python CLI fetches: DB cache → OAuth (429-prone) → desktop cookies |
| Install | `claude plugin install`; no Python, no ccburn binary | ccburn installed on PATH **and** the plugin |
| Cost per refresh | none (in-process) | a Python process per refresh (~350 ms Typer startup; process spawn is the dominant cost on Windows) |
| The chart | drawn natively as one `Raster` | Rich/plotext ANSI output cannot be handed to a pane; degrades to text |
| Reuse | re-implements ~150 lines of pure math and the chart layout, with ccburn's tests as the oracle | reuses everything |

The shell's only advantage is reuse, and it pays for it on every refresh and with a second install, while losing the chart, which is the whole point.

### A separate repo, not a folder in ccburn (JJ, 2026-10-05)

Different stack (TypeScript mod vs Python CLI), different distribution (a Claude Code plugin marketplace vs PyPI / npm / WinGet), different release train. The repo **is** the marketplace, so `claude plugin marketplace add <owner>/<repo>` is the whole install story. It stays ccburn-branded: same chart, same pace semantics, same emojis. The multi-provider product remains pluriburn, a separate idea; this spec keeps that door open (TC4) and does not walk through it.

## Goals

- Open ccburn's burn-up chart for the 5-hour session and the weekly window in a Claude Code pane, visually matching `ccburn session` / `ccburn weekly`.
- Keep it live: the chart moves with every new reading and with the clock between readings.
- Install from GitHub with two `claude plugin` commands.

## Requirements

### Functional Requirements

- **FR1 — The chart.** The pane draws, for the selected window and the default view (full window, `since=None`, `until="now"`), the chart ccburn's `BurnupChart` draws through plotext 5.3.2 (`src/ccburn/display/chart.py`), cell for cell, as one `Raster` sized to the pane's body width and the rows left after FR2:
  - **Frame:** plotext's box, in RGB (100,100,100). Left Y axis at column `wl`, with `┤` at y-tick rows; right axis with `├`. The bottom axis carries `┬` under each x tick that kept its label. Canvas: `wc = W − 2 − 2·wl` columns and `hc = H − 3` rows, where `wl` is the widest Y label (5 in the default view).
  - **Y-axis:** range from ccburn's rule (data min/max over usage, pace and projection, 10 % padding, minimum 10-point range, clamped to 0–100), which is `[0, 100]` in the default view because the pace line spans it. 7 ticks, `linspace(ymin, ymax, 7)`, labelled on both sides with plotext's `get_labels` formatting (`0.0 16.7 … 100.0`).
  - **X-axis:** 5 evenly spaced local-time ticks. The format is `%H:%M` up to 24 h, `%a %Hh` up to 168 h (the weekly window is exactly 168, so `Tue 09h`), and `M/D` beyond. Add a `Now` tick and, when depletion is projected, a `Depleted` tick, each labelled with its time; drop grid ticks closer than 10 % of the width to either. Labels are centred on their tick and slid inward at the edges. A label that would overlap another is skipped together with its `┬`, resolved in **ascending position order** (a deliberate deviation: plotext resolves in hash order, which varies run to run).
  - **Plot:** braille, 2 × 4 sub-pixels per cell. Lines are joined between points, and dots of one signal in a cell are OR-ed. Signals are drawn in this order, and **a later signal replaces the whole cell** (glyph and colour):

    | # | Signal | Colour (RGB) | Notes |
    |---|---|---|---|
    | 1 | Budget pace | 100,100,100 | 0 % at window start to 100 % at reset |
    | 2 | Usage | `_get_plotext_color(effective_utilization, elapsed/window)`: green 0,255,0 · yellow 255,255,0 · orange 255,165,0 · red 255,0,0 | readings in the window, capped at 100; area-filled down to the x-axis (`fillx`) |
    | 3 | Projection | orange 255,100,0 to the 100 % crossing when it lands before reset; green 100,200,100 to the reset otherwise | from Now at the current %; absent when burn rate ≤ 0 or usage is already 100 % |
    | 4 | Now | 0,120,255 | vertical line at the current time |
    | 5 | Depleted | 255,100,0 | vertical line at the projected 100 % crossing |

    The hidden right-axis point then blanks the top-right canvas cell.
  - **Legend:** top-left of the canvas, one row per drawn signal in draw order. Each row is ` ⢕⢕ <label>`, padded to the longest label: `⢕⢕` in the signal's colour, the label in 100,100,100, and the labels are `Budget Pace`, `Usage`, `Projection`, `Now`, `Depleted`. It is drawn only when `wc ≥ 16` and `hc ≥` the number of rows.
  - **No colour background** anywhere: the terminal default.
- **FR2 — Header and gauges.** Above the chart, the three rows ccburn's `gauges.py` draws:
  - **Header:** the left half reads pace emoji, space, **bold magenta** `ccburn`, dim ` - `, then **bold cyan** `Session (5h)` / `Weekly`. The right half is right-aligned `⏰ ` plus `format_reset_time` in yellow (`Resets in 2h 30m`; `Resets Tue 4:00 PM` beyond 24 h; `Resets Tue 10/7 7PM` beyond 7 days; `Reset pending`). With no data, the emoji is `🔥` and the right half is dim `⏳ Loading...`.
  - **Usage:** `📊 Usage` (bold, in the utilization colour), a bar `width − 20` cells wide (ccburn: `width − 34`; see the value column below) drawn as Rich's ProgressBar draws it (`━` filled, `╸` half, `╺` boundary, back colour grey 95,95,95), and the right-aligned value `NN%`. The colour is `get_utilization_color(effective_utilization, budget_pace)`.
  - **Elapsed:** `⏳ Elapsed` (bold blue), a bar at budget pace in blue, and `NN%` in blue.
  - Layout widths: a 14-column label, 1-column gaps, a right-aligned value column. ccburn's is 18 wide, for monthly dollar amounts; the mod shows only percentages, so its value column is 4 and the bars take the rest (JJ, 2026-10-05: *"why don't the ... progress bars [reach all the way to the end]?"*). With no data, both rows are dim, with empty bars and `--%`.
- **FR2a — Too small.** When the pane body is under 40 columns or under 15 rows, the chart is replaced by the dim line `Pane too small for chart. Widen or heighten it.` (ccburn's compact layout); the header and gauges still draw.
- **FR2b — Formatting fidelity.** Every number formatted as Python formats it, including round-half-to-even (`62.5` → `62%`), so the mod and ccburn never disagree by one on the same reading.
- **FR3 — Metrics.** Same definitions and thresholds as the CLI:
  - budget pace = elapsed fraction of the window (`calculate_budget_pace`); window length 5 h for `five_hour`, 168 h for `seven_day`;
  - pace emoji from `utilization / budget_pace`: < 0.85 🧊, > 1.15 🚨, else 🔥; 🔥 when pace is 0 (`get_pace_emoji`);
  - burn rate in %/h by least-squares regression over in-window readings, 0 when there are fewer than 3 points or they span less than `min(window × 10 %, 6 h)` (`calculate_burn_rate`);
  - time to 100 % and whether it lands before the reset (the CLI's JSON `projection` block);
  - an expired window (`resetsAt` in the past) reads as 0 % (`effective_utilization`).
- **FR4 — Readings and history.** Readings come from `session.measure` and, at session start, `$.session.usage()`. Each reading is stored as `{ provider, kind, timestamp, percentUsed, resetsAt }` in the plugin's `$.store`, so the chart and the regression have points from earlier sessions. On write, readings older than one window length (5 h, 168 h; 7 days for a window the pane does not draw) are pruned, a repeat of the last reading within a minute is not stored again, and the store is capped at the newest 5,000 readings. Concurrent sessions of one profile share the store: a write merges by `(provider, kind, timestamp)` and never overwrites another session's readings.
- **FR5 — Opening and switching.** A `/ccburn` slash command opens (or focuses) the pane titled `ccburn`, showing the 5-hour window; `/ccburn weekly` shows the weekly window. Inside the pane a button toggles between the two. With `userConfig.openOnStart` (boolean, default `true`) the pane is also opened at session start, which the engine seats only on a terminal of 144 columns or more and otherwise holds until asked.
- **FR6 — Live redraw.** The chart redraws on every new reading and at least once a minute from a clock timer, so Now, budget pace and time-to-reset advance between readings.
- **FR7 — No data.** Before the first reading, the pane says it is waiting for Claude Code's first rate-limit reading. When the account reports no rate-limit windows at all (an Enterprise or API account, TC2), the pane says so plainly instead of showing an empty chart.
- **FR8 — Distribution.** The repo root carries `.claude-plugin/marketplace.json` listing the plugin, so `claude plugin marketplace add <owner>/<repo>` then `claude plugin install <plugin>@<marketplace>` installs it. The README leads with those two lines and a screenshot of the pane.

### Non-Functional Requirements

- **NFR1.** No hook blocks the conversation: the `session.measure` hook returns `next(e)` without awaiting the store write.
- **NFR2.** On surfaces without `Raster` (desktop, vscode, mobile) the pane shows the header and gauges (FR2) without the chart rather than failing to render.
- **NFR3.** `$.store` use stays under 1 MiB (the plugin's whole store caps at 4 MiB).
- **NFR4.** A redraw of a 120 × 30 chart completes within one frame budget the engine accepts without logging a refusal or a throw.

### Technical Constraints

- **TC1.** The mod API is early access and moves between releases; the authority is the engine-written `claude-code.d.ts` for the build in use, not this spec. Target Claude Code ≥ 2.1.289. The mod runtime has no Node and no DOM: everything external goes through `$`.
- **TC2.** `rateLimits` is populated only on a subscription (Pro / Max / Team) and is empty for Enterprise or API accounts (consistent with ccburn's `docs/statusline-rate-limits-research.md`). The live checks therefore run on a subscription profile.
- **TC3.** Readings arrive only while a Claude Code session runs and only when the engine has a response to read them from; the mod never calls Anthropic itself.
- **TC4 (pluriburn door).** Every stored reading carries `provider` (`"claude-code"` in v1), so a later Codex or other source adds readings, not a schema change. No other provider work is in scope.
- **TC5.** No runtime dependency on the ccburn Python package. ccburn's Python source and tests are the reference for FR1–FR3 behaviour.

## Pre-requisites (Human Required)

- [ ] The public GitHub repo `JuanjoFuchs/ccburn-mod` exists (JJ's call: it is outward-facing).
- [ ] JJ answers **Enable for this session** to the hot-reload prompt in the developing session (no rule or permission mode can answer it).
- [ ] A Claude Code session on a **subscription** profile is available for the live checks (TC2).

## Implementation Tasks

- [x] Add the plugin (`.claude-plugin/plugin.json`, `hooks/hooks.json`, the hooks module, `types/index.d.ts` for its `$.state` values) and the root marketplace manifest; record the layout in `PROJECT_UNDERSTANDING.md` and the test/validate commands in `AGENTS.md`.
- [x] Probe the two open engine questions before building on them: does a full-pane `Raster` pass the tree-size cap, and does the test kit serve `$.state`? Record the answers in `ai-docs/reference/mod-api.md`.
- [x] Port the metrics (FR3) and formatting (FR2b) as pure modules, carrying over the cases of ccburn's `tests/test_calculator.py`, `tests/test_formatting.py` and `tests/test_chart.py`.
- [x] Readings + history in `$.store` with merge, pruning and cap (FR4, NFR3).
- [x] Chart renderer producing `Raster` cells from readings, window and clock (FR1), plus header and gauges (FR2) and the too-small rule (FR2a).
- [x] A golden generator (`tools/`) that renders fixed fixtures through the real ccburn (its venv, patched clock, local time zone recorded per fixture, fixed hash seed) and writes the cell grids the TS renderer is tested against.
- [x] `/ccburn` command, pane, window toggle, `openOnStart` (FR5); minute timer (FR6); empty states (FR7); non-terminal fallback (NFR2).
- [x] Tests run by `claude plugin test`; `claude plugin validate` and `tsc -p` clean.
- [ ] README with the install lines and a screenshot (FR8). Install lines done; the screenshot waits on the live check (AC8).

## Acceptance Criteria

### Validation
- [x] AC1: `claude plugin validate` reports no refusals and lists hooks on `session.start`, `session.measure`, `command.run` and `ui.render` (Pane). — `integration`
- [x] AC2: `tsc -p` type-checks clean. — `integration`

### Metrics (FR3)
- [x] AC3: Budget pace, burn rate (including the < 3 points and < 10 %-span zero cases), time-to-100 and the 0.85 / 1.15 emoji boundaries match ccburn for the cases in `tests/test_calculator.py`. — `unit`
- [x] AC4: A window whose `resetsAt` is past reads 0 %, never its stale percentage. — `unit`

### Chart (FR1, FR2)
- [x] AC5: **Golden match.** For each golden fixture rendered by the real ccburn, the TS chart grid matches it cell for cell in glyph and foreground colour. The fixtures cover a 5-hour window with a green projection, a 5-hour window with a Depleted line, a weekly window, no readings, and two sizes (80 × 20, 60 × 14). — `unit` (golden fixtures; covers frame, labels, legend, braille, fill, draw order)
- [x] AC6: X-tick rules: `HH:MM` on the 5-hour window, `Tue 09h` style on the weekly; a grid tick within 10 % of Now or Depleted is dropped; overlapping labels resolve in ascending position. — `unit`
- [x] AC7: The `Raster`'s `columns` equal the pane's body width at 80 and at 160 columns, and its `rows` equal the body rows minus three (the header, which carries the window toggle, and the two gauges). — `integration` (`ui.mount` on `terminal`)
- [x] AC7a: Header and gauge text for fixed inputs match ccburn's: emoji, `Resets in 2h 30m`, bar glyphs and widths at W = 80 and 60, `40%` / `50%`, and the loading state. — `unit`
- [x] AC7b: A body under 40 × 15 shows the too-small line and no `Raster`. — `integration`
- [ ] AC8: In a live session, `/ccburn` and `/ccburn weekly` read the same as `ccburn session` / `ccburn weekly` open in a second terminal at the same moment. — `manual` (end-to-end eyeball across two real renderers and live data; AC5 already pins the renderer)

### Live behaviour (FR4–FR7)
- [x] AC9: A `session.measure` reading appears in the chart; advancing the mocked clock one minute with no reading moves the Now column and updates time-to-reset. — `integration`
- [x] AC10: Readings survive a module reload; a second writer's readings are merged, not overwritten; out-of-window readings are pruned. — `integration`
- [x] AC11: `/ccburn` opens the pane on the 5-hour window, `/ccburn weekly` on the weekly, and the toggle button switches between them. — `integration` (`ui.press`)
- [x] AC12: With `openOnStart: false` the pane does not open at session start; with `true` it is requested. — `integration` (`test(name, { options })`)
- [x] AC13: Before any reading the pane shows the waiting message; with `rateLimits` empty it shows the no-rate-limits message. — `integration`
- [x] AC14: On `desktop` the pane mounts the header and no `Raster`. Test bodies loop over `['terminal', 'desktop']`. — `integration`

### Distribution (FR8)
- [ ] AC15: From a clean profile, `claude plugin marketplace add <local checkout>` then `claude plugin install` installs it, and a new session's `/ccburn` draws the chart after the first turn. — `manual` (installs into a real profile). *Install half verified 2026-10-05 in a throwaway profile: the marketplace adds and the plugin installs, enabled. The session half waits on the live check.*

## Findings: implementation

- **Probe (2026-10-05, Claude Code 2.1.289):** the test kit's `$.ui.mount` accepted a `Raster` of up to 200 × 59 cells (about 190,000 base64 characters) in a pane. The documented 100,000-character tree cap applies to surface-module (`Client`) trees, which have no `Raster`. The kit serves `$.state` (`atom` / `read` / `update`) without extra hooks. Still to confirm live: that the terminal draws a full-pane `Raster` without refusal (AC8).
- **plotext's fill level:** `fillx=True` becomes a fill level of 0 in plotext's `check_fill`, not the 1 its `get_fill_level` appears to use. The first golden run caught this.
- **Golden generation needs ccburn's models clock pinned too:** `LimitData.is_expired` reads the clock in `ccburn.data.models`; left real, every fixture window reads as expired and the projection starts at 0.
- **The window toggle** rides in the header after the title (JJ, 2026-10-05: *"move that show session or show weekly thing to the title so that it's on the same row and we don't waste a row of space"*), so the chart takes the body rows minus three.
- **Live, 2026-10-05 (2.1.289, Max account, terminal not in fullscreen):** the readings arrive and the `Raster` chart draws in a real pane. Two defects found and fixed:
  - **Inline, a pane's body is never taller than what it draws.** `scroll.bodyRows` reported 5 (the header, gauges, a message and the toggle), so the chart never got room and the too-small line kept the pane small. The fix: inline, the pane always draws at least 24 rows (padding below the toggle) and asks for 24 on open, so `bodyRows` reports the room actually given and the chart fills it (down to ccburn's 8-row minimum). In that session the room was 12 rows, so the chart drew at 8. A docked pane (fullscreen) runs floor to ceiling and is unchanged.
  - **The engine prefixes a command's output with the plugin name**, so the result text no longer repeats `ccburn:`.
- **Usage only moves when the pane's own session gets a reply (measured 2026-10-05).** The mod API's only source of rate limits is the session's own last main-thread response (`session.measure`, `$.session.usage()`). An idle session's chart keeps moving with time (the minute timer: Now, elapsed, countdown), but its usage line does not see what other sessions on the same account burn. **A `$.model.complete` call does not refresh it:** a one-token haiku call every 20 s answered, yet `$.session.usage()` still read 5-hour 0 % / weekly 5 % while ccburn reported 6 % / 6 % for the same account. The experiment was removed; there is no sanctioned way to refresh an idle session's readings in 2.1.289.

## Testing Approach

### Validation Steps
1. `claude plugin validate <repo>` and `tsc -p <repo>` (AC1, AC2).
2. `claude plugin test <repo>` runs every `*.test.ts` (AC3–AC7b, AC9–AC14). Goldens are regenerated only by the `tools/` generator against ccburn, never edited by hand.
3. Live hot-reloaded session on a subscription profile, `ccburn` open in a second terminal for comparison (AC8).
4. Clean-profile install from the marketplace (AC15).

### Test Cases

| Input | Expected Output |
|---|---|
| `five_hour` 45 %, 2.5 h into the window | pace 0.50, ratio 0.90 → 🔥 |
| `five_hour` 30 %, 2.5 h in | ratio 0.60 → 🧊 |
| `five_hour` 80 %, 2.5 h in, rising 20 %/h | 🚨, orange projection, Depleted line at +1 h |
| 2 readings 10 min apart | burn rate 0, no projection line |
| `resetsAt` 1 min past, 97 % | reads 0 % |
| `rateLimits: []` | pane says the account reports no rate-limit windows |

## Usage Examples

```bash
# Install from GitHub
claude plugin marketplace add JuanjoFuchs/ccburn-mod
claude plugin install ccburn@ccburn-mod

# Develop locally
claude --plugin-dir .
claude plugin test .
```

Inside Claude Code:

```
/ccburn          # burn-up chart, 5-hour window
/ccburn weekly   # burn-up chart, weekly window
```

## Out of Scope

- A status line entry, toasts, or a band above the prompt (ccburn already serves a status line via `--compact`).
- Enterprise monthly credits and any ccburn-CLI integration (write-through to its history DB, CLI-backed data).
- Weekly-Sonnet / Opus / `spend_limit` windows (recorded, not drawn).
- `--since` / `--until` zoom views.
- Codex or any other provider (pluriburn); only the `provider` field (TC4).
- Publishing to Anthropic's official plugin marketplace.
- Any change to the ccburn Python repo.
- Creating or pushing to the GitHub repo (pre-requisite, JJ's call).

## References

- Mod API: the `claude-code.d.ts` the plugin-authoring skill writes for the build in use: `$.session.usage`, `SessionMeasureInput`, `SessionRateLimit`, `RasterProps`, `$.ui.open`, `$.store`, `$.clock`.
- ccburn: `src/ccburn/display/chart.py` (FR1), `display/gauges.py` and `display/layout.py` (FR2, FR2a), `utils/formatting.py` (FR2b), `utils/calculator.py` and `tests/test_calculator.py` (FR3, AC3), `docs/statusline-rate-limits-research.md` (TC2). plotext 5.3.2 in ccburn's `.venv` (`_build.py`, `_utility.py`) is the authority for FR1 geometry.
- Reference mod: Anthropic's `code-modernization` plugin (installed under `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/code-modernization/`): a working pane + `Raster` + command arguments + `userConfig` + test world.
