# session-title

Names each pi session with a small LLM call. The name shows in `/resume` and in the terminal title, so terminal tabs get a useful label.

## How it works

- The extension is off when the config file is missing or has no valid `model`.
- It does nothing when pi has no UI (print or json mode, subagents).
- **First prompt** (`input` event): when the session has no name and no user message yet, the extension asks the model for a title from the raw input. It runs in the background and does not wait for the turn.
- **Drift check** (`agent_settled` event): when the number of user messages equals `retitleAt`, the extension sends the current title and the conversation to the model. The model replies `KEEP` or a new title. If the session has no name yet (the first call failed), it makes a first title instead.
- **Manual names are safe.** The extension records each title it sets as a custom entry of type `session-title`. If the current name differs from the last recorded one, the name counts as manual. The extension does not change it. `/retitle` is the only exception.
- A new request cancels the one in flight. `session_shutdown` cancels it too.
- Title style: 3 to 6 words, under 50 characters, sentence case, plain text. The code cleans the reply and clips it to 60 characters.
- The conversation sent to the model has user messages clipped to 1500 characters and assistant text to 500 characters. The total is limited to the last 8000 characters.
- The model call uses `maxTokens: 1024`. If the model is not found or the call does not stop normally, the extension shows a warning.

## Commands

| Command | Arguments | Action |
|---|---|---|
| `/retitle` | none | Makes a new title from the conversation. It replaces the current name, including a manual one. Shows "nothing to name yet" when there are no messages. |

## Configuration

Path: `agent/configs/session-title.json` (installs to `~/.pi/agent/configs/session-title.json`).

| Key | Type | Default | Meaning |
|---|---|---|---|
| `model` | string | none | Model as `provider/model-id`. It must contain `/`. Without it, the extension is disabled. |
| `retitleAt` | integer >= 0 | `3` | The user-message count that triggers the drift check. `0` turns the check off. An invalid value gives the default. |

```json
{
  "model": "anthropic/claude-haiku-5-5",
  "retitleAt": 3
}
```

If the file is missing or not valid JSON, the extension is disabled.

## Keybindings

None.
