import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AvailableModel, ModelsConfig } from "./types";

/**
 * Read & validate the model list from ~/.pi/agent/configs/subagents.json.
 *
 * `models` maps model id → description. Order matters: the first entry is
 * the default when a tool call omits `model`. Use models that cost less
 * than the main agent's model:
 *   {
 *     "models": {
 *       "anthropic/claude-haiku-5-5": "fast and cheap, the default",
 *       "anthropic/claude-sonnet-5-5": "for harder work"
 *     }
 *   }
 * No file or no `models` key = the tool is not registered. A malformed list
 * disables the tool and warns the user at session start.
 */
export function readSubagentModels(): ModelsConfig {
  let parsed: { models?: unknown };
  try {
    parsed = JSON.parse(readFileSync(join(getAgentDir(), "configs", "subagents.json"), "utf8"));
  } catch {
    return { status: "disabled" };
  }
  const raw = parsed.models;
  if (raw === undefined) return { status: "disabled" }; // no key, no fallback
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      status: "invalid",
      message: "configs/subagents.json: models must map model ids to descriptions.",
    };
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) {
    return { status: "invalid", message: "configs/subagents.json: models must list at least one model." };
  }
  const bad = entries.filter(([, desc]) => typeof desc !== "string" || !desc.trim());
  if (bad.length) {
    return {
      status: "invalid",
      message: `configs/subagents.json: needs a non-empty description for: ${bad.map(([id]) => id).join(", ")}.`,
    };
  }
  const models: AvailableModel[] = entries.map(([id, desc]) => ({
    id: id.trim(),
    description: (desc as string).trim(),
  }));
  return { status: "ok", models };
}
