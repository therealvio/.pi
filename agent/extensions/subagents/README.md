# subagents

Adds a `subagent` tool. The main agent uses it to give a self-contained task to an isolated `pi` process. The subagent has its own context window. It returns only its final report. Tool calls, tool output and thinking stay in the subagent session. The extension shows live telemetry (turns, tools, cost) to the user, not to the model.

Adapted from [jay-aye-see-kay's subagents extension](https://github.com/jay-aye-see-kay/.pi/tree/e2ba7e182b7a3bb7675de0677bf1dbf29265fc10/agent/extensions/subagents). Changes: models come from `configs/subagents.json`, keys come from `keybindings.json`, blocked subagents are flagged, and the agentsview stamp is removed.

## How it works

- **Registration.** The extension reads `configs/subagents.json` when pi loads it. With no usable `models` key it registers nothing. With a malformed `models` value it registers nothing and shows an error at session start. When `PI_SUBAGENT` is set, it returns at once. This stops subagents from starting subagents.
- **Spawn.** Each call runs `pi --mode json --session-dir <dir> --session-id <id> --model <model> -n subagent/<id> -p <prompt>` with `PI_SUBAGENT=1`. The prompt has three parts: `## Goal`, `## Context`, `## Blockers`. The child reads the JSON event stream to count turns, tool calls, tokens and cost. The final assistant text is the result.
- **Directory.** The child runs in the `cwd` parameter if set. Otherwise it runs in the parent directory. A resumed subagent without `cwd` runs where it first ran (read from its session header).
- **Sessions.** Sessions are stored in `~/.pi/agent/subagent-sessions/<parent-session-id>/`. They do not show in `/resume`, `pi -r` or `pi -c`. The id has the form `sub-xxxxxxxx`. Every result ends with a footer: `[subagent <id> · N turns · $cost]`.
- **Resume.** Pass an earlier id as `resume`. The child reopens with its full context, and `goal` becomes the follow-up question. Use resume to get information, not to do new work. An id must match `sub-…` and its session file must exist.
- **Sandbox.** The child is not unsandboxed. The sandbox extension loads in the child. It gets the parent policy through `PI_SANDBOX_INHERIT`, including session grants. No UI exists in `--mode json`, so access that the parent does not have is denied and not prompted.
- **Blockers.** A subagent is "blocked" when its report has a line `BLOCKED: <reason>`, or when a tool result shows a sandbox denial. The result then starts with `SUBAGENT BLOCKED`. It tells the main agent to stop, not to work around the block, and to ask the user. The user also gets a warning notification.
- **Enable state.** The tool is on by default. `/subagent on|off|toggle` adds or removes it from the active tools. The state is saved as a `subagent-config` entry in the session and restored on session start and on session tree change.
- **Run list.** The extension rebuilds the list of runs from the session on `session_start` and `session_tree`. A run with no result (for example, cut off by a reload) shows as aborted.
- **Footer.** The status key `subagents` shows `👥` (on) or `👤` (off). After the first run it adds the run count and total cost, for example `👥 2 · $0.0123`. A `▶` prefix shows while a subagent runs.
- **Pruning.** At the first session start of each pi process, sessions whose file mtime is older than `keepDays` are deleted. Empty parent folders are removed. A pruned session cannot be resumed.
- **Hooks.** Events: `session_start`, `session_tree`.

## Commands / Tools / CLI flags

### Tool `subagent`

| Parameter | Type | Default | Meaning |
|---|---|---|---|
| `goal` | string | required | One sentence naming the outcome. On resume, the follow-up question. |
| `context` | string | required | All information the subagent needs. It cannot see the main conversation. |
| `model` | one of the configured model ids | first model in config | Model for the subagent. |
| `resume` | string or null | none | Id of a finished subagent (`sub-…`) to ask a follow-up. |
| `cwd` | string or null | parent directory | Working directory. Absolute, `~/…`, or relative to the current directory. It must exist. |

The tool fails (with a message) on an invalid or unknown `resume` id, a `cwd` that is not a directory, a spawn error, an abort, or a non-zero exit with no final text.

### Slash commands

| Command | Arguments | Action |
|---|---|---|
| `/subagent` | none or `toggle` | Switch the tool on or off. |
| `/subagent status` | | Open the status panel (TUI). In other modes, show whether the tool is on. |
| `/subagent on` | (alias `enable`) | Enable the tool. |
| `/subagent off` | (alias `disable`) | Disable the tool. |
| `/resume-subagents` | none | Open a session picker for subagent sessions (TUI only). |

Any other argument shows a usage warning.

`/resume-subagents` lists subagent sessions from all parent folders, newest first. It shows the first message as the name. When you pick one, the extension copies the file into the active session directory and switches to the copy. The original stays in `subagent-sessions/`, so the tool can still resume it by id.

### Status panel

An overlay with the mode, default model, run count, turns and cost, a cost line per model, and each run (newest first). Each run shows state (`▶` running, `✓` done, `✖` failed, `■` aborted, `⚠` blocked), id, model, turns, tool calls, tokens and cost, goal, a `cwd` if it differs, and the blocker or error. The panel updates live. Scroll with up/down and page up/down. Close with escape, enter, or the status key.

## Configuration

Path: `agent/configs/subagents.json` (installed to `~/.pi/agent/configs/subagents.json`).

| Key | Type | Default | Meaning |
|---|---|---|---|
| `models` | object: model id → description | none (tool not registered) | Models a subagent can use. The first entry is the default. Use models cheaper than the main model. Each description must be a non-empty string. The descriptions go into the tool schema for the main agent. |
| `keepDays` | positive number | none (keep forever) | Delete subagent sessions not changed for this many days. |

```json
{
  "keepDays": 30,
  "models": {
    "anthropic/claude-haiku-5-5": "fast and cheap, the default: search, lookups, summaries, running tests",
    "anthropic/claude-sonnet-5-5": "stronger, still cheaper than the main model: reviews, tricky debugging, multi-step edits"
  }
}
```

If the file is missing or unreadable, the tool is not registered and the extension stays silent. If `models` is not an object, is empty, or has an empty description, the tool is disabled and an error shows at session start. A `keepDays` value that is not a positive number turns pruning off.

## Keybindings

Set in `agent/keybindings.json`. Each value is a string or an array of strings. With no entry, no shortcut is registered. The slash commands always work.

| Action id | Current key | Default | Action |
|---|---|---|---|
| `ext.subagent.status` | `ctrl+shift+a` | none | Open the status panel. The same key closes it. |
| `ext.subagent.toggle` | not set | none | Toggle the subagent tool on or off. |
