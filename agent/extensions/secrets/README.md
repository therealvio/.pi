# secrets

Loads one-off secrets into the environment and hides all secret values in tool output.

## How it works

**Loading.** The extension reads two optional files. Both use `KEY=value` lines. The parser accepts an `export` prefix, quotes, and `#` comments.

| File | When it loads |
|---|---|
| `~/.pi/agent/configs/.env.private` | Global. When the extension loads. |
| `<project>/.pi/.env.private` | Per project. On `session_start`, and only if the project is trusted. |

A project file is untrusted input: a variable such as `NODE_OPTIONS` can run code. So the extension reads it only after project trust.

Precedence, highest first: shell and `.env` values, project `.env.private`, global `.env.private`. The extension does not replace a variable that is already set. The one exception: a project file can replace a value that came from the global `.env.private`.

The extension undoes the project values on `session_shutdown` and at the next `session_start`. The record of what it set lives on `globalThis`, so `/reload` keeps it.

**Redaction.** On every `tool_result` event, the extension replaces each secret value with `<redacted:KEY>`. This covers text content and structured content, and tools nested in codemode. The key names come from `~/.pi/agent/configs/.env`, the global `.env.private`, and the project `.env.private`. The value comes from `process.env` at that time, so a shell value is hidden too. Values shorter than 8 characters are not hidden. Longer values are replaced first.

This stops accidental leaks (`env`, `echo $X`, reading the file). It does not stop deliberate exfiltration. It does not cover `!` commands that the user runs.

## Commands

| Command | Arguments | Action |
|---|---|---|
| `/secrets` | none | Lists the hidden key names, never the values. Marks a key as `project` if it comes from the project file. Marks a key "not set or too short, not hidden" when it has no redaction rule. Needs a UI. |

## Configuration

No file in `agent/configs/`. The extension reads these env files:

- `~/.pi/agent/configs/.env` (key names only; `env-loader` from pikit loads the values)
- `~/.pi/agent/configs/.env.private`
- `<project>/.pi/.env.private`

A missing file is normal and gives no error. The extension uses `homedir()`, not `getAgentDir()`, for the config directory.

## Keybindings

None.
