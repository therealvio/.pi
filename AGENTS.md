# pi config

This repo holds the user's config for [pi](https://pi.dev), the earendil-works coding agent. It is the source of truth: `setup.sh` copies it into `~/.pi/agent`, where pi reads it.

## Layout

`agent/` mirrors `~/.pi/agent/`. A file at `agent/<path>` installs to `~/.pi/agent/<path>`. `pi-lens/` mirrors `~/.pi-lens/` the same way.

| Path | Purpose |
|---|---|
| `agent/AGENTS.md` | Global instructions for every pi session. Not about this repo. |
| `agent/settings.json` | Model, compaction, packages, skill filters. |
| `agent/sandbox.json` | Policy for the sandbox extension (sandbox-runtime). |
| `agent/configs/<name>.json` | Config for one extension, read by that extension. |
| `agent/keybindings.json` | Key bindings, including custom `ext.<name>.<action>` ids. |
| `agent/extensions/<name>/index.ts` | Local extensions, one folder each. |
| `pi-lens/config.json` | Global config for the pi-lens package. opengrep is off: it hangs behind Netskope. |
| `setup.sh` | Installs `agent/` into `~/.pi/agent` and `pi-lens/` into `~/.pi-lens`. |

## How changes reach pi

1. Edit files under `agent/`.
2. Commit them. `setup.sh` copies only git-tracked files.
3. The user runs `./setup.sh` (`--dry-run` first), then `/reload` in pi.

Do not write to `~/.pi/agent` yourself. The user promotes changes with `setup.sh`.

`setup.sh` merges `settings.json` into the live file and never deletes files. When you remove a file or a settings key, tell the user to delete it from `~/.pi/agent` too.

## Conventions

- **Prefer packages to copies.** Add third-party skills and extensions as entries in `settings.json` `packages`, pinned to a tag, version or commit, with filters that load only what is needed. Copy code into `agent/extensions/` only when it is ours or adapted.
- **Let installers own their files.** If a tool installs its own pi extension (for example `rtk init -g --agent pi`), run the installer from `setup.sh` and do not commit the file.
- **Extension config goes in `agent/configs/<name>.json`**, not in `settings.json` or as constants in the code, for any value the user may want to change (models, lists, limits, toggles). This applies to our own extensions and to adapted copies. Read it from `join(getAgentDir(), "configs", "<name>.json")`, as `session-title` and `subagents` do. When the file is missing, use a safe default or turn the feature off. Put each key binding in `agent/keybindings.json` under an `ext.<name>.<action>` id, and have the extension read it, as `snippets` does.
- **One folder per extension**, with `index.ts` as the entry point. An extension with npm dependencies keeps its own `package.json` and `package-lock.json`; `setup.sh` runs `npm ci` for it.
- **Sort JSON.** Keep object keys and string lists in `settings.json` and `sandbox.json` in alphabetical order (`jq -S`).
- **No secrets.** `auth.json`, `sessions/`, `install/` and similar live pi state stay out of the repo.

## Facts that are easy to get wrong

- Pi reads `AGENTS.md` or `CLAUDE.md` from `~/.pi/agent` and from the working directory and its parents. It has no rules directory and does not read `~/.claude`.
- Pi has no built-in sandbox. `agent/extensions/sandbox` wraps the bash tool and `!` commands with `@anthropic-ai/sandbox-runtime`. Pi's read, write and edit tools run in-process; the extension gates them separately.
- Skills in `~/.agents/skills` are shared with Claude Code. To hide one from pi only, add `-<path>` to the top-level `skills` list in `settings.json`. Do not uninstall it.
- Pi docs ship with the install: `~/.pi/agent/install/releases/<version>/node_modules/@earendil-works/pi-coding-agent/docs/`. Read them before you guess at settings or extension APIs.
- Use the `pi-extension-builder` skill when you write or change an extension.
