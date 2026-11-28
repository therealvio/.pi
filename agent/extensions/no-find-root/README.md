# no-find-root

Blocks `find /` in bash tool calls. This command walks the whole filesystem and can run for more than 10 minutes. The model gets a reason that tells it to narrow the search.

Adapted from [jay-aye-see-kay/.pi](https://github.com/jay-aye-see-kay/.pi/blob/7ca98f3/agent/extensions/no-find-root.ts). Change from upstream: a command with `-maxdepth <n>` is allowed. The block message suggests `-maxdepth`, so blocking it would leave the model stuck.

## How it works

The extension hooks the `tool_call` event for the `bash` tool. It blocks a command when both are true:

- The command matches `\bfind\s+\/` followed by a space, end of text, or one of `; | & )`. So `find /` is blocked, and `find /usr` is not.
- The command has no `-maxdepth <digits>`.

A blocked call returns `{ block: true, reason }`. The reason suggests: search a specific directory, add `-maxdepth`, use `fd` or `rg --files` on a path, use `which` or `command -v` for binaries, and use `mdfind` on macOS.

The check is a text match. It does not parse the shell. A `-maxdepth` anywhere in the command allows the whole command.

## Commands / Tools / CLI flags

None.

## Configuration

None.

## Keybindings

None.
