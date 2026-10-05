# ccburn-mod

[ccburn](https://github.com/JuanjoFuchs/ccburn)'s burn-up chart, inside Claude Code.

```bash
claude plugin marketplace add JuanjoFuchs/ccburn-mod
claude plugin install ccburn@ccburn-mod
```

Then, in any Claude Code session:

```
/ccburn          # the 5-hour session window
/ccburn weekly   # the 7-day window
```

The pane shows what `ccburn` shows in its own terminal: the pace emoji (🧊 behind, 🔥 on pace, 🚨 ahead), Usage and Elapsed gauges, and the burn-up chart with budget pace, your usage, the projection to the reset, and the moment you would run out. The button under the chart (or `w` while the pane has focus) switches windows.

## How it works

ccburn-mod is a Claude Code **mod**: a plugin of TypeScript hooks that Claude Code loads and draws. Claude Code hands it the rate-limit readings it already has after every reply, so the mod makes no API calls and needs no Python, no credentials and no `ccburn collect` in your status line. Readings are kept in the plugin's own store so the chart and the burn rate reach back past the current session.

The chart is a TypeScript port of ccburn's, and the tests hold it to ccburn's own output cell for cell.

## Requirements

- A Claude Code build with mods (the plugin API this was built against is 2.1.289). The mod API is early access, so a future Claude Code release may need an update here.
- A **Pro, Max or Team** subscription. Claude Code reports no rate-limit windows for Enterprise or API accounts, so the pane says there is nothing to chart. For Enterprise monthly credits, use [ccburn](https://github.com/JuanjoFuchs/ccburn) itself.

## Settings

| Setting | Default | |
|---|---|---|
| `openOnStart` | `true` | Open the pane when a session starts. Claude Code only seats a pane nobody asked for on a wide terminal (144+ columns); otherwise run `/ccburn`. |

Change it in `/config` or with `claude plugin configure ccburn`.

## Development

```bash
claude --plugin-dir .        # run Claude Code with this checkout loaded
claude plugin validate .     # what the engine sees and would refuse
claude plugin test .         # unit, golden and pane tests
```

The golden charts in `tests/fixtures/golden/` are rendered by the real ccburn. Regenerate them with ccburn checked out next to this repo:

```bash
PYTHONHASHSEED=0 ../ccburn/.venv/bin/python tools/make-goldens.py
```

## License

MIT
