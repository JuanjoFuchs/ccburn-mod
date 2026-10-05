---
title: Claude Code mod API, as it applies to ccburn-mod
description: "What the Claude Code mod engine gives this plugin (rate-limit readings, panes, Raster, store, clock), how a mod is loaded, tested and distributed, and where the authoritative types live. Read before writing or changing any hook, and before trusting any API detail in a spec."
applies_to: [hooks, rendering, distribution, tests]
read_before: [implementing a spec, changing a hook, debugging a mod that does not load]
---

# Claude Code mod API: what ccburn-mod relies on

Researched 2026-10-05 against Claude Code **2.1.289**. The API is early access and moves between releases.

> 🔴 **The authority is the engine-written declaration file, not this doc.** Load the `plugin-authoring` skill in Claude Code; it writes `claude-code.d.ts` for the running build and names its path. Once the mod has loaded, the same types sit in `<mod>/.claude-plugin/types/`. Grep it for the name at hand (`'session.measure'`, `RasterProps`, `SessionRateLimit`) and read the declaration. If this doc and the types disagree, the types win. Update this doc when that happens.

## Shape of a mod

Three files: `.claude-plugin/plugin.json` (name, version, description; `types` when it keeps `$.state`), `hooks/hooks.json` (`{ "modules": ["./register.tsx"] }`), and the hooks module exporting `register(on, options)`. Every hook is `($, e, next)`. The module runs with **no Node and no DOM**: everything outside it goes through `$`. JSX uses the global `h`. Element constructors come from `$.ui.resolve(e)` per surface.

## The data: rate limits come from the engine

- `$.session.usage()` → `{ startedAt, context, rateLimits, cost }`. `rateLimits` is `SessionRateLimit[]`: `{ kind: 'five_hour' | 'seven_day' | gateway 'spend_limit', percentUsed: 0–100 (one decimal), resetsAt?: ISO string }`. The plain call costs nothing.
- `session.measure` event: the same figures, **pushed** after each main-thread turn and when a rate-limit window moves a whole point; `e.changed` names which units moved. Observe and return `next(e)`.
- `rateLimits` is **empty off a subscription** (Enterprise / API accounts), and before the first API response.

## Drawing

- **Pane:** `$.ui.open({ id, title })`, drawn by `on('ui.render', { component: 'Pane', requestId: id }, ...)`. A pane opened because the person asked (command, button) seats at any width. One opened unasked (from `session.start`) seats only from 144 columns and waits below that. Size the tree to `e.props.bodyColumns`.
- **Raster** (terminal only): one element, a `columns × rows` grid of cells, each `[codePoint, fg, bg]` packed as base64 little-endian u32 triplets. Code points are width-1 BMP chars (braille and blocks are fine). Colours are `0x00RRGGBB`, or `0x01000000` for the terminal default. `$.ui.blit` repaints a mounted Raster without a render pass. Not available on desktop / vscode / mobile.
- **State a drawing reads** goes in `$.state` (declared in `types/index.d.ts` under `interface PluginState`), read with `read($, atom)` while drawing and written with `update($, atom, fn)` from handlers or other events. A write redraws exactly the readers. Never write while drawing. Module variables are lost on every hot reload.
- `$.ui.status(text)`, `$.ui.toast(text)` exist; v1 does not use them (spec 001 Out of Scope).

## Persistence, time, processes

- `$.store`: per-plugin JSON key-value store under the user's Claude config dir. Survives sessions and reloads, **4 MiB cap** for the whole plugin, shared by concurrent sessions of one profile (so writes must merge, not overwrite).
- `$.clock.now()`, `$.clock.every(ms, fn)` (timers die on reload; start them from `session.start`).
- `$.process.run(argv)`: one-shot host command, no shell, 30 s default timeout. Not needed by v1.

## Commands

`$.command.register({ name, description })` in `session.start`, answered by `on('command.run', { command: name }, ...)` returning `{ text }`.

## Developing, testing, shipping

- **Develop:** loading the `plugin-authoring` skill watches a per-session mods folder, and the person must answer **Enable for this session** (nothing else can). Or run `claude --plugin-dir <repo>` for a watched folder. A save reloads the module when the turn ends.
- **Check:** `claude plugin validate <dir>` reports the hooks and everything the engine would refuse. `tsc -p <dir>` type-checks once types are laid. `claude plugin test <dir>` runs `*.test.ts` against the engine (`import { test, expect, mock } from 'claude-code/testing'`; `ui.mount` with a named `surface`; loop test bodies over `['terminal', 'desktop']`).
- **Debug:** `claude --debug`. A refused tree logs `ui.render (<Component>): a hook returned a tree that does not validate` with the reason.
- **Ship:** a repo with `.claude-plugin/marketplace.json` is a marketplace. Users run `claude plugin marketplace add <owner>/<repo>` then `claude plugin install <plugin>@<marketplace>`. A marketplace added from a local folder with a relative `source` is read from that folder, and `/reload-plugins` picks up edits.
