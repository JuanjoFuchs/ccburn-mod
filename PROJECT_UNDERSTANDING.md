# PROJECT_UNDERSTANDING

## What this is

**ccburn-mod** is a Claude Code mod (a plugin of hot-reloaded TypeScript function hooks) that draws [ccburn](https://github.com/JuanjoFuchs/ccburn)'s burn-up chart, covering usage, budget pace, projection, Now and Depleted for the 5-hour and weekly windows, in a pane inside Claude Code. The repo is also the plugin's marketplace.


## Current state (2026-10-05)

- Harness only: no plugin code yet.
- `specs/001-burnup-mod.md` is refined and **pending JJ's review**.
- No GitHub remote yet (`JuanjoFuchs/ccburn-mod` is JJ's call to create).

## Key decisions

- **Native mod, not a wrapper around the ccburn CLI.** The engine pushes rate-limit readings to the mod (`session.measure`, `$.session.usage()`) and the terminal has a `Raster` cell grid, so there is no Python, no API call and no second install. Rationale table: spec 001 → Decisions.
- **Separate repo from ccburn** (JJ, 2026-10-05). Different stack, different distribution (plugin marketplace vs PyPI / npm / WinGet).
- **ccburn is the behavioural reference, not a dependency.** Pace, regression and chart semantics are ported from ccburn, checked out as a sibling at `../ccburn` (`src/ccburn/utils/calculator.py`, `src/ccburn/display/chart.py`, `src/ccburn/display/gauges.py`), with its `tests/test_calculator.py` cases as the oracle.
- **pluriburn door:** stored readings carry a `provider` field. No other provider work until the Claude Code chart ships.

## Layout

```
specs/                 numbered specs (the unit of work)
ai-docs/reference/     durable detail, one topic per file
```

The plugin layout (`.claude-plugin/`, `hooks/`, `types/`, tests) arrives with spec 001. Record it here when it does.

## Secrets / config

None. The mod reads usage from the engine; it holds no credentials. Do not add a `.env` unless a spec requires one.

## Gotchas

- The mod API is **early access**: trust the engine-written `claude-code.d.ts` for the running build over any doc ([ai-docs/reference/mod-api.md](ai-docs/reference/mod-api.md)).
- `rateLimits` is empty on Enterprise / API accounts, so live-check the chart on a subscription (Pro / Max / Team) profile.
- Hot reload needs a person to answer **Enable for this session** once per session; no permission mode answers it.
