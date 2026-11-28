# lens-panel

Replaces the pi-lens footer widget with one short footer status. A key or a command opens the findings in an overlay. The footer keeps a fixed height, however many findings exist.

## How it works

- Listens to the `pilens:diagnostics` event on `pi.events`. Each event holds the full set of findings for each file it names. A file entry replaces the old entry. An empty list marks the file as clean.
- Drops events with a `seq` that is not higher than the last one seen.
- Sets the footer status `lens-panel` to `🔍 Lens: ✖ <errors> ▲ <warnings> ● <other>`. The status is cleared when no findings exist.
- Wraps the shared `ui.setStatus`. It keeps the pi-lens status `pi-lens-lsp` for the overlay and does not pass it to the footer. All other status keys pass through.
- The overlay shows the language servers (active and failed), the linters that reported findings, and the findings. Findings are grouped by file and sorted by severity, then line.
- On `session_start`, the extension clears all findings and linters. It warns when no key is set for `ext.lens-panel.open`.
- The overlay needs interactive (TUI) mode. In other modes the extension shows a warning.

Setup needed outside this repo:

- Turn off the pi-lens widget in `~/.pi-lens/config.json`: `{ "widget": { "visible": false } }`.
- Do not set `PI_LENS_BUS_PUBLISH=0`. With that value, the extension gets no data.

Overlay keys: `↑`/`↓` scroll, `pgup`/`pgdn` page, `esc` or `enter` close. The open key also closes the overlay. These use the `tui.select.*` bindings.

## Commands

| Command | Arguments | Action |
|---|---|---|
| `/lens-panel` | none | Open the findings overlay. |

## Configuration

No config file. The extension reads only `agent/keybindings.json`.

## Keybindings

| Action id | Current key | Default |
|---|---|---|
| `ext.lens-panel.open` | `ctrl+shift+e` | None. |

The value is a key string or an array of key strings. When unset, no shortcut is registered and a warning shows at session start. `/lens-panel` still works.
