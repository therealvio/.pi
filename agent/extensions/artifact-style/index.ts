import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Styles pikit's `artifact` tool output without help from the model.
 *
 * Before each `artifact` create/update that has inline `content`, this patches
 * the tool input (pi lets a `tool_call` handler mutate `event.input`):
 *   - Adds STYLE_BLOCK to the start: a Solarized palette that follows the
 *     system light/dark setting, plus the diagram font.
 *   - Adds MERMAID_CONFIG to each mermaid block that has no config of its own,
 *     for a hand-drawn look.
 *
 * Calls with `path` are not patched: the tool reads that file itself.
 * If pikit renames the tool or its `action`/`kind`/`content` inputs, this stops
 * patching without an error. Artifacts still work, but lose the styling.
 */

// Matches the artifacts stylesheet tokens (pikit artifacts/styles.ts). A later
// :root rule wins, so these replace the default palette. The artifact's mermaid
// init reads the same variables at page load, so diagrams follow them too.
// The marker comment stops a second copy when content already has the block.
const STYLE_MARKER = "/* artifact-style */";
const STYLE_BLOCK = `<style>
@import url("https://fonts.googleapis.com/css2?family=Shadows+Into+Light&display=swap");
${STYLE_MARKER}
:root{--bg:#fdf6e3;--fg:#586e75;--muted:#93a1a1;--border:#93a1a1;--code-bg:#eee8d5;--accent:#268bd2;--add-bg:rgba(133,153,0,.12);--add-word-bg:rgba(133,153,0,.3);--add-fg:#859900;--del-bg:rgba(220,50,47,.1);--del-word-bg:rgba(220,50,47,.25);--del-fg:#dc322f;--hl-comment:#93a1a1;--hl-keyword:#859900;--hl-string:#2aa198;--hl-number:#d33682;--hl-title:#268bd2;--hl-type:#b58900;--hl-attr:#cb4b16}
@media (prefers-color-scheme:dark){:root{--bg:#002b36;--fg:#93a1a1;--muted:#657b83;--border:#586e75;--code-bg:#073642;--hl-comment:#586e75}}
.artifact-mermaid{overflow-x:auto}
.artifact-mermaid svg{max-width:none}
</style>

`;

// The artifacts stylesheet caps every svg at the column width (max-width:100%),
// which shrinks wide diagrams and their text; STYLE_BLOCK lifts that cap and
// useMaxWidth:false stops mermaid shrinking them too.
// htmlLabels:false draws labels as SVG text. HTML labels clip when the web font
// loads after mermaid measures the text.
// fontFamily must stay unquoted. Mermaid drops the font when the names are quoted.
// No colours here: they come from STYLE_BLOCK.
const MERMAID_CONFIG = `---
config:
  look: handDrawn
  htmlLabels: false
  flowchart:
    htmlLabels: false
    useMaxWidth: false
    padding: 20
  themeVariables:
    fontFamily: "Shadows Into Light, Comic Sans MS, Chalkboard SE, cursive"
    fontSize: 22px
---
`;

// classDef is flowchart syntax. In other diagram types it is a parse error.
const FLOWCHART_STROKE = "\n  classDef default stroke-width:2px";

const MERMAID_FENCE = /^```mermaid[ \t]*\n([\s\S]*?)^```[ \t]*$/gm;
const FULL_HTML_DOC = /^\s*(<!doctype|<html)/i;

function styleMermaid(markdown: string): string {
	return markdown.replace(MERMAID_FENCE, (block, body: string) => {
		const code = body.trimStart();
		// The model set its own config (front matter or a directive): keep it.
		if (code.startsWith("---") || code.startsWith("%%{")) return block;
		const stroke = /^(flowchart|graph)\b/.test(code) ? FLOWCHART_STROKE : "";
		return "```mermaid\n" + MERMAID_CONFIG + code.trimEnd() + stroke + "\n```";
	});
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", (event) => {
		if (event.toolName !== "artifact") return;
		const input = event.input as { action?: unknown; kind?: unknown; content?: unknown };
		if (input.action !== "create" && input.action !== "update") return;
		if (typeof input.content !== "string" || input.content === "") return;

		let content = input.content;
		if (input.kind === "markdown") content = styleMermaid(content);
		// A block before <!DOCTYPE> would break artifact's full-document check,
		// so full html documents are left alone.
		const fullDoc = input.kind === "html" && FULL_HTML_DOC.test(content);
		if (!fullDoc && !content.includes(STYLE_MARKER)) content = STYLE_BLOCK + content;
		input.content = content;
	});
}
