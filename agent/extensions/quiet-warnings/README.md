# quiet-warnings

Sets environment variables that hide runtime warnings from Node, Bun and Python. This keeps noisy warnings out of the agent context. Bash tool calls inherit these variables from the pi process.

## How it works

- On load, the extension reads the config and sets the variables if `enabled` is true.
- It sets `NODE_NO_WARNINGS=1` (Node and Bun) and `PYTHONWARNINGS=ignore` (Python).
- It sets a variable only if the variable is not already set. A value from launch time or from a project stays in place.
- Before it first sets a variable, it saves the original value. The saved values live on `globalThis` (`Symbol.for("pi.quiet-warnings.originals")`). They survive `/reload`, so the saved values stay the real originals.
- When the feature is off, the extension restores the original values. It deletes variables that had no original value.
- Ruby is not covered.
- The `/quiet-warnings` toggle lasts for the session only. It does not write the config file.

## Commands / Tools / CLI flags

| Command | Arguments | Action |
|---|---|---|
| `/quiet-warnings` | none (ignored) | Toggle warning suppression on or off. Shows `quiet-warnings: on` or `quiet-warnings: off`. |

## Configuration

Path: `agent/configs/quiet-warnings.json` (installed to `~/.pi/agent/configs/quiet-warnings.json`).

| Key | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | boolean | `true` | Only `false` turns the feature off at start. Any other value, or a missing key, means on. |

Current repo values:

```json
{
  "enabled": true
}
```

If the file is missing or invalid, the feature is on.

## Keybindings

None.
