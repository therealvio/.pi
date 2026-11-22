import type { ExtensionAPI, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Secrets: load one-off secrets and hide all secret values in tool output.
 *
 * Loads two optional files into process.env:
 *   ~/.pi/agent/configs/.env.private  global; at startup
 *   <project>/.pi/.env.private        per project; at session start, and only
 *                                     when the project is trusted
 * Use them for secrets that aren't intended to be tracked in dotfiles, such
 * as one-offs, or per-project secrets. pikit's env-loader still loads
 * ~/.pi/agent/configs/.env (managed by chezmoi).
 *
 * Precedence, highest first: shell and .env > project .env.private > global
 * .env.private. A project file is untrusted input: a variable such as
 * NODE_OPTIONS can run code, so it is read only after project trust.
 *
 * Replaces the value of every key in these files with <redacted:KEY> in tool
 * results, including tools nested in codemode. This stops accidental leaks
 * (`env`, `echo $X`, reading the file) into the session transcript. It does
 * not stop deliberate exfiltration, and it does not cover `!` commands the
 * user runs.
 *
 * /secrets lists the hidden key names (never the values).
 *
 * Adapted from the redaction in jay-aye-see-kay/.pi
 * agent/extensions/secrets.ts.
 */

const CONFIG_DIR = join(homedir(), ".pi", "agent", "configs");
const ENV_FILE = join(CONFIG_DIR, ".env");
const GLOBAL_PRIVATE = join(CONFIG_DIR, ".env.private");
const PROJECT_PRIVATE = [".pi", ".env.private"];

// Shorter values ("1", "true", ports) would redact unrelated output.
const MIN_SECRET_LENGTH = 8;

type JsonValue = NonNullable<ToolResultEvent["structuredContent"]> | null;

// /reload and session switches load this module again in the same process, and
// process.env keeps its values. So the record of what this extension set lives
// on globalThis; a module-level record would be lost and the keys would look
// like shell values.
interface State {
	/** Keys set from the global .env.private, with their values. */
	global: Map<string, string>;
	/** Keys set from a project .env.private, with the value each one replaced. */
	project: Map<string, string | undefined>;
}
const STATE = Symbol.for("pi.secrets.state");
const store = globalThis as { [STATE]?: State };
const state = (store[STATE] ??= { global: new Map(), project: new Map() });

/** Parses KEY=value lines. Same syntax as env-loader: export prefix, quotes, # comments. */
function parseEnvFile(path: string): Map<string, string> {
	const entries = new Map<string, string>();
	let text: string;
	try {
		text = readFileSync(path, "utf-8");
	} catch {
		return entries; // A missing file is normal.
	}
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const stripped = line.startsWith("export ") ? line.slice(7).trimStart() : line;
		const eq = stripped.indexOf("=");
		if (eq === -1) continue;
		const key = stripped.slice(0, eq).trim();
		if (!key) continue;
		let value = stripped.slice(eq + 1);
		const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
		value = quoted ? value.slice(1, -1) : value.trim();
		entries.set(key, value);
	}
	return entries;
}

/** Puts back every value a project file replaced. */
function unloadProject(): void {
	for (const [key, previous] of state.project) {
		if (previous === undefined) delete process.env[key];
		else process.env[key] = previous;
	}
	state.project.clear();
}

export default function (pi: ExtensionAPI) {
	for (const [key, value] of parseEnvFile(GLOBAL_PRIVATE)) {
		if (process.env[key] !== undefined) continue;
		process.env[key] = value;
		state.global.set(key, value);
	}

	// Key names only. Values are read from process.env at redaction time, so a
	// shell value is hidden too and load order with env-loader does not matter.
	const baseKeys = [...parseEnvFile(ENV_FILE).keys(), ...parseEnvFile(GLOBAL_PRIVATE).keys()];
	let projectKeys: string[] = [];
	const secretKeys = () => [...new Set([...baseKeys, ...projectKeys])];

	pi.on("session_start", (_event, ctx) => {
		// A crash or a missed shutdown must not carry one project's values into the next.
		unloadProject();
		projectKeys = [];
		if (!ctx.isProjectTrusted()) return;
		const entries = parseEnvFile(join(ctx.cwd, ...PROJECT_PRIVATE));
		projectKeys = [...entries.keys()];
		for (const [key, value] of entries) {
			const current = process.env[key];
			// Override only unset keys and values that came from the global private file.
			const fromGlobal = current !== undefined && state.global.get(key) === current;
			if (current !== undefined && !fromGlobal) continue;
			state.project.set(key, current);
			process.env[key] = value;
		}
	});

	pi.on("session_shutdown", () => {
		unloadProject();
		projectKeys = [];
	});

	function redactions(): { key: string; value: string }[] {
		return secretKeys()
			.map((key) => ({ key, value: process.env[key] ?? "" }))
			.filter((r) => r.value.length >= MIN_SECRET_LENGTH)
			// Longest first, so a value that contains another is replaced whole.
			.sort((a, b) => b.value.length - a.value.length);
	}

	pi.on("tool_result", (event) => {
		const rules = redactions();
		if (rules.length === 0) return;
		const redact = (s: string) => {
			for (const r of rules) if (s.includes(r.value)) s = s.split(r.value).join(`<redacted:${r.key}>`);
			return s;
		};
		const redactDeep = (v: JsonValue): JsonValue => {
			if (typeof v === "string") return redact(v);
			if (Array.isArray(v)) return v.map(redactDeep);
			if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactDeep(x)]));
			return v;
		};

		let changed = false;
		const content = event.content.map((c) => {
			if (c.type !== "text") return c;
			const text = redact(c.text);
			if (text === c.text) return c;
			changed = true;
			return { ...c, text };
		});
		// Return structuredContent too: replacing content alone drops it.
		let structuredContent = event.structuredContent;
		if (structuredContent !== undefined) {
			const after = redactDeep(structuredContent);
			if (JSON.stringify(after) !== JSON.stringify(structuredContent)) {
				structuredContent = after as typeof structuredContent;
				changed = true;
			}
		}
		if (changed) return { content, structuredContent };
	});

	pi.registerCommand("secrets", {
		description: "List secret key names hidden in tool output (never the values)",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			const active = new Set(redactions().map((r) => r.key));
			const project = new Set(projectKeys);
			const lines = secretKeys().map((k) => {
				const notes = [project.has(k) ? "project" : "", active.has(k) ? "" : "not set or too short, not hidden"].filter(Boolean);
				return `  ${k}${notes.length ? ` (${notes.join("; ")})` : ""}`;
			});
			ctx.ui.notify(
				lines.length ? `Hidden in tool output:\n${lines.join("\n")}` : "No keys in .env or .env.private files.",
				"info",
			);
		},
	});
}
