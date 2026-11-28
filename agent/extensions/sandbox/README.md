# sandbox

Limits what the agent can do. It runs `bash` inside an OS sandbox (`@anthropic-ai/sandbox-runtime`: `sandbox-exec` on macOS, bubblewrap on Linux). It also checks the paths and hosts used by pi tools that run in the pi process. When the agent needs more access, the extension asks you. Adapted from `jay-aye-see-kay/.pi`.

## How it works

### Modes

| Mode | OS sandbox | Behaviour |
|---|---|---|
| `sandbox` (default) | On | `bash` runs in the sandbox. `read`, `write`, `edit` are checked against the allow and deny lists. Unknown hosts and paths cause a prompt. |
| `prompt` | Off | No OS sandbox. Every `read`, `write`, `edit`, `bash` and `!` command asks for confirmation each time. Nothing is remembered. |

Switch mode at run time with `/sandbox enable`, `/sandbox prompt`, `/sandbox toggle`, or the toggle key. The footer shows the state: `🛡️` (sandbox on), `🛡️ inactive` (sandbox mode, but init failed), `🔓` (prompt mode).

If `enabled` is `false`, the extension only shows a notice and does nothing else. The toggle refuses in this case.

The OS sandbox works on macOS and Linux only. On other systems the extension shows a warning.

### Events and tools

- `session_start`: changes the process directory to the session directory, reads the config, and starts the sandbox. Relative paths such as `.` resolve against this directory.
- `session_shutdown`: resets the sandbox.
- `tool_call`: checks `read`, `write`, `edit`, and the `path` argument of the `artifact` tool (as a read). In `prompt` mode it asks for each call, including `bash`.
- `user_bash` (`!` commands): runs in the sandbox, or asks in `prompt` mode.
- `tool_result`: cleans up after `ctx_*` calls.
- Replaces the `bash` tool with a sandboxed copy. It sets `NODE_USE_ENV_PROXY=1` so Node tools use the sandbox network proxy. It keeps your `shellCommandPrefix` setting.
- Registers the `sandbox_request_access` tool, the `/sandbox` command, and the toggle key.

### Checks and prompts

- **Network:** hosts that are not in `allowedDomains` cause a prompt when the connection starts. `deniedDomains` always block.
- **Read:** allowed if the path is in `allowRead`. A path in `allowWrite` is also readable, unless a specific `denyRead` entry covers it. (Entries for the home directory or `/` do not count as specific.)
- **Write:** `denyWrite` always blocks. A path in `allowWrite` is allowed. Other paths cause a prompt.
- **Linked git worktree:** the shared `.git` directory is writable. Its `hooks` directory is write-denied. Its `config` is write-denied unless `allowGitConfig` is `true`.
- **Violations:** when a `bash` command fails and the OS reports blocked files, the extension adds them to the result in a `<sandbox_violations>` block. On macOS this needs admin rights. Without them, nothing is reported.
- **Prompt choices:**

| Key | Result |
|---|---|
| `a` | Allow for this session |
| `P` | Allow, save to `<cwd>/.pi/sandbox.json` |
| `G` | Allow, save to `~/.pi/agent/sandbox.json` |
| `d` | Deny for this session (remembered) |
| `esc` | Deny this one time |

- **context-mode (`ctx_*`) tools:** in `sandbox` mode, `ctx_execute` and `ctx_batch` code runs inside the OS sandbox. `ctx_index` is checked as a read (`path`) or as a network access (`url`). `ctx_upgrade` asks first. In `prompt` mode all of them ask. The `file` argument is checked as a read.

### Subagents

A subagent (`PI_SUBAGENT=1`) reads the parent policy from the `PI_SANDBOX_INHERIT` environment variable. The parent keeps it current. The subagent's allow lists are the parent's lists. Its deny lists are the parent's lists plus its own config's. Session denials stay in force. It reads the project config of the parent's directory. If the variable is missing or invalid, the subagent uses its own config.

## Commands / Tools / CLI flags

| Name | Arguments | Meaning |
|---|---|---|
| `/sandbox` | none or `show` | Show mode, config paths, and the effective lists, including session grants and denials. |
| `/sandbox enable` | none | Switch to `sandbox` mode. Starts the OS sandbox if needed. (`/sandbox sandbox` also works.) |
| `/sandbox prompt` | none | Switch to `prompt` mode. Stops the OS sandbox. |
| `/sandbox toggle` | none | Switch between the two modes. |
| `bash` (tool) | same as the built-in `bash` | Replaces the built-in tool. Runs in the OS sandbox in `sandbox` mode. |
| `sandbox_request_access` (tool, model only) | `path` (string, required): absolute path or `~/...`; `access` (`"read"` or `"write"`, required); `reason` (string, required) | The model asks you to grant access to a path after a block. The tool refuses paths in `denyWrite` or in a specific `denyRead` entry. It does nothing if the sandbox is off or if no UI exists. After a grant, the model runs the command again. |

The extension has no CLI flags.

## Configuration

The extension does not use `agent/configs/sandbox.json`. Its policy is in `agent/sandbox.json` (installed to `~/.pi/agent/sandbox.json`). A project file `<cwd>/.pi/sandbox.json` can override it. Load order: built-in defaults, then global, then project. Objects merge by key. A list in a later file replaces the earlier list. The extension also writes to these files when you answer `P` or `G` in a prompt.

If a file is missing, the extension skips it. If a file is not valid JSON, the extension logs an error and skips it.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `mode` | `"sandbox"` \| `"prompt"` | `"sandbox"` | Mode at session start. |
| `enabled` | boolean | `true` | `false` turns the extension off. |
| `enableWeakerNetworkIsolation` | boolean | unset | Passed to the sandbox runtime. |
| `ignoreViolations` | object: command substring (`"*"` = all) to list of violation-line substrings | unset | Violation lines to drop. Maps merge by key. |
| `network.allowedDomains` | string[] | `localhost`, `github.com`, `*.github.com`, `registry.npmjs.org`, `*.npmjs.org`, `pypi.org`, `*.pypi.org` | Hosts that need no prompt. `*.x` matches `x` and its subdomains. |
| `network.deniedDomains` | string[] | `[]` | Hosts that are always blocked. |
| `network.allowLocalBinding` | boolean | unset | Allow local port binding. |
| `network.allowAllUnixSockets` | boolean | unset | Allow all Unix sockets. |
| `network.allowUnixSockets` | string[] | unset | Allowed Unix socket paths. |
| `network.allowMachLookup` | string[] | unset | Allowed macOS Mach services. |
| `filesystem.allowRead` | string[] | `["."]` | Readable paths. |
| `filesystem.allowWrite` | string[] | `[".", "/tmp"]` | Writable paths. |
| `filesystem.denyRead` | string[] | `[]` | Paths that cannot be read. |
| `filesystem.denyWrite` | string[] | `[".env", ".env.*", "*.pem", "*.key"]` | Paths that cannot be written. Wins over `allowWrite`. |
| `filesystem.allowGitConfig` | boolean | unset (denied) | Let `bash` write `.git/config`. |

Paths accept `~`, relative paths (resolved against the session directory), and `*` globs. Shell rc files, `.gitconfig`, `.git/hooks`, `.vscode`, and `.idea` stay write-denied by the runtime. On Linux, bubblewrap cannot enforce globs, so the runtime drops them.

Current repo values (`agent/sandbox.json`, shortened):

```json
{
  "enableWeakerNetworkIsolation": true,
  "enabled": true,
  "filesystem": {
    "allowGitConfig": true,
    "allowRead": [".", "~/.agents/skills", "~/.pi/agent"],
    "allowWrite": [".", "/tmp", "~/.cache", "~/.npm", "~/.worktrees", "..."],
    "denyRead": [".envrc.private", "~/.aws", "~/.gnupg", "~/.ssh", "~/Library/Keychains"],
    "denyWrite": ["*.key", "*.pem", "./.pi/sandbox.json", ".env", ".env.*", "/bin", "/sbin", "/usr/bin", "/usr/sbin", "~/.pi/agent/sandbox.json"]
  },
  "ignoreViolations": { "*": ["sysctl-read kern.iossupportversion", "system-info vfs.disk-space"] },
  "network": {
    "allowAllUnixSockets": false,
    "allowLocalBinding": true,
    "allowMachLookup": ["com.apple.FSEvents"],
    "allowUnixSockets": ["/nix/var/nix/daemon-socket", "..."],
    "allowedDomains": ["github.com", "*.github.com", "registry.npmjs.org", "..."]
  }
}
```

The repo file has no `mode` key, so the default `sandbox` applies.

## Keybindings

| Action id | Current key | Default when unset | Action |
|---|---|---|---|
| `ext.sandbox.toggle` | `ctrl+shift+b` | none (no shortcut is registered) | Switch between `sandbox` and `prompt` mode. Same as `/sandbox toggle`. |

The value can be one key string or an array of key strings. The extension reads `keybindings.json` itself at load time.
