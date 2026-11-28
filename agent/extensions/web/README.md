# web

Web search and page fetch without an API key. The extension registers two tools. It also makes the agent try context7 before it searches the web.

## How it works

- `web_search` fetches DuckDuckGo's no-JavaScript endpoint (`html.duckduckgo.com`) and parses title, URL, and snippet for each result. It skips ads.
- `web_fetch` fetches a URL and returns readable text. It removes tags, and keeps headings, links, and list items. It accepts only `text/*`, JSON, XML, and JavaScript content types. It does not support PDFs.
- Both tools run in pi's own process. The sandbox `allowedDomains` list does not apply to them.
- Requests use the user agent `pi-web/1.0`. DuckDuckGo gives a bot challenge (HTTP 202) to browser-like agents. If it still gives a challenge, `web_search` returns an error. Retry later.
- If DuckDuckGo changes its markup, `web_search` returns no results. The parser uses the class names `result__a`, `result__snippet`, and `result--ad`.
- **Context7 gate.** The `before_agent_start` event resets the gate for each user prompt. In each prompt, the first `web_search` call is blocked until a tool with the prefix `mcp__context7_` has run. The block message tells the agent to use context7, or to call `web_search` again if the question is not about a library. The second call is not blocked. The gate is off when no context7 tool is active (for example, the MCP server is down).
- Each request has a timeout (`timeoutMs`).

## Tools

| Tool | Parameter | Type | Default | Meaning |
|---|---|---|---|---|
| `web_search` | `query` | string, required | none | Search query. |
| | `limit` | number, optional | `searchResults` (8) | Number of results. Minimum 1, maximum 20. |
| `web_fetch` | `url` | string, required | none | `http(s)` URL. Other schemes give an error. |
| | `maxChars` | number, optional | `fetchChars` (20000) | Truncates the text. Minimum 500. |

## Configuration

Path: `agent/configs/web.json`. All keys are optional.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `context7First` | boolean | `true` | `false` turns the context7 gate off. |
| `searchResults` | positive integer | `8` | Default result count. The code limits it to 20. |
| `fetchChars` | positive integer | `20000` | Default `maxChars` for `web_fetch`. |
| `timeoutMs` | positive integer | `20000` | Request timeout in milliseconds. |

```json
{
  "context7First": true,
  "fetchChars": 20000,
  "searchResults": 8,
  "timeoutMs": 20000
}
```

If the file is missing or invalid, the extension uses the defaults above.

## Keybindings

None.
