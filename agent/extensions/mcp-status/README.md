# mcp-status

Shows a short MCP status in the footer, for example `🔌 MCP: 5/6`. The first number is the count of enabled servers. The second number is the count of all configured servers. Use `/mcp` for details.

## How it works

- The extension listens to the `pi-mcp-adapter/status/v1` event on `pi.events`. The adapter sends a full snapshot each time its state changes. The extension keeps the last snapshot.
- On `session_start` it saves the context and draws the status.
- It draws only when the UI is available (`ctx.hasUI`).
- A server counts as enabled when it is not `disabled` and its status is not `blocked`.
- With no servers, the status is cleared.
- Normal text uses the `accent` colour. If any server has status `needs-auth` or `failed`, the text ends with ` !` and uses the `warning` colour.
- The status key is `mcp-status`.

The adapter writes its own long footer status. Turn it off, or two statuses show. In `~/.pi/agent/mcp-adapter.json` set:

```json
{ "settings": { "mcpFooterStatus": "off" } }
```

## Commands / Tools / CLI flags

None. The extension registers no commands, tools or flags. The `/mcp` command comes from pi-mcp-adapter.

## Configuration

None for this extension. See the adapter setting above.

## Keybindings

None.
