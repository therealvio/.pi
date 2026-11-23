import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";

/**
 * Web search and page fetch without an API key.
 *
 *   web_search  DuckDuckGo's no-JavaScript endpoint (html.duckduckgo.com),
 *               parsed down to title, URL and snippet per result. Ads are skipped.
 *   web_fetch   Fetches a URL and returns readable text: tags stripped, with
 *               headings, links and list items kept. No PDF support.
 *
 * Both fetch from pi's own process, so the sandbox's allowedDomains does not
 * apply to them.
 *
 * DuckDuckGo answers browser-like user agents from scripts with a bot challenge
 * (HTTP 202) and plain agents with results, so USER_AGENT names this tool.
 * If DuckDuckGo changes its result markup, web_search returns no results; the
 * class names it parses are result__a, result__snippet and result--ad.
 *
 * Context7 first: in each user prompt, the first web_search is blocked until
 * a context7 tool has run, because agents skip the written rule. The block
 * tells the agent to try context7, or to call web_search again when the
 * question is not about a library or context7 has no match. The gate is off
 * when no context7 tool is active, for example when the MCP server is down.
 *
 * Config (~/.pi/agent/configs/web.json), each key optional:
 *   { "context7First": true, "fetchChars": 20000, "searchResults": 8,
 *     "timeoutMs": 20000 }
 * context7First false turns the gate off. searchResults and fetchChars are
 * defaults; the agent can still ask for other values per call.
 */
const CONTEXT7_PREFIX = "mcp__context7_";
const CONTEXT7_FIRST =
	"Check context7 first. For a library, framework, SDK, API or CLI tool " +
	"(docs, config, flags, versions, examples), call " +
	"mcp__context7_resolve-library-id, then mcp__context7_query-docs. If the " +
	"question is not about one of those, or context7 has no match, call " +
	"web_search again with the same query; it will not be blocked again for " +
	"this prompt.";

const USER_AGENT = "pi-web/1.0";
const SEARCH_URL = "https://html.duckduckgo.com/html/";
// DuckDuckGo's no-JavaScript page has at most about 20 results.
const MAX_RESULTS = 20;

function readConfig(): Record<string, unknown> {
	try {
		return JSON.parse(readFileSync(join(getAgentDir(), "configs", "web.json"), "utf8")) ?? {};
	} catch {
		return {};
	}
}
const config = readConfig();
const positiveInt = (value: unknown, fallback: number) =>
	typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;

const CONTEXT7_GATE = config.context7First !== false;
const DEFAULT_RESULTS = Math.min(positiveInt(config.searchResults, 8), MAX_RESULTS);
const DEFAULT_FETCH_CHARS = positiveInt(config.fetchChars, 20_000);
const TIMEOUT_MS = positiveInt(config.timeoutMs, 20_000);

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
	return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
		if (e[0] === "#") {
			const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : m;
		}
		return ENTITIES[e.toLowerCase()] ?? m;
	});
}

function stripTags(html: string): string {
	return decodeEntities(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

/** DuckDuckGo wraps result links as //duckduckgo.com/l/?uddg=<encoded target>. */
function realUrl(href: string): string {
	const decoded = decodeEntities(href);
	const match = decoded.match(/[?&]uddg=([^&]+)/);
	if (match) return decodeURIComponent(match[1]);
	return decoded.startsWith("//") ? `https:${decoded}` : decoded;
}

async function get(url: string, signal?: AbortSignal): Promise<Response> {
	const timeout = AbortSignal.timeout(TIMEOUT_MS);
	return fetch(url, {
		headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain,*/*" },
		redirect: "follow",
		signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
	});
}

interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

function parseResults(html: string): SearchResult[] {
	const results: SearchResult[] = [];
	// Each result is one <div class="result ..."> block; ads carry result--ad.
	for (const block of html.split(/<div class="result results_links/).slice(1)) {
		if (/^[^>]*result--ad/.test(block)) continue;
		const link = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
		if (!link) continue;
		const snippet = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/);
		results.push({ title: stripTags(link[2]), url: realUrl(link[1]), snippet: snippet ? stripTags(snippet[1]) : "" });
	}
	return results;
}

/** HTML to plain text that keeps headings, links and list items readable. */
function htmlToText(html: string): { title: string; text: string } {
	const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
	const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
	const text = body
		.replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)\b[\s\S]*?<\/\1>/gi, "")
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n: string, t: string) => `\n\n${"#".repeat(Number(n))} ${stripTags(t)}\n\n`)
		.replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, t: string) => {
			const label = stripTags(t);
			return label && /^https?:/.test(href) ? `[${label}](${decodeEntities(href)})` : label;
		})
		.replace(/<li[^>]*>/gi, "\n- ")
		.replace(/<(br|\/p|\/div|\/tr|\/li|\/pre|\/blockquote|\/section|\/article)[^>]*>/gi, "\n")
		.replace(/<[^>]*>/g, "");
	const cleaned = decodeEntities(text)
		.split("\n")
		.map((l) => l.replace(/[ \t]+/g, " ").trim())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return { title, text: cleaned };
}

function errorResult(message: string) {
	return { content: [{ type: "text" as const, text: message }], details: {}, isError: true };
}

export default function (pi: ExtensionAPI) {
	// Reset for each user prompt.
	let context7Used = false;
	let nudged = false;
	pi.on("before_agent_start", () => {
		context7Used = false;
		nudged = false;
	});
	pi.on("tool_call", (event) => {
		if (event.toolName.startsWith(CONTEXT7_PREFIX)) {
			context7Used = true;
			return;
		}
		if (!CONTEXT7_GATE || event.toolName !== "web_search" || context7Used || nudged) return;
		if (!pi.getActiveTools().some((t) => t.startsWith(CONTEXT7_PREFIX))) return;
		nudged = true;
		return { block: true, reason: CONTEXT7_FIRST };
	});

	pi.registerTool({
		name: "web_search",
		label: "Web search",
		description:
			"Search the web (DuckDuckGo). Returns title, URL and snippet for each result. Read a result with web_fetch. For a library, framework, SDK, API or CLI tool, call context7 first" +
			(CONTEXT7_GATE ? "; the first web_search in a prompt is blocked until context7 has run." : "."),
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			limit: Type.Optional(Type.Number({ description: `Results to return (default ${DEFAULT_RESULTS}, max ${MAX_RESULTS})` })),
		}),
		async execute(_id, params, signal) {
			const limit = Math.min(Math.max(1, Math.floor(params.limit ?? DEFAULT_RESULTS)), MAX_RESULTS);
			let res: Response;
			try {
				res = await get(`${SEARCH_URL}?q=${encodeURIComponent(params.query)}`, signal);
			} catch (e) {
				return errorResult(`web_search failed: ${e instanceof Error ? e.message : String(e)}`);
			}
			const html = await res.text();
			if (res.status === 202 || html.includes("anomaly-modal")) {
				return errorResult("web_search: DuckDuckGo returned a bot challenge. Wait a moment, then retry.");
			}
			if (!res.ok) return errorResult(`web_search: HTTP ${res.status}`);
			const results = parseResults(html).slice(0, limit);
			if (results.length === 0) return { content: [{ type: "text", text: `No results for "${params.query}".` }], details: {} };
			const text = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ""}`).join("\n\n");
			return { content: [{ type: "text", text }], details: { results } };
		},
	});

	pi.registerTool({
		name: "web_fetch",
		label: "Web fetch",
		description:
			"Fetch a web page and return it as readable text (headings, links and lists kept). Not for PDFs or binary files.",
		parameters: Type.Object({
			url: Type.String({ description: "http(s) URL to fetch" }),
			maxChars: Type.Optional(Type.Number({ description: `Truncate the text to this many characters (default ${DEFAULT_FETCH_CHARS})` })),
		}),
		async execute(_id, params, signal) {
			if (!/^https?:\/\//i.test(params.url)) return errorResult("web_fetch: only http(s) URLs are supported.");
			const max = Math.max(500, Math.floor(params.maxChars ?? DEFAULT_FETCH_CHARS));
			let res: Response;
			try {
				res = await get(params.url, signal);
			} catch (e) {
				return errorResult(`web_fetch failed: ${e instanceof Error ? e.message : String(e)}`);
			}
			if (!res.ok) return errorResult(`web_fetch: HTTP ${res.status} for ${params.url}`);
			const type = res.headers.get("content-type") ?? "";
			if (!/text\/|json|xml|javascript/.test(type)) return errorResult(`web_fetch: unsupported content type "${type}".`);
			const raw = await res.text();
			const { title, text } = /html/.test(type) ? htmlToText(raw) : { title: "", text: raw };
			const truncated = text.length > max;
			const body = truncated ? `${text.slice(0, max)}\n\n[truncated: ${text.length - max} more characters; raise maxChars to read more]` : text;
			return {
				content: [{ type: "text", text: `${title ? `# ${title}\n` : ""}${res.url}\n\n${body}` }],
				details: { url: res.url, title, truncated },
			};
		},
	});
}
