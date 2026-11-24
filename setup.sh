#!/usr/bin/env bash
# setup.sh: copy this repo's pi config into the pi agent dir.
#
# Copies every git-tracked file under agent/ to ~/.pi/agent (or
# $PI_CODING_AGENT_DIR). Untracked files, such as node_modules or drafts,
# are not copied.
#
# - settings.json is merged into the live file, repo values win. Pi writes
#   some keys itself (lastChangelogVersion, `pi config` toggles), and a plain
#   copy would drop them. A key removed from the repo stays in the live file.
# - A file that would change is first backed up to <agent dir>/_bak/<time>/.
# - Files are never deleted. Live extension files that the repo does not
#   track are listed, because pi loads them too.
# - Extensions with a package-lock.json get `npm ci` in the agent dir.
# - `rtk init` installs rtk's own extension, if rtk is on PATH.
# - The installed pikit package.json is patched to move typebox to
#   peerDependencies, until upstream fixes it.
#
# Usage: ./setup.sh [--dry-run]

set -euo pipefail

usage() {
	sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'
}

DRY_RUN=0
while [[ $# -gt 0 ]]; do
	case "$1" in
		--dry-run | -n) DRY_RUN=1; shift ;;
		--help | -h) usage; exit 0 ;;
		*) echo "Unknown flag: $1" >&2; usage >&2; exit 1 ;;
	esac
done

for cmd in git jq npm; do
	command -v "$cmd" >/dev/null 2>&1 || { echo "setup.sh needs $cmd on PATH." >&2; exit 1; }
done

# rtk installs its own pi extension (below), and pi-worktrunk calls wt at
# runtime. Without them those features are off, so warn but carry on.
HAVE_RTK=1
command -v rtk >/dev/null 2>&1 || { HAVE_RTK=0; echo "warning: rtk is not on PATH; skipping its pi extension." >&2; }
command -v wt >/dev/null 2>&1 || echo "warning: wt is not on PATH; the pi-worktrunk tool will not work." >&2

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
SRC="$REPO/agent"
DEST="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
BAK="$DEST/_bak/$(date +%Y%m%d-%H%M%S)"

created=0 updated=0 unchanged=0
npm_dirs=()

# Write $2 (a file) to $DEST/$1. Back up the old file if it differs.
install_file() {
	local rel="$1" src="$2" dest="$DEST/$1"
	if [[ -f "$dest" ]] && cmp -s "$src" "$dest"; then
		unchanged=$((unchanged + 1))
		return
	fi
	if [[ -f "$dest" ]]; then
		echo "update  $rel"
		updated=$((updated + 1))
	else
		echo "create  $rel"
		created=$((created + 1))
	fi
	[[ $DRY_RUN -eq 1 ]] && return
	if [[ -f "$dest" ]]; then
		mkdir -p "$(dirname "$BAK/$rel")"
		cp -p "$dest" "$BAK/$rel"
	fi
	mkdir -p "$(dirname "$dest")"
	cp "$src" "$dest"
}

tmp=$(mktemp -d "${TMPDIR:-/tmp}/pi-setup.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

while IFS= read -r path; do
	rel="${path#agent/}"
	src="$REPO/$path"
	if [[ "$rel" == "settings.json" && -f "$DEST/$rel" ]]; then
		# Pi owns lastChangelogVersion. An older repo value makes pi show the
		# changelog again.
		jq -s '.[0] * (.[1] | del(.lastChangelogVersion))' "$DEST/$rel" "$src" >"$tmp/settings.json"
		src="$tmp/settings.json"
	fi
	install_file "$rel" "$src"
	if [[ "$rel" == extensions/*/package-lock.json ]]; then
		npm_dirs+=("$(dirname "$rel")")
	fi
done < <(git -C "$REPO" ls-files agent)

# The secrets extension reads configs/.env.private for secrets that stay out of
# git. Create an empty one so it is ready to edit. Never touch an existing file:
# it holds real secrets. Mode 600, because only the user should read it.
private_env="$DEST/configs/.env.private"
if [[ ! -e "$private_env" ]]; then
	echo "create  configs/.env.private (empty)"
	created=$((created + 1))
	if [[ $DRY_RUN -eq 0 ]]; then
		mkdir -p "$(dirname "$private_env")"
		(umask 077 && : >"$private_env")
	fi
fi

# `npm ci` replaces node_modules, so run it only when deps are missing or the
# lockfile changed in this run.
for dir in ${npm_dirs[@]+"${npm_dirs[@]}"}; do
	lock="$DEST/$dir/package-lock.json"
	stamp="$DEST/$dir/node_modules/.package-lock.json"
	if [[ -d "$DEST/$dir/node_modules" && -f "$stamp" && ! "$lock" -nt "$stamp" ]]; then
		continue
	fi
	echo "npm ci  $dir"
	[[ $DRY_RUN -eq 1 ]] && continue
	(cd "$DEST/$dir" && npm ci --ignore-scripts --no-audit --no-fund --loglevel=error)
done

# rtk owns extensions/rtk.ts, so the extension always matches the installed
# binary. rtk init writes to ~/.pi/agent and ignores PI_CODING_AGENT_DIR, so
# skip it when that is set (for example in a test run).
if [[ $HAVE_RTK -eq 1 ]]; then
	if [[ -n "${PI_CODING_AGENT_DIR:-}" ]]; then
		echo "skip    rtk init (PI_CODING_AGENT_DIR is set)"
	else
		echo "rtk init --agent pi"
		[[ $DRY_RUN -eq 1 ]] || rtk init -g --agent pi </dev/null >/dev/null
	fi
fi

# Pi warns when a package lists a host-provided module (typebox) in
# dependencies, not peerDependencies. Move it to a "*" peer in the installed
# manifest until upstream fixes it. Pi installs packages on start, so on a new
# machine run this script again after the first start. A pinned npm version is
# not reinstalled, so the patch stays until the pin changes. Once upstream
# drops typebox from dependencies, this step does nothing.
# Upstream: npm:@adrianapan/pikit (1.1.9 and earlier).
pikit_pkg="$DEST/npm/node_modules/@adrianapan/pikit/package.json"
if [[ -f "$pikit_pkg" ]] && jq -e '.dependencies.typebox' "$pikit_pkg" >/dev/null; then
	echo "patch   npm/node_modules/@adrianapan/pikit/package.json (typebox -> peerDependencies)"
	if [[ $DRY_RUN -eq 0 ]]; then
		tmp=$(mktemp)
		jq --indent 2 'del(.dependencies.typebox) | .peerDependencies.typebox = "*"' "$pikit_pkg" >"$tmp"
		mv "$tmp" "$pikit_pkg"
	fi
fi

# Pi loads every extensions/*.ts and extensions/*/index.ts, so leftovers from
# an older layout load beside the repo's copies. Installer-owned files are
# expected. Files that git ignores are skipped, for example .DS_Store when
# your global git excludes file lists it. Each path is checked as
# agent/<path>, so the repo's .gitignore applies too. check-ignore exits 1 when it matches
# nothing, hence `|| true`.
if [[ -d "$DEST/extensions" ]]; then
	tracked=$(git -C "$REPO" ls-files agent/extensions | sed 's#^agent/##'; echo "extensions/rtk.ts")
	stray=$(cd "$DEST" && find extensions -type f -not -path '*/node_modules/*' | sort |
		while IFS= read -r f; do grep -qxF "$f" <<<"$tracked" || echo "$f"; done)
	if [[ -n "$stray" ]]; then
		ignored=$(sed 's#^#agent/#' <<<"$stray" | git -C "$REPO" check-ignore --no-index --stdin | sed 's#^agent/##' || true)
		stray=$(grep -vxF -f <(printf '%s\n' "$ignored") <<<"$stray" || true)
	fi
	if [[ -n "$stray" ]]; then
		echo
		echo "Not in repo, still loaded by pi (remove if unwanted):"
		sed 's#^#  #' <<<"$stray"
	fi
fi

echo
summary="$created created, $updated updated, $unchanged unchanged in $DEST"
if [[ $DRY_RUN -eq 1 ]]; then
	echo "Dry run: $summary. Nothing written."
else
	echo "$summary."
	if [[ -d "$BAK" ]]; then echo "Backups: $BAK"; fi
	if [[ $((created + updated)) -gt 0 ]]; then echo "Run /reload in pi, or restart it, to load the changes."; fi
fi
