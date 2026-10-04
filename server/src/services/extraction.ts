import type { ZodType } from "zod";
import type { AiExtractor } from "../ai/types.js";
import { extractionSchema, policyAnalysisSchema, type Extraction, type PolicyAnalysis } from "../ai/schema.js";
import { AppError, Errors } from "../utils/errors.js";
import { mapExtractionToDrafts, type ItemDraft } from "./items.js";
import type { Section } from "./sections.js";

export interface ExtractionOutput {
  extraction: Extraction;
  policyResult: PolicyAnalysis | null;
  drafts: ItemDraft[];
}

/** Validate AI output against the strict schema; allow ONE corrective retry before failing. */
async function validated<T>(schema: ZodType<T>, call: (hint?: string) => Promise<unknown>): Promise<T> {
  let hint: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await call(hint);
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    hint = parsed.error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
  }
  throw Errors.aiMalformed();
}

export async function runExtraction(
  extractor: AiExtractor,
  contract: { text: string; sections: Section[] },
  policy: { text: string; sections: Section[] } | null,
): Promise<ExtractionOutput> {
  try {
    const extraction = await validated(extractionSchema, (hint) => extractor.extractContract(contract.text, hint));
    let policyResult: PolicyAnalysis | null = null;
    if (policy && policy.text.trim()) {
      policyResult = await validated(policyAnalysisSchema, (hint) => extractor.analyzePolicy(contract.text, policy.text, hint));
    }
    const drafts = mapExtractionToDrafts(extraction, contract, policyResult, policy);
    return { extraction, policyResult, drafts };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw Errors.aiUnavailable();
  }
}
