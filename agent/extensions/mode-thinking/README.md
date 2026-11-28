# mode-thinking

Sets the thinking level when the pikit plan mode or chat mode changes. Plan mode uses one level. All other modes use another level.

## How it works

- The extension listens to the `plan-mode:state` and `chat-mode:state` events on `pi.events`. Each event carries `{ mode }`.
- It acts only on a real mode change for that event. Pikit repeats these events on unrelated status updates. A repeat must not undo a level that you set by hand (for example with `ctrl+shift+t`).
- The level comes from both modes together, not from the last event:
  - `plan-mode:state` mode is `plan`: use the `plan` level.
  - Any other state (off, execute, chat): use the `default` level.
- This way, on a resumed plan session, the first `off` from chat mode does not drop the plan level.
- The extension calls `pi.setThinkingLevel()`. Pi clamps the level to what the model supports, so the extension does not check the model.
- The extension reads the config once at load.

If pikit renames the events, the extension stops without an error.

## Commands / Tools / CLI flags

None.

## Configuration

Path: `agent/configs/mode-thinking.json` (installed to `~/.pi/agent/configs/mode-thinking.json`).

| Key | Type | Default | Meaning |
|---|---|---|---|
| `plan` | string | `high` | Thinking level while plan mode is on. |
| `default` | string | `medium` | Thinking level in all other modes. |

Valid levels: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. An unknown or non-string value uses the default for that key.

```json
{
  "default": "medium",
  "plan": "high"
}
```

When the file is missing or invalid, both keys use their defaults.

## Keybindings

This extension has no keybindings. It does not block the pi thinking-cycle key (`app.thinking.cycle`, `ctrl+shift+t` here). That key works until the next real mode change.
