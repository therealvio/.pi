import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Replaces pi's default "Working" loader text with a random verb on each turn.
//
// Config (~/.pi/agent/configs/spinner-verbs.json):
//   { "verbs": ["Grabbing the D", "LFGing"] }
// No file or no verbs = pi's default text. Edit the file, then /reload.

function readVerbs(): string[] {
	try {
		const config = JSON.parse(readFileSync(join(getAgentDir(), "configs", "spinner-verbs.json"), "utf8"));
		const verbs = config?.verbs;
		return Array.isArray(verbs) ? verbs.filter((v): v is string => typeof v === "string" && v.trim() !== "") : [];
	} catch {
		return [];
	}
}

export default function (pi: ExtensionAPI) {
	const verbs = readVerbs();
	if (verbs.length === 0) return;

	pi.on("turn_start", (_event, ctx) => {
		const verb = verbs[Math.floor(Math.random() * verbs.length)];
		ctx.ui.setWorkingMessage(`${verb}…`);
	});
}
