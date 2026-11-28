# prompt-stash

Keeps one stash slot for the prompt editor. Press one key to swap the editor text with the stash. Use it to park a draft, send another message, and get the draft back.

## How it works

- On load, the extension reads `ext.stash.swap` from `agent/keybindings.json`. Pi has no built-in knowledge of `ext.*` ids, so the extension reads the file itself.
- It registers one shortcut for each key bound to that id.
- When you press the key, the editor text and the stash change places. The editor gets the old stash. The stash gets the old editor text.
- If both are empty, it shows the notice `Nothing to stash`.
- When the stash is not empty, the status bar shows `stash: <first line>`. The preview is the first line of the stash, cut to 30 characters and ended with `…`.
- The stash lives on `globalThis` (`Symbol.for("pi.prompt-stash")`). It survives `/reload`, `/new`, `/resume` and `/fork`. Pi exit clears it.
- On `session_start`, the extension shows the status for the saved stash.
- If no key is bound, the extension registers no shortcut. On `session_start` it shows a warning: `prompt-stash: no key for "ext.stash.swap" in keybindings.json`.

## Commands / Tools / CLI flags

None. The extension registers only shortcuts.

## Configuration

No config file. The key is set in `agent/keybindings.json` (see below).

## Keybindings

| Action id | Current key | Default when unset | Action |
|---|---|---|---|
| `ext.stash.swap` | `alt+shift+up` | none (the extension is inactive and warns) | Swap the editor text with the stash |

The value can be a string or an array of strings. The id uses `stash`, not the folder name `prompt-stash`.
