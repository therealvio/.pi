import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { SessionTotals, SubStats } from "./types";
import { readKeepDays, readSubagentModels } from "./config";
import { BLOCKED_RE, buildPrompt, runSubagent, SESSION_ID_RE } from "./runner";
import { findSessionDir, openSubagentPicker, pruneSessions, sessionCwd } from "./sessions";
import {
  clip,
  failure,
  footerStatus,
  plainTelemetry,
  plural,
  renderCall,
  renderResult,
} from "./render";

/**
 * Local copy of jay-aye-see-kay's subagents extension, adapted:
 *   - models come from configs/subagents.json (cheaper models than the main
 *     agent), not settings.json;
 *   - the toggle key comes from "ext.subagent.toggle" in keybindings.json and
 *     is optional;
 *   - a blocked subagent (BLOCKED: report or sandbox denial) is flagged to the
 *     main agent, which must stop and ask the user, and to the user directly;
 *   - the agentsview lineage stamp is dropped.
 * @src https://github.com/jay-aye-see-kay/.pi/tree/e2ba7e182b7a3bb7675de0677bf1dbf29265fc10/agent/extensions/subagents
 *
 * subagent — delegate a self-contained task to an isolated `pi` process.
 *
 * The subagent runs in its own context window and returns ONLY its final
 * assistant text to the main agent. All intermediate work (tool calls, tool
 * output, thinking, retries) stays in the subagent's own session and never
 * enters the main agent's context. Live telemetry (turns / tools / cost) is
 * shown to the human via a TUI widget, not fed to the model.
 *
 * Config: ~/.pi/agent/configs/subagents.json (see ./config).
 *   { "keepDays": 30, "models": { "<provider/model>": "<when to use it>" } }
 * `models` maps model id to description; the first entry is the default. If
 * it is absent the tool is NOT registered (disabled silently, no fallback). If
 * present but malformed, the tool is disabled and the user is warned at
 * session start. `keepDays` deletes sessions older than that at startup.
 *
 * Recursion: subagents are spawned with `PI_SUBAGENT=1`, which causes this
 * extension to return early — the subagent tool is never registered inside a
 * subagent.
 *
 * Directory: the child runs in the parent's directory, or in the `cwd`
 * parameter when it is set (for example a git worktree of another repo).
 * A resumed subagent without `cwd` runs in the directory of its first run.
 *
 * Sandboxing: the child is spawned directly (bypassing the sandboxed bash tool),
 * but it is NOT unsandboxed — the sandbox extension loads in the child and
 * sandboxes it. The parent's sandbox extension puts its effective policy in
 * PI_SANDBOX_INHERIT, and the child copies the parent's environment. So the
 * child gets the parent's allow lists, deny lists and session grants and
 * denials, and no more. In --mode json there is no UI, so it is
 * deny-by-default: access the parent does not have is denied, not prompted.
 *
 * Resume: every result footer carries the subagent's session id (e.g.
 * `sub-1a2b3c4d`). Passing that id back as the `resume` parameter re-opens
 * that subagent with its full prior context (idempotent `--session-id`). Resume
 * is retrieval-only: ask a finished subagent for information it already holds
 * rather than to do new work. Prompt-cache hits are a bonus.
 *
 * Module layout:
 *   - config.ts    — read & validate the model list from configs/subagents.json
 *   - types.ts     — shared telemetry / option types
 *   - runner.ts    — spawn the child `pi`, parse its JSON event stream
 *   - render.ts    — turn stats into TUI widgets (all theme logic lives here)
 *   - sessions.ts  — subagent session dir plumbing + the browse/resume picker
 *   - index.ts     — wire it together and register the tool
 */
export default function (pi: ExtensionAPI) {
  // Never expose the subagent tool inside a subagent.
  if (process.env.PI_SUBAGENT) return;

  const cfg = readSubagentModels();
  if (cfg.status === "disabled") return; // no models in configs/subagents.json — silent
  if (cfg.status === "invalid") {
    // Malformed config: disable the tool but tell the user why.
    pi.on("session_start", async (_e, ctx) => {
      ctx.ui.notify(`Subagents disabled: ${cfg.message}`, "error");
    });
    return;
  }
  const models = cfg.models;
  const defaultModel = models[0].id;
  const modelDescription =
    `Which model to use (omit for the default: ${defaultModel}). Available:\n` +
    models.map((m) => `- ${m.id} — ${m.description}`).join("\n");
  // Constrain `model` to the configured ids (a bare Literal when only one).
  const modelLiterals = models.map((m) => Type.Literal(m.id));
  const modelSchema =
    modelLiterals.length === 1
      ? Type.Literal(models[0].id, { description: modelDescription })
      : Type.Union(modelLiterals, { description: modelDescription });

  interface SubagentState {
    enabled: boolean;
  }

  const toolName = "subagent";
  const stateEntry = "subagent-config";
  let totals: SessionTotals = { count: 0, cost: 0, turns: 0 };

  const isEnabled = (): boolean => pi.getActiveTools().includes(toolName);

  const updateStatus = (ctx: ExtensionContext, running = false, shownTotals = totals): void => {
    ctx.ui.setStatus("subagents", footerStatus(shownTotals, running, isEnabled()));
  };

  const setEnabled = (
    enabled: boolean,
    ctx: ExtensionContext,
    persist = true,
  ): boolean => {
    const active = pi.getActiveTools();
    const wasEnabled = active.includes(toolName);
    if (enabled !== wasEnabled) {
      pi.setActiveTools(
        enabled
          ? [...new Set([...active, toolName])]
          : active.filter((name) => name !== toolName),
      );
      if (persist) pi.appendEntry<SubagentState>(stateEntry, { enabled });
    }
    updateStatus(ctx);
    return enabled !== wasEnabled;
  };

  const restoreState = (ctx: ExtensionContext): void => {
    const entries = ctx.sessionManager.getBranch();
    let enabled = true;
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry?.type === "custom" && entry.customType === stateEntry) {
        const state = entry.data as SubagentState | undefined;
        if (typeof state?.enabled === "boolean") enabled = state.enabled;
        break;
      }
    }
    setEnabled(enabled, ctx, false);
  };

  const sessionDir = join(getAgentDir(), "subagent-sessions");
  // Prune once per pi process, not on every new/resumed/forked session.
  let pruned = false;

  pi.on("session_start", (_event, ctx) => {
    totals = { count: 0, cost: 0, turns: 0 };
    restoreState(ctx);
    const keepDays = readKeepDays();
    if (!pruned && keepDays) {
      pruned = true;
      pruneSessions(sessionDir, keepDays);
    }
  });
  pi.on("session_tree", (_event, ctx) => restoreState(ctx));

  pi.registerCommand("subagent", {
    description: "Enable, disable, or show the subagent tool",
    getArgumentCompletions: (prefix) => {
      const options = ["on", "off", "toggle", "status"];
      const matches = options
        .filter((option) => option.startsWith(prefix.toLowerCase()))
        .map((option) => ({ value: option, label: option }));
      return matches.length > 0 ? matches : null;
    },
    handler: async (args, ctx) => {
      const command = args.trim().toLowerCase();
      let next: boolean | undefined;
      if (!command || command === "toggle") next = !isEnabled();
      else if (command === "on" || command === "enable") next = true;
      else if (command === "off" || command === "disable") next = false;
      else if (command !== "status") {
        ctx.ui.notify("Usage: /subagent [status|on|off|toggle]", "warning");
        return;
      }

      if (next !== undefined) setEnabled(next, ctx);
      else updateStatus(ctx);
      ctx.ui.notify(`Subagent tool ${isEnabled() ? "enabled" : "disabled"}`, "info");
    },
  });

  // Optional toggle key: "ext.subagent.toggle" in keybindings.json, a string
  // or a string array. No binding = no shortcut; /subagent still works.
  for (const key of readToggleKeys()) {
    pi.registerShortcut(key as Parameters<ExtensionAPI["registerShortcut"]>[0], {
      description: "Toggle the subagent tool",
      handler: async (ctx) => {
        setEnabled(!isEnabled(), ctx);
        ctx.ui.notify(`Subagent tool ${isEnabled() ? "enabled" : "disabled"}`, "info");
      },
    });
  }

  // Browse & resume subagent sessions in the normal UI (they live in their own
  // dir, so they never appear in the built-in /resume, pi -r, or pi -c).
  pi.registerCommand("resume-subagents", {
    description: "Browse and resume subagent sessions",
    handler: async (_args, ctx) => {
      await openSubagentPicker(sessionDir, ctx);
    },
  });

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: `Delegate a self-contained task to an isolated subagent (its own context window, its own read/bash/edit/write tools).

Reach for one when work is big or noisy to do but small to report — keep the mess out of your context:
- search & locate (where is X, where's this used)
- explore & explain (how does this flow work)
- summarize a big artifact (long log, huge file, diff, test output)
- web/doc lookup (a signature, a breaking change, a fact + its source)
- scoped grunt work (run tests and triage, apply a rename, build a minimal repro)
- a fresh second opinion (review a diff, argue failure cases)
Run several in parallel for independent subtasks, then merge.

Key rule: the subagent can't see this conversation — state the outcome in \`goal\` and put everything it needs in \`context\`. It finishes with a standalone final report.

To work in a worktree or another repo, set cwd to its path.

Blockers: a result that starts with "SUBAGENT BLOCKED" needs the user. Do not work around the block, do the blocked work yourself, or retry with another subagent. Stop and show the user the block.`,
    parameters: Type.Object({
      goal: Type.String({
        description: `One concise sentence naming the outcome this subagent must deliver.`,
      }),
      context: Type.String({
        description: `All the information to help the subagent achieve its goal.`,
      }),
      model: Type.Optional(modelSchema),
      // Keep this both optional and explicitly nullable. OpenAI's strict tool
      // schemas expose every property as required, using null for omitted values;
      // Anthropic can continue to omit it entirely.
      resume: Type.Optional(
        Type.Union([Type.String(), Type.Null()], {
          description: `Optional. Resume a finished subagent by its id (e.g. 'sub-1a2b3c4d', from a prior result footer) to ask it a follow-up; \`goal\` becomes the follow-up question.

Good for: pulling more information out of a subagent that already holds it — a detail from a page/file/search it loaded, or the reasoning behind a result it gave you.
Key rule: resume to get information not to do work.`,
        }),
      ),
      // Optional and nullable for the same reason as `resume`.
      cwd: Type.Optional(
        Type.Union([Type.String(), Type.Null()], {
          description: `Optional. Directory the subagent works in (absolute, ~/..., or relative to the current directory). Omit to use the current directory, or on resume the directory of the first run. The subagent gets the same sandbox access as you, not more.`,
        }),
      ),
    }),

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      // Resolve (and validate) the session: resume an existing one or mint a new id.
      // New subagents go under the current parent session's subdir; a resumed
      // subagent stays in whichever parent subdir originally created it.
      const parentId = ctx.sessionManager.getSessionId();
      const resumeId = params.resume?.trim();
      let runDir: string;
      if (resumeId) {
        if (!SESSION_ID_RE.test(resumeId)) {
          return failure(
            `Invalid subagent id '${resumeId}'. Expected a 'sub-...' id from a prior result footer.`,
            { resume: resumeId },
          );
        }
        const existingDir = findSessionDir(sessionDir, resumeId);
        if (!existingDir) {
          return failure(
            `No subagent session '${resumeId}' found to resume. Start a fresh subagent instead (omit 'resume').`,
            { resume: resumeId },
          );
        }
        runDir = existingDir;
      } else {
        runDir = join(sessionDir, parentId);
        mkdirSync(runDir, { recursive: true });
      }
      const sessionId = resumeId ?? `sub-${randomUUID().slice(0, 8)}`;
      const model = params.model ?? defaultModel;

      const cwdArg = params.cwd?.trim();
      // A resumed subagent without cwd continues where it first ran.
      const cwd = cwdArg
        ? resolveDir(ctx.cwd, cwdArg)
        : (resumeId && sessionCwd(runDir, resumeId)) || ctx.cwd;
      if (!cwd) {
        return failure(`cwd '${cwdArg}' is not an existing directory.`, { cwd: cwdArg });
      }

      const outcome = await runSubagent(
        {
          sessionId,
          resuming: Boolean(resumeId),
          model,
          prompt: buildPrompt(params.goal, params.context),
          sessionDir: runDir,
          cwd,
          signal,
        },
        // Live telemetry → inline tool block (drawn by renderResult with isPartial).
        (stats) => {
          onUpdate?.({ content: [{ type: "text", text: plainTelemetry(stats) }], details: stats });
          // Show a live footer indicator while the subagent is running.
          updateStatus(
            ctx,
            true,
            {
              count: totals.count + 1,
              cost: totals.cost + stats.cost,
              turns: totals.turns + stats.turns,
            },
          );
        },
      );

      const { finalText, exitCode } = outcome;
      const stats: SubStats = { ...outcome.stats, ...blockInfo(finalText, outcome.stats.denials) };
      if (stats.blocked) {
        // Tell the user directly too, in case the main agent buries it.
        ctx.ui.notify(`Subagent ${sessionId} blocked: ${stats.blockedReason}`, "warning");
      }

      if (outcome.aborted) {
        updateStatus(ctx);
        return failure(`Subagent ${sessionId} aborted.`, { ...stats, error: "aborted" });
      }
      if (outcome.spawnError) {
        updateStatus(ctx);
        return failure(`Failed to launch subagent: ${outcome.spawnError.message}`, {
          ...stats,
          error: outcome.spawnError.message,
        });
      }
      if (exitCode !== 0 && !finalText) {
        updateStatus(ctx);
        const failText = `Subagent ${sessionId} failed (exit ${exitCode}).\n${outcome.stderr.slice(-1500)}`;
        return failure(stats.blocked ? blockedText(stats, failText) : failText, {
          ...stats,
          error: `exit ${exitCode}`,
          exitCode,
        });
      }

      // Update session-level running totals and footer.
      totals.count += 1;
      totals.cost += stats.cost;
      totals.turns += stats.turns;
      updateStatus(ctx);

      const body = finalText || "(subagent produced no final text)";
      const footer = `[subagent ${sessionId} \u00b7 ${plural(stats.turns, "turn")} \u00b7 $${stats.cost.toFixed(4)}]`;
      const text = stats.blocked ? blockedText(stats, body) : body;
      return {
        content: [{ type: "text", text: `${text}\n\n${footer}` }],
        details: { ...stats, text: body },
      };
    },

    renderCall(args, theme) {
      return renderCall(args, defaultModel, theme);
    },

    renderResult(result, { expanded, isPartial }, theme, context) {
      // Older results and early failures can lack `denials`.
      const d = result.details as SubStats | undefined;
      if (d && !Array.isArray(d.denials)) d.denials = [];
      return renderResult(
        result.details as SubStats | undefined,
        Boolean(context.isError),
        expanded,
        isPartial,
        theme,
      );
    },
  });
}

/**
 * `dir` as an absolute path (~ expanded, relative to `base`), or null when
 * it is not an existing directory.
 */
function resolveDir(base: string, dir: string): string | null {
  const abs = resolve(base, dir.replace(/^~(?=$|\/)/, homedir()));
  try {
    return statSync(abs).isDirectory() ? abs : null;
  } catch {
    return null;
  }
}

/** Keys bound to "ext.subagent.toggle" in keybindings.json, or none. */
function readToggleKeys(): string[] {
  try {
    const config = JSON.parse(readFileSync(join(getAgentDir(), "keybindings.json"), "utf8"));
    const keys = config?.["ext.subagent.toggle"];
    if (typeof keys === "string") return [keys];
    return Array.isArray(keys) ? [...new Set(keys.filter((k): k is string => typeof k === "string"))] : [];
  } catch {
    return [];
  }
}

/**
 * A subagent is blocked when its report starts with a BLOCKED: line, or when
 * the sandbox refused one of its tool calls. A denial counts even if the
 * child found another way: the user may want to grant the access.
 */
function blockInfo(finalText: string, denials: string[]): Pick<SubStats, "blocked" | "blockedReason"> {
  const reported = BLOCKED_RE.exec(finalText)?.[1]?.trim();
  if (reported) return { blocked: true, blockedReason: clip(reported, 200) };
  if (denials.length > 0) {
    return { blocked: true, blockedReason: `sandbox denied ${plural(denials.length, "operation")}` };
  }
  return {};
}

/** Model-facing text for a blocked result: the stop rule, denials, report. */
function blockedText(stats: SubStats, report: string): string {
  const denials = stats.denials.length
    ? `Sandbox denials:\n${stats.denials.map((x) => `- ${x}`).join("\n")}\n\n`
    : "";
  return (
    `SUBAGENT BLOCKED \u2014 needs user review: ${stats.blockedReason}\n\n` +
    "Do not work around this block, do the blocked work yourself, or retry " +
    "with another subagent. Stop and tell the user what blocked the subagent " +
    "and what would unblock it, then ask how to proceed. A subagent gets " +
    "the access you have when it starts, including grants for this session, " +
    "and no more.\n\n" +
    denials +
    `Subagent report:\n${report}`
  );
}
