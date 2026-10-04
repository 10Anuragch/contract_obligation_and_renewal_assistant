import { config } from "../config.js";
import { Errors } from "../utils/errors.js";
import type { AiExtractor } from "./types.js";
import { OpenAiExtractor } from "./openaiExtractor.js";
import { DemoExtractor } from "./demoExtractor.js";

let override: AiExtractor | null = null;
let cached: AiExtractor | null = null;

/** Tests inject a fake extractor here. */
export function setExtractor(e: AiExtractor | null) {
  override = e;
}

export function aiStatus(): { provider: string; configured: boolean } {
  if (override) return { provider: override.name, configured: true };
  if (config.aiProvider === "openai") return { provider: "openai", configured: !!config.openaiApiKey };
  if (config.aiProvider === "demo") return { provider: "demo", configured: true };
  return { provider: "none", configured: false };
}

export function getExtractor(): AiExtractor {
  if (override) return override;
  if (cached) return cached;
  if (config.aiProvider === "demo") return (cached = new DemoExtractor());
  if (config.aiProvider === "openai" && config.openaiApiKey) return (cached = new OpenAiExtractor());
  throw Errors.aiNotConfigured();
}
