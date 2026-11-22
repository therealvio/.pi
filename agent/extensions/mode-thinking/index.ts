import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Sets the thinking level when pikit's plan or chat mode changes:
 * plan -> high; off, execute and chat -> medium.
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

export default function (pi: ExtensionAPI) {
	const modes: Record<string, string | undefined> = {};

	function follow(event: string) {
		pi.events.on(event, (data) => {
			const mode = (data as { mode?: unknown } | undefined)?.mode;
			if (typeof mode !== "string" || mode === modes[event]) return;
			modes[event] = mode;
			pi.setThinkingLevel(modes["plan-mode:state"] === "plan" ? "high" : "medium");
		});
	}

	follow("plan-mode:state");
	follow("chat-mode:state");
}
