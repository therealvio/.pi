# pi experiments

## workflow shit

- [ ] sandbox mode - this is gonna be chunky.

## pi setup

TODO: move these into dotfiles/prep-macbook when you're ready to use pi seriously.

pi may need it's own repo, see: https://github.com/jay-aye-see-kay/.pi for inspiration.

### install

Run `./setup.sh` (or `./setup.sh --dry-run` first). It copies `agent/` into `~/.pi/agent`. Packages, skills and extensions are declared in the repo, and setup.sh runs `rtk init -g --agent pi` for rtk's extension, so there are no manual install steps.

Install these tools first, setup.sh does not: `rtk` (>= 0.23) and `wt` (worktrunk, used by pi-worktrunk).
