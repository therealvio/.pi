import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, type KeyId } from "@earendil-works/pi-tui";

import type { RunRecord } from "./types";
import { clip, plural, shortModel } from "./render";

/** What the panel shows. Read again on each render, so the panel stays live. */
export interface PanelView {
  enabled: boolean;
  defaultModel: string;
  runs: RunRecord[];
}

const fmtTokens = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);

const STATE_ICON: Record<RunRecord["state"], { icon: string; color: "accent" | "success" | "error" | "warning" | "muted" }> = {
  running: { icon: "\u25b6", color: "accent" },
  done: { icon: "\u2713", color: "success" },
  failed: { icon: "\u2716", color: "error" },
  aborted: { icon: "\u25a0", color: "muted" },
  blocked: { icon: "\u26a0", color: "warning" },
};

/** Summary lines: mode, default model, totals and cost per model. */
function summaryLines(theme: Theme, view: PanelView): string[] {
  const label = (s: string) => theme.fg("muted", s.padEnd(15));
  const mode = view.enabled
    ? theme.fg("success", "\u{1f465} enabled")
    : theme.fg("warning", "\u{1f464} disabled (the agent cannot start subagents)");
  const cost = view.runs.reduce((sum, r) => sum + (r.stats?.cost ?? 0), 0);
  const turns = view.runs.reduce((sum, r) => sum + (r.stats?.turns ?? 0), 0);
  const lines = [
    `${label("Mode")}${mode}`,
    `${label("Default model")}${shortModel(view.defaultModel)}`,
    `${label("This session")}${plural(view.runs.length, "run")} \u00b7 ${plural(turns, "turn")} \u00b7 $${cost.toFixed(4)}`,
  ];

  const byModel = new Map<string, { runs: number; cost: number }>();
  for (const r of view.runs) {
    const m = byModel.get(r.model) ?? { runs: 0, cost: 0 };
    m.runs += 1;
    m.cost += r.stats?.cost ?? 0;
    byModel.set(r.model, m);
  }
  for (const [model, m] of [...byModel].sort((a, b) => b[1].cost - a[1].cost)) {
    lines.push(`${label("")}${theme.fg("dim", `${shortModel(model)}: ${plural(m.runs, "run")} \u00b7 $${m.cost.toFixed(4)}`)}`);
  }
  return lines;
}

/** Two or three lines per run: state, id, model, numbers; then goal; then cwd or blocker. */
function runLines(theme: Theme, run: RunRecord, cwd: string): string[] {
  const { icon, color } = STATE_ICON[run.state];
  const s = run.stats;
  const numbers = s
    ? `${plural(s.turns, "turn")} \u00b7 ${plural(s.calls.length, "tool call")} \u00b7 ${fmtTokens(s.tokensIn)}/${fmtTokens(s.tokensOut)} tok \u00b7 $${s.cost.toFixed(4)}`
    : "starting";
  const lines = [
    `${theme.fg(color, icon)} ${theme.fg("accent", run.sessionId)}${s?.resuming ? theme.fg("dim", " \u21bb") : ""}  ` +
      `${theme.fg("muted", shortModel(run.model))}  ${theme.fg("dim", numbers)}`,
    `  ${clip(run.goal.replace(/\s+/g, " "), 200)}`,
  ];
  if (run.cwd && run.cwd !== cwd) lines.push(theme.fg("dim", `  @ ${run.cwd}`));
  if (s?.blockedReason) lines.push(theme.fg("warning", `  blocked: ${s.blockedReason}`));
  else if (s?.error) lines.push(theme.fg("error", `  error: ${s.error}`));
  return lines;
}

/**
 * Overlay with the subagent mode and every subagent run in this session.
 * `subscribe` registers a re-render callback and returns its remover.
 * `closeKeys` also close the panel, so the key that opens it toggles it.
 */
export async function openStatusPanel(
  ctx: ExtensionContext,
  getView: () => PanelView,
  subscribe: (fn: () => void) => () => void,
  closeKeys: string[] = [],
): Promise<void> {
  await ctx.ui.custom<void>(
    (tui, theme, keybindings, done) => {
      let scroll = 0;
      let pageSize = 10;
      const unsubscribe = subscribe(() => tui.requestRender());
      const finish = () => {
        unsubscribe();
        done();
      };

      return {
        render(width: number): string[] {
          const view = getView();
          const inner = Math.max(10, width - 4);
          const body = [...summaryLines(theme, view), ""];
          if (view.runs.length === 0) body.push(theme.fg("dim", "No subagent runs in this session."));
          // Newest first: the run you care about is usually the last one.
          for (const run of [...view.runs].reverse()) body.push(...runLines(theme, run, ctx.cwd), "");
          const lines = body.map((l) => truncateToWidth(l, inner));

          // Overlay maxHeight is 70% of the terminal; take off border, title and help.
          pageSize = Math.max(3, Math.floor(tui.terminal.rows * 0.7) - 4);
          scroll = Math.min(scroll, Math.max(0, lines.length - pageSize));
          const shown = lines.slice(scroll, scroll + pageSize);

          const b = (s: string) => theme.fg("border", s);
          const row = (s: string) => `${b("\u2502")} ${s}${" ".repeat(Math.max(0, inner - visibleWidth(s)))} ${b("\u2502")}`;
          const title = " \u{1f465} Subagents ";
          const top = b("\u256d") + theme.fg("accent", title) + b(`${"\u2500".repeat(Math.max(0, inner + 2 - visibleWidth(title)))}\u256e`);
          const pos = lines.length > pageSize ? `${scroll + 1}-${scroll + shown.length}/${lines.length}  ` : "";
          const help = theme.fg("dim", truncateToWidth(`${pos}\u2191\u2193 scroll \u00b7 pgup/pgdn page \u00b7 esc close`, inner));
          return [top, ...shown.map(row), row(help), b(`\u2570${"\u2500".repeat(inner + 2)}\u256f`)];
        },
        handleInput(data: string): void {
          if (
            keybindings.matches(data, "tui.select.cancel") ||
            keybindings.matches(data, "tui.select.confirm") ||
            closeKeys.some((k) => matchesKey(data, k as KeyId))
          ) {
            finish();
            return;
          }
          if (keybindings.matches(data, "tui.select.up")) scroll = Math.max(0, scroll - 1);
          else if (keybindings.matches(data, "tui.select.down")) scroll++;
          else if (keybindings.matches(data, "tui.select.pageUp")) scroll = Math.max(0, scroll - pageSize);
          else if (keybindings.matches(data, "tui.select.pageDown")) scroll += pageSize;
          else return;
          tui.requestRender();
        },
        invalidate() {},
      };
    },
    { overlay: true, overlayOptions: { anchor: "center", width: "85%", maxHeight: "70%" } },
  );
}
