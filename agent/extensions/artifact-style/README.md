# artifact-style

Styles the output of the pikit `artifact` tool. The model does not need to do anything. The extension adds a Solarized colour palette and a hand-drawn look for Mermaid diagrams.

## How it works

The extension hooks the `tool_call` event. It changes the tool input before the tool runs.

It acts only when all of these are true:

- The tool is `artifact`.
- `action` is `create` or `update`.
- `content` is a non-empty string.

Then it does this:

1. For `kind: "markdown"`, it adds a Mermaid config to each ```mermaid``` block. It skips a block that starts with `---` or `%%{`, because the model set its own config. The config sets `look: handDrawn`, SVG text labels, no width shrink, and the "Shadows Into Light" font. For `flowchart` and `graph` diagrams it also adds `classDef default stroke-width:2px`.
2. It adds a `<style>` block to the start of the content. The block holds the palette (follows the system light/dark setting), the font import from Google Fonts, and rules that stop wide diagrams from shrinking. The block has a marker comment, so the extension never adds it twice.
3. For `kind: "html"` with a full document (starts with `<!doctype` or `<html`), it adds no style block. A block before the doctype would break the full-document check.

Calls that use `path` instead of `content` are not changed. The tool reads that file itself.

If pikit renames the tool or its `action`, `kind` or `content` inputs, the extension stops without an error. Artifacts still work but have no styling.

## Commands / Tools / CLI flags

None. The extension registers no commands, tools or flags.

## Configuration

None. The palette, font and Mermaid config are constants in `index.ts`.

## Keybindings

None.
