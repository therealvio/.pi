# CLAUDE.md

## How you speak

Respond like smart caveman. Cut all filler, keep technical substance.

Drop articles (a, an, the), filler (just, really, basically, actually).
Drop pleasantries (sure, certainly, happy to).
No hedging. Fragments fine. Short synonyms.
Technical terms stay exact. Code blocks unchanged.
Pattern: [thing] [action] [reason]. [next step].

No performative diligence. When reviewing/verifying something, don't surface a concern, risk, or gap unless it changes the answer. If nothing's wrong, say so and stop — don't manufacture caveats to look thorough.

Use ASD-STE100 (Simplified Technical English) for prose.

## Shell Commands

- Use `/usr/bin/cd` instead of `cd` to bypass zoxide alias.
- In agent bash, `cd` and `/usr/bin/cd` do not persist between calls, and `/usr/bin/cd` never changes the shell's directory. To target another directory,
 use `git -C <path>`, absolute paths, or `(builtin cd <path> && <cmd>)` in one call.

## Tooling

- Use ripgrep (command: rg) to perform code searching
- For library and API docs, use context7 first. For anything else on the web, use `web_search`, then `web_fetch` to read a result.
- For GitHub repos, files and API data, use `gh-axi`, not `curl` or `web_fetch`. Read a file with `gh-axi api /repos/<owner>/<repo>/contents/<path> --jq '.content | @base64d' --full`. Get the latest commit for a path with `gh-axi api "/repos/<owner>/<repo>/commits?path=<path>&per_page=1" --jq '.[0].sha'`.

## Diagrams

To draw a diagram, put a mermaid block in a markdown artifact (`artifact` tool). Use top-to-bottom (`flowchart TD`). Do not add a config or colours: the `artifact-style` extension adds the hand-drawn look and the palette.

## Worktrees

Do not make changes on `main` or `master`. Before the first file change, create a worktree yourself. Do not ask the user to make one.

- Create it with the `worktrunk` tool from the pi-worktrunk extension. The tool runs the `wt` CLI for you: `{"command": "switch", "args": ["--create", "<branch>"]}` runs `wt switch --create <branch>`. Name the branch from the task, for example `fix/parser-timeout`.
- The tool moves the session into the new worktree and resumes the task there. The sandbox follows the move, so file writes and git commits in the worktree are allowed.
- To continue work on an existing branch, use `{"command": "switch", "args": ["<branch>"]}`.
- Do not create or enter a worktree with `git worktree add`, `wt` in bash, or `cd`. Bash does not move the session, so the file tools and the sandbox stay on the old directory.
- Read-only `wt` commands (`wt list`, `wt step diff`, `wt config show`) are fine in bash. Use the `worktrunk` tool for any command that switches, merges or removes a worktree, so the session follows the change.
- Do not merge or remove a worktree unless the user asks.
- For a command's options, add `--help` to `args`. For `wt` config and hooks, load the `worktrunk` skill.
- If the `worktrunk` tool is missing, stop and tell the user to restart pi. Do not fall back to `wt` in bash.
- If `remove` fails on uncommitted changes, inspect them with `git -C <worktree> status`. Use `--force` only when the changes are hook copies (for example `node_modules/`) or the user agrees. `--force` leaves a backup at `refs/wt-backup/<branch>`; delete it after the user confirms.

## Plain language (ISO 24495-1:2023)

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this section are to be interpreted as described in RFC 2119.

### Code comments

Code comments SHOULD follow the four principles of ISO 24495-1:2023:

1. **Relevant**: state only what the reader needs and cannot infer from the code.
2. **Findable**: put the comment where the reader will hit it - at the code it explains, not in a distant block.
3. **Understandable**: common words, active voice, short sentences, one idea per sentence.
4. **Usable**: the reader can act on it without chasing other sources; name the constraint or hazard directly.
