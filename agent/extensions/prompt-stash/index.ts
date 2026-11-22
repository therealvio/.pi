import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Swaps the editor text with one stash slot. Press the key to park a draft,
// send something else, then press it again to get the draft back. Text in
// the editor goes into the stash in its place, so nothing is lost.
//
// The key comes from "ext.stash.swap" in ~/.pi/agent/keybindings.json.
// Pi only knows app.* and tui.* ids, so this extension reads that entry itself.
//
// @src https://github.com/jay-aye-see-kay/.pi/blob/2ae4a31/agent/extensions/prompt-stash.ts
const ACTION = "ext.stash.swap";
const STATUS_KEY = "prompt-stash";
const PREVIEW_LENGTH = 30;

// Pi re-imports extensions on /reload, /new, /resume and /fork. The stash
// lives on globalThis to survive those. It is lost when pi exits.
const STASH_KEY = Symbol.for("pi.prompt-stash");
const store = globalThis as typeof globalThis & { [STASH_KEY]?: string };

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

function updateStatus(ctx: ExtensionContext, stash: string): void {
	if (!stash) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}
	const firstLine = stash.trim().split("\n")[0] ?? "";
	const preview = firstLine.length > PREVIEW_LENGTH ? `${firstLine.slice(0, PREVIEW_LENGTH)}…` : firstLine;
	ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", `stash: ${preview}`));
}

export default function (pi: ExtensionAPI) {
	const keys = [...new Set(configuredKeys())];

	if (keys.length === 0) {
		pi.on("session_start", (_event, ctx) => {
			if (ctx.hasUI) ctx.ui.notify(`prompt-stash: no key for "${ACTION}" in keybindings.json`, "warning");
		});
		return;
	}

	pi.on("session_start", (_event, ctx) => {
		updateStatus(ctx, store[STASH_KEY] ?? "");
	});

	for (const key of keys) {
		pi.registerShortcut(key as ShortcutKey, {
			description: "Swap the prompt with the stash",
			handler: async (ctx) => {
				const current = ctx.ui.getEditorText();
				const stash = store[STASH_KEY] ?? "";
				if (!current && !stash) {
					ctx.ui.notify("Nothing to stash", "info");
					return;
				}

				ctx.ui.setEditorText(stash);
				store[STASH_KEY] = current;
				updateStatus(ctx, current);
			},
		});
	}
}
