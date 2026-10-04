/**
 * Strict schema for AI output. Used BOTH to constrain the model (OpenAI structured outputs) and to re-validate
 * whatever comes back. Every field is required (nullable where "unknown" is legitimate) so the model cannot silently
 * omit citations. Nothing the model returns is trusted until it passes this schema AND the citation check.
 */
import { z } from "zod";

export const confidenceSchema = z.enum(["confirmed", "uncertain"]);

export const sourceSchema = z.object({
  sectionNumber: z.string().describe('Section number exactly as printed, e.g. "4.2". Empty string if none.'),
  sectionTitle: z.string().describe("Section heading as printed. Empty string if none."),
  exactText: z.string().describe("A verbatim, contiguous quote copied from the document that supports the item."),
});

const unitNullable = z.string().nullable().describe('One of "days","weeks","months","years", "business days" — or null');

export const partySchema = z.object({
  name: z.string(),
  role: z.string().describe('Role as defined in the contract, e.g. "Customer", "Supplier". Empty string if not stated.'),
  confidence: confidenceSchema,
  source: sourceSchema,
});

export const effectiveDateSchema = z.object({
  value: z.string().nullable().describe("YYYY-MM-DD only if the contract states an explicit calendar date; otherwise null."),
  displayValue: z.string().describe("The date wording as it appears in the contract."),
  confidence: confidenceSchema,
  reason: z.string().describe("Why this confidence level was chosen."),
  source: sourceSchema,
});

export const expirySchema = z.object({
  value: z.string().nullable().describe("YYYY-MM-DD only if an explicit expiry/end date is stated; otherwise null."),
  displayValue: z.string(),
  termValue: z.number().int().nullable().describe("Length of the initial term as stated, e.g. 2. Null if not stated."),
  termUnit: unitNullable,
  description: z.string(),
  confidence: confidenceSchema,
  reason: z.string(),
  source: sourceSchema,
});

export const renewalSchema = z.object({
  type: z.enum(["automatic", "manual", "none", "uncertain"]),
  term: z.string().describe("Renewal term wording, e.g. 'successive one (1) year terms'. Empty string if none."),
  termValue: z.number().int().nullable(),
  termUnit: unitNullable,
  description: z.string(),
  confidence: confidenceSchema,
  reason: z.string(),
  source: sourceSchema,
});

export const terminationSchema = z.object({
  description: z.string(),
  responsibleParty: z.string().describe("Party that holds the right/duty, or 'Either party', or 'Unclear'."),
  noticePeriodValue: z.number().int().nullable(),
  noticePeriodUnit: unitNullable,
  confidence: confidenceSchema,
  source: sourceSchema,
});

export const noticeClauseSchema = z.object({
  type: z.enum(["renewal", "termination", "other"]),
  noticePeriodValue: z.number().int().nullable().describe("Number as stated; null if no number is stated."),
  noticePeriodUnit: unitNullable,
  dayType: z.enum(["calendar", "business", "unspecified"]).describe("Whether the contract says calendar or business days, or neither."),
  responsibleParty: z.string(),
  description: z.string(),
  confidence: confidenceSchema,
  source: sourceSchema,
});

export const obligationSchema = z.object({
  description: z.string(),
  responsibleParty: z.string(),
  deadline: z.string().describe("Deadline wording as stated in the contract. Empty string if none."),
  frequency: z.string().describe("Frequency wording as stated, e.g. 'monthly'. Empty string if none."),
  dueDate: z.string().nullable().describe("YYYY-MM-DD ONLY if the contract states an explicit calendar date. Never compute one."),
  relative: z
    .object({
      value: z.number().int().nullable(),
      unit: unitNullable,
      anchor: z.enum(["effectiveDate", "expiry", "none"]),
      direction: z.enum(["before", "after"]),
    })
    .nullable()
    .describe("Only when the contract ties the deadline to the Effective Date or expiry (e.g. 'within 10 days after the Effective Date')."),
  recurrence: z
    .object({
      type: z.enum(["none", "weekly", "monthly", "quarterly", "annual", "other"]),
      dayOfMonth: z.number().int().nullable(),
      month: z.number().int().nullable(),
    })
    .nullable()
    .describe("Only when the contract states a recurring schedule."),
  confidence: confidenceSchema,
  source: sourceSchema,
});

export const ambiguitySchema = z.object({
  description: z.string(),
  whyAmbiguous: z.string(),
  relatedItems: z.array(z.string()).describe("Short labels of related extracted items, e.g. 'Termination clause 5.3'."),
  clarificationQuestion: z.string().describe("A neutral question for the reviewer. Must not answer the question or give legal advice."),
  source: sourceSchema,
});

export const conflictSchema = z.object({
  description: z.string(),
  sections: z.array(z.string()),
  sourceReferences: z.array(sourceSchema).describe("One citation for each conflicting passage (at least two)."),
});

export const extractionSchema = z.object({
  parties: z.array(partySchema),
  effectiveDate: effectiveDateSchema.nullable(),
  expiry: expirySchema.nullable(),
  renewal: renewalSchema.nullable(),
  termination: z.array(terminationSchema),
  noticeClauses: z.array(noticeClauseSchema),
  obligations: z.array(obligationSchema),
  ambiguities: z.array(ambiguitySchema),
  conflicts: z.array(conflictSchema),
});
export type Extraction = z.infer<typeof extractionSchema>;

export const policyNoteSchema = z.object({
  description: z.string(),
  relatesTo: z.enum(["renewal_notice", "expiry", "termination", "obligation", "other"]),
  contractRequirement: z.string().describe("What the CONTRACT says, paraphrased briefly."),
  internalPolicyStatement: z.string().describe("What the INTERNAL POLICY says, paraphrased briefly."),
  policyLeadValue: z.number().int().nullable().describe("If the policy states a lead time before expiry (e.g. 90), the number; else null."),
  policyLeadUnit: unitNullable,
  clarificationQuestion: z.string(),
  confidence: confidenceSchema,
  contractSource: sourceSchema.describe("Verbatim quote from the CONTRACT."),
  policySource: sourceSchema.describe("Verbatim quote from the POLICY document."),
});

export const policyAnalysisSchema = z.object({ policyNotes: z.array(policyNoteSchema) });
export type PolicyAnalysis = z.infer<typeof policyAnalysisSchema>;
