# .pi

This is my personal Pi config repo. Yep.

### install

Run `./setup.sh` (or `./setup.sh --dry-run` first). It copies `agent/` into `~/.pi/agent`. Packages, skills and extensions are declared in the repo, and setup.sh runs `rtk init -g --agent pi` for rtk's extension, so there are no manual install steps.

Install these tools first, setup.sh does not: `rtk` (>= 0.23) and `wt` (worktrunk, used by pi-worktrunk).

### use the extensions only

The repo is also a pi package. It exposes each extension in `agent/extensions/`. Install all of them:

```bash
pi install git:github.com/therealvio/.pi
```

To load only some, use a package filter in `settings.json`:

```json
{
  "packages": [
    {
      "source": "git:github.com/therealvio/.pi",
      "extensions": ["agent/extensions/snippets/index.ts", "agent/extensions/prompt-stash/index.ts"]
    }
  ]
}
```

Each extension has a `README.md` in its folder. Some extensions read `~/.pi/agent/configs/<name>.json` or `ext.<name>.<action>` keys in `~/.pi/agent/keybindings.json`, and do nothing until you add them. Copy the examples from `agent/configs/` and `agent/keybindings.json`.
