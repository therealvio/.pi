import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import type { RunOptions, SubagentOutcome, SubStats, ToolCall } from "./types";
import { summarizeCall } from "./render";

export const SESSION_ID_RE = /^sub-[a-z0-9-]+$/i;

// The first line of a blocked report. The parent looks for it to stop and
// hand the block to the user.
export const BLOCKED_RE = /^\s*BLOCKED:\s*(.*)$/m;

// Tool-result text from our sandbox extension when it refuses something.
// Keep in sync with the messages in agent/extensions/sandbox/index.ts.
const DENIAL_RE = /Sandbox(?: \(prompt mode\))?: |<sandbox_violations>|Denied: no UI available/;

export function buildPrompt(goal: string, context: string): string {
  return [
    "## Goal",
    goal.trim(),
    "## Context",
    context.trim(),
    "## Blockers",
    "You are a resumable subagent in a sandbox. No user can answer you, so " +
    "access the sandbox has not already allowed is denied without a prompt.\n\n" +
    "If something stops you from reaching the goal (a sandbox denial, a " +
    "missing tool, missing access, or information you cannot find), do not " +
    "work around it and do not guess. Stop, and start your final reply with " +
    "one line:\n\n" +
    "BLOCKED: <one-line summary of what blocked you>\n\n" +
    "Then give: what you tried, the exact error text, and what access or " +
    "information would unblock you (for example, the narrowest path to " +
    "allow). After that, report any partial results.",
  ].join("\n\n");
}

// macOS logs this kernel-info read on many failed commands. It never stops
// the command, so it does not count as a block.
const NOISE_RE = /\bsysctl-read\b/;

/**
 * The first real sandbox denial in a tool result, or undefined. For a
 * <sandbox_violations> block, returns the first violation line that is not
 * noise.
 */
export function findDenial(text: string): string | undefined {
  if (!DENIAL_RE.test(text)) return undefined;
  const lines = text.split("\n").map((l) => l.trim());
  const start = lines.indexOf("<sandbox_violations>");
  if (start >= 0) {
    const end = lines.indexOf("</sandbox_violations>", start);
    const block = lines.slice(start + 1, end < 0 ? undefined : end);
    const real = block.find((l) => l && !NOISE_RE.test(l) && !/^\.\.\./.test(l));
    if (real) return real;
  }
  return lines.find((l) => l !== "<sandbox_violations>" && DENIAL_RE.test(l));
}

/** Plain text of a tool result's content blocks. */
function resultText(result: unknown): string {
  const content = (result as { content?: unknown })?.content;
  if (!Array.isArray(content)) return typeof result === "string" ? result : "";
  return content
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
}

/**
 * Spawn the child `pi`, accumulate telemetry from its JSON event stream, and
 * resolve once it exits. `onStats` receives a live snapshot whenever the stats
 * change; it is the only coupling to the UI and never sees the child directly.
 *
 * The child runs in its own context window and returns ONLY its final assistant
 * text to the caller. It is spawned with `PI_SUBAGENT=1` so the subagent tool is
 * never registered inside a subagent (no recursion). It runs in `--mode json`
 * with the standard global config, which loads pi-sandbox automatically so the
 * child sandboxes itself (deny-by-default: no UI to prompt).
 */
export async function runSubagent(
  opts: RunOptions,
  onStats: (stats: SubStats) => void,
): Promise<SubagentOutcome> {
  const child = spawn(
    "pi",
    [
      "--mode", "json",
      "--session-dir", opts.sessionDir,
      "--session-id", opts.sessionId,
      "--model", opts.model,
      "-n", `subagent/${opts.sessionId}`,
      "-p", opts.prompt,
    ],
    {
      cwd: opts.cwd,
      env: { ...process.env, PI_SUBAGENT: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const onAbort = () => child.kill("SIGTERM");
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  let finalText = "";
  let totalCost = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let turns = 0;
  const calls: ToolCall[] = [];
  const denials = new Set<string>();
  let stderr = "";
  let buf = "";

  const snapshot = (running: boolean): SubStats => ({
    sessionId: opts.sessionId,
    resuming: opts.resuming,
    cost: totalCost,
    tokensIn: totalTokensIn,
    tokensOut: totalTokensOut,
    turns,
    calls: calls.map((c) => ({ ...c })),
    denials: [...denials],
    running,
  });
  const emit = () => onStats(snapshot(true));
  emit();

  // The child's `--mode json` stream is AgentSession.subscribe's event feed.
  const handleEvent = (ev: AgentSessionEvent) => {
    switch (ev.type) {
      case "tool_execution_start":
        calls.push({ tool: ev.toolName, summary: summarizeCall(ev.args) });
        emit();
        break;
      case "tool_execution_end": {
        // Record each sandbox refusal so the parent can show it to the user,
        // even when the child forgets to report it.
        const found = findDenial(resultText(ev.result));
        if (found) {
          denials.add(`${ev.toolName}: ${found.slice(0, 300)}`);
          emit();
        }
        break;
      }
      case "message_end":
        if (ev.message.role === "assistant") {
          totalCost += ev.message.usage.cost.total;
          totalTokensIn += ev.message.usage.input;
          totalTokensOut += ev.message.usage.output;
        }
        break;
      case "turn_end":
        turns += 1;
        emit();
        break;
      case "agent_end": {
        for (let i = ev.messages.length - 1; i >= 0; i--) {
          const msg = ev.messages[i];
          if (msg.role === "assistant") {
            finalText = msg.content
              .filter((b) => b.type === "text")
              .map((b) => b.text)
              .join("");
            break;
          }
        }
        break;
      }
    }
  };

  child.stdout.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        handleEvent(JSON.parse(line));
      } catch {
        // ignore non-JSON lines
      }
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  let spawnError: Error | undefined;
  const exitCode: number = await new Promise((resolve) => {
    child.on("error", (err) => {
      spawnError = err;
      resolve(-1);
    });
    child.on("close", (code) => resolve(code ?? 0));
  });

  opts.signal?.removeEventListener("abort", onAbort);

  return {
    stats: snapshot(false),
    finalText,
    exitCode,
    aborted: Boolean(opts.signal?.aborted),
    spawnError,
    stderr,
  };
}
