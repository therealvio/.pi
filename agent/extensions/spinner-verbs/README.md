# spinner-verbs

Replaces the default "Working" loader text with a random verb from a list. The extension picks a new verb for each turn.

## How it works

- On load, the extension reads the verb list from the config. If the list is empty, it registers nothing.
- On each `turn_start` event, it picks one verb at random and sets the working message to `<verb>…`.
- The extension skips values that are not strings or are blank.
- It reads the list once at start.

## Commands / Tools / CLI flags

None.

## Configuration

Path: `agent/configs/spinner-verbs.json` (installed to `~/.pi/agent/configs/spinner-verbs.json`).

| Key | Type | Default | Meaning |
|---|---|---|---|
| `verbs` | array of strings | `[]` | Verbs to pick from. Pi adds `…` after the verb. |

Example (the repo file has more entries):

```json
{
  "verbs": [
    "Grabbing the D",
    "LFGing",
    "Doom-scrolling",
    "Locking-in"
  ]
}
```

If the file is missing, invalid or has no verbs, pi shows its default loader text.

## Keybindings

None.
