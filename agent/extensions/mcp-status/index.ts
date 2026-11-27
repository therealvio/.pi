import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Short MCP footer status: "🔌 MCP: 5/6" is enabled servers out of all
// configured servers. Run /mcp for the detail.
//
// pi-mcp-adapter writes a long status of its own. Turn it off in
// ~/.pi/agent/mcp-adapter.json, or both statuses show:
//   { "settings": { "mcpFooterStatus": "off" } }
//
// Data comes from the adapter's "pi-mcp-adapter/status/v1" event on pi.events.
// The adapter sends a full snapshot each time its state changes.
const EVENT = "pi-mcp-adapter/status/v1";
const STATUS_KEY = "mcp-status";

interface ServerSnapshot {
	name: string;
	status: "connected" | "not-connected" | "cached" | "needs-auth" | "failed" | "disabled" | "blocked";
	disabled: boolean;
}

interface StatusSnapshot {
	version: number;
	servers: ServerSnapshot[];
}

export default function (pi: ExtensionAPI) {
	let ctx: ExtensionContext | undefined;
	let last: StatusSnapshot | undefined;

	function render() {
		if (!ctx?.hasUI) return;
		const servers = last?.servers ?? [];
		if (servers.length === 0) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}
		const enabled = servers.filter((s) => !s.disabled && s.status !== "blocked").length;
		// A server that needs sign-in or failed to start needs the user, so mark it.
		const attention = servers.some((s) => s.status === "needs-auth" || s.status === "failed");
		const t = ctx.ui.theme;
		const text = `🔌 MCP: ${enabled}/${servers.length}`;
		ctx.ui.setStatus(STATUS_KEY, attention ? t.fg("warning", `${text} !`) : t.fg("accent", text));
	}

	pi.events.on(EVENT, (data) => {
		const snapshot = data as StatusSnapshot;
		if (!snapshot || !Array.isArray(snapshot.servers)) return;
		last = snapshot;
		render();
	});

	pi.on("session_start", (_event, c) => {
		ctx = c;
		render();
	});
}
