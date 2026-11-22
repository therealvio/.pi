import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Expands a trigger word at the end of the editor text into a full instruction.
// Type e.g. "refactor the parser, kiss", press the key, and "kiss" becomes the
// snippet text. Several snippets can go in one message.
//
// Snippets come from ~/.pi/agent/configs/snippets.json:
//   { "snippets": { "kiss": "keep it simple: ..." } }
// No file or no snippets = the key does nothing. Edit the file, then /reload.
//
// The key comes from "ext.snippets.expand" in ~/.pi/agent/keybindings.json.
// Pi only knows app.* and tui.* ids, so this extension reads that entry itself.
// The default key is ctrl+j, which pi also uses for "new line", so
// keybindings.json leaves new line on shift+enter only.
//
// @src https://github.com/jay-aye-see-kay/.pi/blob/71b89d9/agent/extensions/snippets.ts
const ACTION = "ext.snippets.expand";

/** Trigger word -> text, from configs/snippets.json. Bad entries are skipped. */
function readSnippets(): Map<string, string> {
	try {
		const config = JSON.parse(readFileSync(join(getAgentDir(), "configs", "snippets.json"), "utf8"));
		const raw = config?.snippets;
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return new Map();
		return new Map(
			Object.entries(raw as Record<string, unknown>).filter(
				(e): e is [string, string] => !/\s/.test(e[0]) && typeof e[1] === "string" && e[1].trim() !== "",
			),
		);
	} catch {
		return new Map();
	}
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

export default function (pi: ExtensionAPI) {
	const snippets = readSnippets();
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
				const expansion = snippets.get(trigger);
				if (!expansion) return;

				const before = text.slice(0, text.length - trigger.length);
				ctx.ui.setEditorText(before + expansion);
			},
		});
	}
}
