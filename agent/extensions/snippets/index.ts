import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Expands a trigger word at the end of the editor text into a full instruction.
// Type e.g. "refactor the parser, kiss", press the key, and "kiss" becomes the
// snippet text. Several snippets can go in one message.
//
// The key comes from "ext.snippets.expand" in ~/.pi/agent/keybindings.json.
// Pi only knows app.* and tui.* ids, so this extension reads that entry itself.
// The default key is ctrl+j, which pi also uses for "new line", so
// keybindings.json leaves new line on shift+enter only.
//
// @src https://github.com/jay-aye-see-kay/.pi/blob/71b89d9/agent/extensions/snippets.ts
const ACTION = "ext.snippets.expand";

const SNIPPETS: Record<string, string> = {
	["23"]: "give me 2-3 options",
	brief: "keep it brief: bullet points, focus on the why, no preamble",
	fix: "identify the root cause, explain it, then provide the fix with a brief justification",
	kiss: "keep it simple: pick the most straightforward approach, we can improve later if needed",
	pat: "look at how similar things are already done in this codebase and follow that pattern",
	sand: "this is a sandbox issue that shouldn't be there, stop the current task and focus only on adjusting the sandbox",
	sub: "use a subagent for this",
	tdd: "use red/green TDD: write a failing test first, then the minimal code to make it pass, then refactor",
};

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

export default function (pi: ExtensionAPI) {
	const keys = [...new Set(configuredKeys())];

	if (keys.length === 0) {
		pi.on("session_start", (_event, ctx) => {
			if (ctx.hasUI) ctx.ui.notify(`snippets: no key for "${ACTION}" in keybindings.json`, "warning");
		});
		return;
	}

	for (const key of keys) {
		pi.registerShortcut(key as ShortcutKey, {
			description: "Expand snippet trigger (e.g. `tdd` → full instruction)",
			handler: async (ctx) => {
				const text = ctx.ui.getEditorText();

				// The last word is the trigger candidate.
				const match = text.match(/(\S+)$/);
				if (!match) return;

				const trigger = match[1];
				const expansion = SNIPPETS[trigger];
				if (!expansion) return;

				const before = text.slice(0, text.length - trigger.length);
				ctx.ui.setEditorText(before + expansion);
			},
		});
	}
}
