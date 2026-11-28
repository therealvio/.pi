# no-sleep

Stops macOS from sleeping while pi works. It runs `caffeinate`. It shows no footer status and sends no chat messages for routine state changes. It shows only warnings and errors.

## How it works

- Starts `caffeinate -i -s [-d] -w <pi pid>`. The `-w` flag ties it to the pi process, so a crash cannot leave it running. `-d` is added only when the display must stay on.
- Does nothing on systems other than macOS.
- Hooks `session_start`, `agent_start`, `agent_end` and `session_shutdown`.
  - Scope `agent`: `caffeinate` runs only between `agent_start` and `agent_end`.
  - Scope `session`: `caffeinate` runs for the whole session.
- Stops `caffeinate` (SIGTERM, then SIGKILL after 1 s) on shutdown, on disable and on process exit.
- Warns when `caffeinate` fails to start or stops with an error.
- Spawns `caffeinate` in the pi process, not through the bash sandbox.
- Command changes (`/no-sleep`) last until the session ends. They do not write the config file.

## Commands

| Command | Argument | Action |
|---|---|---|
| `/no-sleep` | none or `status` | Show state: enabled, scope, process state, display, last error. |
| | `on` (or `enable`) | Enable sleep prevention. |
| | `off` (or `disable`) | Disable sleep prevention. |
| | `toggle` | Switch enabled state. |
| | `agent` | Set scope to `agent`. |
| | `session` | Set scope to `session`. |

Other arguments show a usage warning. Every valid call also shows the state.

## Configuration

Path: `agent/configs/no-sleep.json`.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | boolean | `true` | Turn sleep prevention on or off. |
| `scope` | `"agent"` \| `"session"` | `"agent"` | When to block sleep. Any other value means `agent`. |
| `display` | boolean | `false` | Also keep the screen on (`caffeinate -d`). |

```json
{
  "display": false,
  "enabled": true,
  "scope": "agent"
}
```

When the file or a key is missing, or the value has the wrong type, the default applies.

Environment variables override the file for one launch:

| Variable | Effect |
|---|---|
| `PI_NO_SLEEP` | `0`, `false`, `no` or `off` turns it off. Other values turn it on. |
| `PI_NO_SLEEP_SCOPE` | `session` sets scope `session`. Other values set `agent`. |
| `PI_NO_SLEEP_DISPLAY` | `0`, `false`, `no` or `off` keeps display sleep allowed. Other values keep the screen on. |

## Keybindings

None.
