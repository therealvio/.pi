# snippets

Expands a short trigger word at the end of the editor text into a full instruction. Type `refactor the parser, kiss`, press the key, and `kiss` becomes its snippet text.

## How it works

- On load, the extension reads snippets from `agent/configs/snippets.json`. It reads the key from `ext.snippets.expand` in `agent/keybindings.json`.
- It registers one shortcut for each bound key.
- When you press the key, it takes the last run of non-space characters in the editor as the trigger. If a snippet has that name, it replaces the trigger with the snippet text. If not, nothing happens.
- Each press expands one trigger. To use several snippets in one message, type a trigger, press the key, and repeat.
- The extension skips invalid entries: names that contain whitespace, values that are not strings, and empty values.
- Snippets load once at start.
- If no key is bound, the extension registers no shortcut. On `session_start` it shows a warning: `snippets: no key for "ext.snippets.expand" in keybindings.json`.

## Commands / Tools / CLI flags

None. The extension registers only shortcuts.

## Configuration

Path: `agent/configs/snippets.json` (installed to `~/.pi/agent/configs/snippets.json`).

| Key | Type | Default | Meaning |
|---|---|---|---|
| `snippets` | object (string → string) | `{}` | Map of trigger word to expansion text. A trigger cannot contain whitespace. |

Current repo values:

```json
{
  "snippets": {
    "23": "give me 2-3 options",
    "brief": "keep it brief: bullet points, focus on the why, no preamble",
    "fix": "identify the root cause, explain it, then provide the fix with a brief justification",
    "kiss": "keep it simple: pick the most straightforward approach, we can improve later if needed",
    "pat": "look at how similar things are already done in this codebase and follow that pattern",
    "sand": "this is a sandbox issue that shouldn't be there, stop the current task and focus only on adjusting the sandbox",
    "sub": "use a subagent for this",
    "tdd": "use red/green TDD: write a failing test first, then the minimal code to make it pass, then refactor"
  }
}
```

If the file is missing or has no valid snippets, the key does nothing.

## Keybindings

| Action id | Current key | Default when unset | Action |
|---|---|---|---|
| `ext.snippets.expand` | `ctrl+j` | none (the extension is inactive and warns) | Expand the trigger word before the cursor end of the editor text |

The code comment says the default key is `ctrl+j`, but the code has no default. You must set the id in `agent/keybindings.json`. Pi also uses `ctrl+j` for new line, so `agent/keybindings.json` sets `tui.input.newLine` to `shift+enter` only.
