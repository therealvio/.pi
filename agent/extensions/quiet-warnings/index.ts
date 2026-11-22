// Quiet noisy runtime warnings to save agent context.
//
// Covers: Node + Bun (NODE_NO_WARNINGS, same var for both) and Python
// (PYTHONWARNINGS). Bash calls inherit pi's process.env, so they get these.
// Ruby (RUBYOPT -W0) is left out until Ruby is in use.
//
// Enabled by default; toggle for the session with /quiet-warnings.
//
// @src https://github.com/jay-aye-see-kay/.pi/blob/30b5da4/agent/extensions/quiet-warnings.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Snapshot of each key's value before this extension first set it, so
// /quiet-warnings can restore it. It lives on globalThis because /reload loads
// this module again in the same process: a module-level snapshot would then
// record the quiet values as the "originals".
const ORIGINALS = Symbol.for("pi.quiet-warnings.originals");
const store = globalThis as { [ORIGINALS]?: Map<string, string | undefined> };
const originals = (store[ORIGINALS] ??= new Map());

function remember(key: string) {
	if (!originals.has(key)) originals.set(key, process.env[key]);
}

function apply() {
	// Node + Bun. Boolean flag; respect a launch-time value.
	remember("NODE_NO_WARNINGS");
	process.env.NODE_NO_WARNINGS ??= "1";
	// Python. Respect a project's own warning filter list.
	remember("PYTHONWARNINGS");
	process.env.PYTHONWARNINGS ??= "ignore";
}

function restore() {
	for (const [key, value] of originals) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

export default function quietWarnings(pi: ExtensionAPI) {
	let enabled = true;
	apply();

	pi.registerCommand("quiet-warnings", {
		description: "Toggle suppression of runtime warnings in bash calls (Node/Bun, Python)",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			if (enabled) apply();
			else restore();
			ctx.ui.notify(`quiet-warnings: ${enabled ? "on" : "off"}`, "info");
		},
	});
}
