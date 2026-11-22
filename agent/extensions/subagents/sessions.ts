import type { ExtensionCommandContext, SessionInfo } from "@earendil-works/pi-coding-agent";
import { SessionManager, SessionSelectorComponent } from "@earendil-works/pi-coding-agent";
import { copyFileSync, mkdirSync, readdirSync, rmdirSync, statSync, unlinkSync } from "node:fs";
import { basename, join, resolve } from "node:path";

/**
 * Delete subagent session files not changed for `keepDays` days, then remove
 * parent subdirs left empty. Uses mtime, so a resumed session counts as new
 * and a running subagent is never touched. Best-effort: a file that cannot
 * be deleted stays. Returns the number of files deleted.
 */
export function pruneSessions(sessionDir: string, keepDays: number): number {
  const cutoff = Date.now() - keepDays * 86_400_000;
  let deleted = 0;
  for (const dir of sessionSubdirs(sessionDir)) {
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const path = join(dir, f);
      try {
        if (statSync(path).mtimeMs < cutoff) {
          unlinkSync(path);
          deleted += 1;
        }
      } catch {
        // keep it; try again next start
      }
    }
    try {
      if (readdirSync(dir).length === 0) rmdirSync(dir);
    } catch {
      // not empty or not removable
    }
  }
  return deleted;
}

/**
 * Subagent sessions live in per-parent subdirs: `subagent-sessions/<parent-id>/`.
 * Return the immediate subdirs of `sessionDir` (each a parent-session bucket).
 */
export function sessionSubdirs(sessionDir: string): string[] {
  try {
    return readdirSync(sessionDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(sessionDir, e.name));
  } catch {
    return [];
  }
}

/**
 * Locate the parent-session subdir that holds session `<id>` (files are named
 * `<timestamp>_<sessionId>.jsonl`). Returns the containing dir, or null if the
 * session doesn't exist anywhere. A subagent stays in the subdir of the parent
 * that created it, even when resumed from a different parent session.
 */
export function findSessionDir(sessionDir: string, id: string): string | null {
  for (const dir of sessionSubdirs(sessionDir)) {
    try {
      if (readdirSync(dir).some((f) => f.endsWith(`_${id}.jsonl`))) return dir;
    } catch {
      // ignore unreadable subdir
    }
  }
  return null;
}

/**
 * Replace the auto-generated `subagent/<id>` name with a short preview of the
 * session's first message, so the picker shows what each subagent was doing
 * (like /resume) instead of just an id. User-renamed sessions are left as-is.
 */
function withPreviews(sessions: SessionInfo[]): SessionInfo[] {
  return sessions.map((s) => {
    const isAutoName = !s.name || s.name.startsWith("subagent/");
    if (!isAutoName) return s;
    // Pass the full cleaned first message; the picker truncates it to the
    // available width itself (like /resume), so it adapts to screen size.
    const preview = s.firstMessage.replace(/^#+\s*Goal\s*/i, "").replace(/\s+/g, " ").trim();
    return preview ? { ...s, name: preview } : s;
  });
}

/**
 * List every subagent session across all per-parent subdirs of `sessionDir`,
 * with first-message previews applied. `SessionManager.list` only reads a
 * single flat dir (no recursion), so we enumerate the parent buckets and merge.
 */
async function listAllSubagentSessions(sessionDir: string, cwd: string): Promise<SessionInfo[]> {
  const perDir = await Promise.all(sessionSubdirs(sessionDir).map((dir) => SessionManager.list(cwd, dir)));
  const merged = perDir.flat();
  merged.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  return withPreviews(merged);
}

/**
 * Open pi's native session picker scoped to the subagent session directory, so
 * the user can browse and resume a subagent session in the normal UI. Subagent
 * sessions live in their own dir (keeping them out of the built-in `/resume`,
 * `pi -r`, and `pi -c`), so this command is the way back in.
 */
export async function openSubagentPicker(sessionDir: string, ctx: ExtensionCommandContext): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("Subagent sessions can only be browsed in interactive mode.", "warning");
    return;
  }
  // Avoid opening an empty picker when this project has no subagent sessions.
  const existing = await listAllSubagentSessions(sessionDir, ctx.cwd);
  if (existing.length === 0) {
    ctx.ui.notify("No subagent sessions for this project yet.", "info");
    return;
  }

  const chosen = await ctx.ui.custom<string | undefined>((tui, _theme, keybindings, done) =>
    new SessionSelectorComponent(
      () => listAllSubagentSessions(sessionDir, ctx.cwd),
      () => listAllSubagentSessions(sessionDir, ctx.cwd),
      (sessionPath) => done(sessionPath),
      () => done(undefined),
      () => done(undefined),
      () => tui.requestRender(),
      {
        renameSession: async (sessionFilePath, nextName) => {
          const next = (nextName ?? "").trim();
          if (next) SessionManager.open(sessionFilePath).appendSessionInfo(next);
        },
        showRenameHint: true,
        keybindings,
      },
    ),
  );

  if (!chosen) return;
  try {
    // switchSession() re-roots pi's session dir at the resumed file's parent
    // (here: subagent-sessions/), which would break the built-in /resume.
    // Mirror pi's /import: copy the chosen session into the active session dir,
    // then switch to the copy so the runtime stays anchored to the normal dir.
    // The original stays in subagent-sessions/ so the subagent tool can still
    // resume it by id.
    const destDir = ctx.sessionManager.getSessionDir();
    const destPath = join(destDir, basename(chosen));
    if (resolve(destPath) !== resolve(chosen)) {
      mkdirSync(destDir, { recursive: true });
      copyFileSync(chosen, destPath);
    }
    const result = await ctx.switchSession(destPath);
    if (!result.cancelled) ctx.ui.notify("Resumed subagent session.", "info");
  } catch (err) {
    ctx.ui.notify(`Failed to resume subagent session: ${(err as Error).message}`, "error");
  }
}
