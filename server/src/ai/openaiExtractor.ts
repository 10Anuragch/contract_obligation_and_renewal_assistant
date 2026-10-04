import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { config } from "../config.js";
import { Errors } from "../utils/errors.js";
import type { AiExtractor } from "./types.js";
import { extractionSchema, policyAnalysisSchema } from "./schema.js";
import {
  EXTRACTION_SYSTEM_PROMPT,
  POLICY_SYSTEM_PROMPT,
  buildExtractionUserPrompt,
  buildPolicyUserPrompt,
} from "./prompts.js";

export class OpenAiExtractor implements AiExtractor {
  readonly name = "openai";
  private client: OpenAI;

  constructor(apiKey = config.openaiApiKey, private model = config.openaiModel) {
    this.client = new OpenAI({ apiKey, timeout: 180_000, maxRetries: 2 });
  }

  private async run(system: string, user: string, format: ReturnType<typeof zodResponseFormat>, retryHint?: string): Promise<unknown> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];
    if (retryHint) {
      messages.push({
        role: "user",
        content: `Your previous answer failed validation: ${retryHint}\nReturn a corrected JSON object. Every source.exactText must be copied verbatim from the document.`,
      });
    }
    let content: string | null | undefined;
    try {
      const res = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0, // reliable, repeatable extraction
        messages,
        response_format: format,
      });
      const msg = res.choices[0]?.message;
      if (msg?.refusal) throw Errors.aiMalformed();
      content = msg?.content;
    } catch (err) {
      if (err instanceof Error && err.name === "AppError") throw err;
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) throw Errors.aiUnavailable("The AI service rejected the configured credentials. Check OPENAI_API_KEY.");
      if (status === 429) throw Errors.aiUnavailable("The AI service is rate-limited or out of quota. Please try again later.");
      throw Errors.aiUnavailable();
    }
    if (!content) throw Errors.aiMalformed();
    try {
      return JSON.parse(content);
    } catch {
      throw Errors.aiMalformed();
    }
  }

  extractContract(documentText: string, retryHint?: string) {
    return this.run(
      EXTRACTION_SYSTEM_PROMPT,
      buildExtractionUserPrompt(documentText),
      zodResponseFormat(extractionSchema, "contract_extraction"),
      retryHint,
    );
  }

  analyzePolicy(contractText: string, policyText: string, retryHint?: string) {
    return this.run(
      POLICY_SYSTEM_PROMPT,
      buildPolicyUserPrompt(contractText, policyText),
      zodResponseFormat(policyAnalysisSchema, "policy_analysis"),
      retryHint,
    );
  }
}
