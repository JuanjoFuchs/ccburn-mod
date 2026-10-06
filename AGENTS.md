# AGENTS.md

ccburn-mod: a Claude Code mod that draws ccburn's burn-up chart in a pane inside Claude Code.

**CRITICAL: You MUST read the required files BEFORE taking action.** This is not optional.

## Required Reading by Task

| User asks about... | READ THIS FIRST | Then act |
|---|---|---|
| Understanding the project, its state, why it exists | @PROJECT_UNDERSTANDING.md | Then the spec for the task |
| Implementing or refining the mod, the chart, readings, history | @specs/001-burnup-mod.md | Refine, then build and verify against its ACs |
| Any hook, `$` call, pane, Raster, store, test or packaging detail | @ai-docs/reference/mod-api.md | Then load the `plugin-authoring` skill and grep its `claude-code.d.ts`; the types win |
| Matching ccburn's pace math or chart look | `../ccburn/src/ccburn/utils/calculator.py`, `../ccburn/src/ccburn/display/chart.py` (sibling checkout) | Port behaviour; ccburn's tests are the oracle |
| Writing or changing a spec | @specs/001-burnup-mod.md | Follow its structure; every AC names a validation method |

**Do not skip this step.** Read the linked file first, then act.

## Conventions

- Language: TypeScript hooks module; no Node or DOM APIs. Reach the outside world only through `$`.
- Verify before done: `claude plugin validate .` → `tsc` (see mod-api.md for type-checking before the mod is loaded) → `claude plugin test .`, then the spec's manual checks. Build-only is not done.
- Goldens: never hand-edit `tests/fixtures/golden/`; change `tools/make-goldens.py` and rerun it with ccburn's venv (`PYTHONHASHSEED=0`).
- Live-check on a **subscription** profile; Enterprise accounts get no rate-limit readings.
- Commits: gitmoji subject (matches ccburn): ✨ feature, 🐛 fix, 📝 docs, ♻️ refactor, 🔖 release. Commit with an explicit pathspec: `git commit -- <paths>`.
- New durable knowledge → a file in `ai-docs/` plus a row here; keep `PROJECT_UNDERSTANDING.md` lean.

## Workflow

1. READ → routing table, then the files it names
2. PLAN → against the spec's acceptance criteria
3. IMPLEMENT → follow conventions
4. VERIFY → validate, type-check, test, manual ACs
5. RECORD → findings into the spec; current state into PROJECT_UNDERSTANDING.md

## Current State

- Spec 001 in progress: chart ported and golden-matched; pane and command wired. Live checks pass (spec 002 complete). Published on GitHub.
