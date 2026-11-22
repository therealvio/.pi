import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Sets the thinking level when pikit's plan or chat mode changes:
 * plan -> the "plan" level; off, execute and chat -> the "default" level.
 *
 * Config (~/.pi/agent/configs/mode-thinking.json):
 *   { "plan": "high", "default": "medium" }
 * Levels: off, minimal, low, medium, high, xhigh, max. A missing file or an
 * unknown level falls back to high / medium.
 *
 * pikit's plan-mode and chat-mode emit "plan-mode:state" / "chat-mode:state"
 * on pi.events with { mode }. They emit again on unrelated status updates, so
 * only a real mode change sets the level. Otherwise a repeat would undo a level
 * set by hand (ctrl+shift+t) without a mode change.
 *
 * The level comes from both modes together, not from the last event. On a
 * resumed plan session, chat-mode's first "off" must not drop plan's high.
 *
 * pi.setThinkingLevel() clamps to what the model supports, so no model check.
 * If pikit renames these events, this stops working without an error.
 */

type Level = Parameters<ExtensionAPI["setThinkingLevel"]>[0];
const LEVELS: readonly string[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

function readLevels(): { plan: Level; default: Level } {
	let config: Record<string, unknown> = {};
	try {
		config = JSON.parse(readFileSync(join(getAgentDir(), "configs", "mode-thinking.json"), "utf8")) ?? {};
	} catch {
		// no file: use the fallbacks below
	}
	const pick = (value: unknown, fallback: Level): Level =>
		typeof value === "string" && LEVELS.includes(value) ? (value as Level) : fallback;
	return { plan: pick(config.plan, "high"), default: pick(config.default, "medium") };
}

export default function (pi: ExtensionAPI) {
	const levels = readLevels();
	const modes: Record<string, string | undefined> = {};

	function follow(event: string) {
		pi.events.on(event, (data) => {
			const mode = (data as { mode?: unknown } | undefined)?.mode;
			if (typeof mode !== "string" || mode === modes[event]) return;
			modes[event] = mode;
			pi.setThinkingLevel(modes["plan-mode:state"] === "plan" ? levels.plan : levels.default);
		});
	}

	follow("plan-mode:state");
	follow("chat-mode:state");
}
