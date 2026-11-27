import { getAgentDir, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, stripTerminalSequences, truncateToWidth, visibleWidth, type KeyId } from "@earendil-works/pi-tui";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

// Replaces the pi-lens widget with one short footer status and a key that
// opens the findings in an overlay. The widget grows the footer by one line per
// finding; this keeps the footer at a fixed height.
//
// Turn the pi-lens widget off in ~/.pi-lens/config.json:
//   { "widget": { "visible": false } }
//
// Data comes from the "pilens:diagnostics" event on pi.events. Each event holds
// the full set for each file it names, so a file entry replaces the old one and
// an empty list means the file is clean. Set PI_LENS_BUS_PUBLISH=0 and this
// extension gets no data.
//
// pi-lens also puts its language-server state in the footer (status key
// "pi-lens-lsp"). It has no event for that state, so this extension wraps the
// shared ui.setStatus, keeps that one status for the overlay and does not pass
// it on to the footer. All other keys pass through unchanged.
//
// The key comes from "ext.lens-panel.open" in ~/.pi/agent/keybindings.json.
const ACTION = "ext.lens-panel.open";
const STATUS_KEY = "lens-panel";
const EVENT = "pilens:diagnostics";
const LSP_STATUS_KEY = "pi-lens-lsp";
const HOOKED = Symbol.for("lens-panel.setStatus");

type Severity = "error" | "warning" | "info" | "hint";

interface Diagnostic {
	ruleId?: string;
	severity: Severity;
	line?: number;
	col?: number;
	message: string;
	tool: string;
	fixable?: boolean;
}

interface DiagnosticsPayload {
	v: number;
	seq: number;
	cwd: string;
	files: Array<{ path: string; diagnostics: Diagnostic[]; truncated?: boolean }>;
}

interface FileEntry {
	diagnostics: Diagnostic[];
	truncated: boolean;
}

type ShortcutKey = Parameters<ExtensionAPI["registerShortcut"]>[0];

/** Keys bound to ACTION in keybindings.json: a string or a string array. */
function configuredKeys(): string[] {
	try {
		const config = JSON.parse(readFileSync(join(getAgentDir(), "keybindings.json"), "utf8"));
		const value = config?.[ACTION];
		const keys = typeof value === "string" ? [value] : value;
		return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string") : [];
	} catch {
		return [];
	}
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2, hint: 3 };

function severityColor(severity: Severity): "error" | "warning" | "muted" | "dim" {
	if (severity === "error") return "error";
	if (severity === "warning") return "warning";
	if (severity === "info") return "muted";
	return "dim";
}

interface LspState {
	active: string[];
	failed: string[];
	/** False until pi-lens reports, or when its LSP status is turned off. */
	reported: boolean;
}

/** Reads pi-lens's footer text, e.g. "LSP Active: typescript, json · LSP Failed: yaml". */
function parseLspStatus(text: string | undefined): LspState {
	if (text === undefined) return { active: [], failed: [], reported: false };
	const plain = stripTerminalSequences(text);
	const list = (re: RegExp) =>
		(plain.match(re)?.[1] ?? "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	const state = { active: list(/LSP Active:\s*([^·]+)/), failed: list(/LSP Failed:\s*([^·]+)/), reported: true };
	// Compact mode ("LSP ✓") has no server names.
	if (state.active.length === 0 && plain.includes("LSP ✓")) state.active.push("(names hidden by compact mode)");
	return state;
}

function severityIcon(severity: Severity): string {
	if (severity === "error") return "✖";
	if (severity === "warning") return "▲";
	return "●";
}

export default function (pi: ExtensionAPI) {
	const files = new Map<string, FileEntry>();
	/** Every tool that reported a finding this session, also after the finding clears. */
	const toolsSeen = new Set<string>();
	let lsp: LspState = parseLspStatus(undefined);
	/** Open panels re-render through these. */
	const listeners = new Set<() => void>();
	const changed = () => {
		for (const fn of listeners) fn();
	};
	let lastSeq = 0;
	let ctx: ExtensionContext | undefined;
	const keys = [...new Set(configuredKeys())];

	function counts() {
		let errors = 0;
		let warnings = 0;
		let other = 0;
		for (const entry of files.values()) {
			for (const d of entry.diagnostics) {
				if (d.severity === "error") errors++;
				else if (d.severity === "warning") warnings++;
				else other++;
			}
		}
		return { errors, warnings, other, total: errors + warnings + other };
	}

	function updateStatus() {
		if (!ctx?.hasUI) return;
		const c = counts();
		if (c.total === 0) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}
		const t = ctx.ui.theme;
		const parts: string[] = [];
		if (c.errors) parts.push(t.fg("error", `✖ ${c.errors}`));
		if (c.warnings) parts.push(t.fg("warning", `▲ ${c.warnings}`));
		if (c.other) parts.push(t.fg("muted", `● ${c.other}`));
		ctx.ui.setStatus(STATUS_KEY, `🔍 ${t.fg("muted", "Lens:")} ${parts.join(" ")}`);
	}

	/**
	 * Takes the pi-lens LSP status out of the footer. ctx.ui is one object that
	 * all extensions share, so the wrap also catches pi-lens's calls. pi-lens may
	 * have set the status before this runs, so clear it once here.
	 */
	function hookLspStatus(c: ExtensionContext) {
		const ui = c.ui as ExtensionContext["ui"] & { [HOOKED]?: boolean };
		if (ui[HOOKED]) return;
		const original = ui.setStatus.bind(ui);
		ui.setStatus = (key, text) => {
			if (key !== LSP_STATUS_KEY) return original(key, text);
			lsp = parseLspStatus(text);
			changed();
		};
		ui[HOOKED] = true;
		original(LSP_STATUS_KEY, undefined);
	}

	/** Overlay lines about pi-lens itself: language servers and linters. */
	function toolLines(theme: Theme): string[] {
		const label = (s: string) => theme.fg("muted", s.padEnd(9));
		let servers: string;
		if (!lsp.reported) servers = theme.fg("dim", "not reported yet");
		else if (lsp.active.length === 0 && lsp.failed.length === 0) servers = theme.fg("dim", "none running");
		else {
			const parts: string[] = [];
			if (lsp.active.length) parts.push(theme.fg("success", `✓ ${lsp.active.join(", ")}`));
			if (lsp.failed.length) parts.push(theme.fg("error", `✗ ${lsp.failed.join(", ")}`));
			servers = parts.join("  ");
		}
		const linters = toolsSeen.size
			? [...toolsSeen].sort((a, b) => a.localeCompare(b)).join(", ")
			: theme.fg("dim", "none have reported findings yet");
		return [`${label("LSP")}${servers}`, `${label("Linters")}${linters}`];
	}

	/** Builds the overlay body: tool lines, then one header line per file and one line per finding. */
	function bodyLines(theme: Theme, cwd: string): string[] {
		const lines: string[] = [...toolLines(theme), ""];
		const sorted = [...files.entries()]
			.filter(([, e]) => e.diagnostics.length > 0)
			.sort(([a], [b]) => a.localeCompare(b));
		for (const [path, entry] of sorted) {
			const rel = relative(cwd, path);
			const name = rel.startsWith("..") ? path : rel;
			const more = entry.truncated ? theme.fg("dim", " (capped, more not shown)") : "";
			lines.push(theme.fg("accent", theme.bold(name)) + theme.fg("dim", ` ${entry.diagnostics.length}`) + more);
			const diags = [...entry.diagnostics].sort(
				(a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (a.line ?? 0) - (b.line ?? 0),
			);
			for (const d of diags) {
				let loc = "-";
				if (d.line != null) loc = d.col != null ? `${d.line}:${d.col}` : `${d.line}`;
				const src = [d.tool, d.ruleId].filter(Boolean).join("/");
				const fix = d.fixable ? theme.fg("success", " fixable") : "";
				lines.push(
					`  ${theme.fg(severityColor(d.severity), severityIcon(d.severity))} ${theme.fg("dim", loc.padEnd(7))} ` +
						`${d.message.replace(/\s+/g, " ")} ${theme.fg("dim", `[${src}]`)}${fix}`,
				);
			}
		}
		if (sorted.length === 0) lines.push(theme.fg("success", "No findings."));
		return lines;
	}

	async function openPanel(c: ExtensionContext) {
		if (c.mode !== "tui") {
			c.ui.notify("lens-panel needs interactive mode", "warning");
			return;
		}
		await c.ui.custom<void>(
			(tui, theme, keybindings, done) => {
				let scroll = 0;
				let pageSize = 10;

				// Re-render when findings or LSP state change while the panel is open.
				const rerender = () => tui.requestRender();
				listeners.add(rerender);

				const finish = () => {
					listeners.delete(rerender);
					done();
				};

				return {
					render(width: number): string[] {
						const inner = Math.max(10, width - 4);
						const body = bodyLines(theme, c.cwd).map((l) => truncateToWidth(l, inner));
						// Overlay maxHeight is 70% of the terminal; take off border, title and footer.
						pageSize = Math.max(3, Math.floor(tui.terminal.rows * 0.7) - 4);
						const maxScroll = Math.max(0, body.length - pageSize);
						scroll = Math.min(scroll, maxScroll);
						const view = body.slice(scroll, scroll + pageSize);

						const b = (s: string) => theme.fg("border", s);
						const pad = (s: string) => s + " ".repeat(Math.max(0, inner - visibleWidth(s)));
						const row = (s: string) => `${b("│")} ${pad(s)} ${b("│")}`;

						const cnt = counts();
						const title = ` 🔍 Lens: ${cnt.errors} errors, ${cnt.warnings} warnings, ${cnt.other} other `;
						const top = b("╭") + theme.fg("accent", truncateToWidth(title, inner + 2)) +
							b("─".repeat(Math.max(0, inner + 2 - visibleWidth(title))) + "╮");
						const pos = body.length > pageSize ? `${scroll + 1}-${scroll + view.length}/${body.length}  ` : "";
						const help = theme.fg("dim", truncateToWidth(`${pos}↑↓ scroll · pgup/pgdn page · esc close`, inner));
						return [
							top,
							...view.map(row),
							row(""),
							row(help),
							b("╰" + "─".repeat(inner + 2) + "╯"),
						];
					},
					handleInput(data: string): void {
						if (keybindings.matches(data, "tui.select.cancel") || keybindings.matches(data, "tui.select.confirm")) {
							finish();
							return;
						}
						if (keys.some((k) => matchesKey(data, k as KeyId))) {
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

	pi.events.on(EVENT, (data) => {
		const payload = data as DiagnosticsPayload;
		if (!payload || !Array.isArray(payload.files)) return;
		// A higher seq always wins; drop events that arrive late.
		if (typeof payload.seq === "number") {
			if (payload.seq <= lastSeq) return;
			lastSeq = payload.seq;
		}
		for (const f of payload.files) {
			if (!f?.path || !Array.isArray(f.diagnostics)) continue;
			if (f.diagnostics.length === 0) files.delete(f.path);
			else files.set(f.path, { diagnostics: f.diagnostics, truncated: f.truncated === true });
			for (const d of f.diagnostics) if (d.tool) toolsSeen.add(d.tool);
		}
		updateStatus();
		changed();
	});

	pi.on("session_start", (_event, c) => {
		ctx = c;
		files.clear();
		toolsSeen.clear();
		if (c.hasUI) hookLspStatus(c);
		updateStatus();
		if (keys.length === 0 && c.hasUI) c.ui.notify(`lens-panel: no key for "${ACTION}" in keybindings.json`, "warning");
	});

	pi.registerCommand("lens-panel", {
		description: "Show pi-lens findings, language servers and linters in an overlay",
		handler: async (_args, c) => openPanel(c),
	});

	for (const key of keys) {
		pi.registerShortcut(key as ShortcutKey, {
			description: "Show pi-lens findings",
			handler: async (c) => openPanel(c),
		});
	}
}
