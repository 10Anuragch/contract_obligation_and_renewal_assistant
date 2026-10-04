import { z } from "zod";
import type { Extraction, PolicyAnalysis } from "../ai/schema.js";
import { validateSource, type RawSource, type ValidatedSource } from "./citation.js";
import type { Section } from "./sections.js";
import { isValidISODate, normalizeUnit } from "./dates.js";
import type { ItemCategory } from "../models/index.js";

// ------------------------------------------------------------------ per-category data schemas (used for edits)
const isoOrNull = z
  .string()
  .nullable()
  .refine((v) => v === null || v === "" || isValidISODate(v), { message: "Must be a valid date in YYYY-MM-DD format." })
  .transform((v) => (v === "" ? null : v));
const unit = z.string().nullable();
const posInt = z.number().int().nonnegative().nullable();
const str = (max = 2000) => z.string().max(max);

const relativeSchema = z
  .object({
    value: posInt,
    unit,
    anchor: z.enum(["effectiveDate", "expiry", "none"]),
    direction: z.enum(["before", "after"]),
  })
  .nullable();
const recurrenceSchema = z
  .object({
    type: z.enum(["none", "weekly", "monthly", "quarterly", "annual", "other"]),
    dayOfMonth: z.number().int().min(1).max(31).nullable(),
    month: z.number().int().min(1).max(12).nullable(),
  })
  .nullable();

export const dataSchemas: Record<ItemCategory, z.ZodType<Record<string, unknown>>> = {
  party: z.object({ name: str(300).min(1), role: str(100) }),
  effectiveDate: z.object({ value: isoOrNull, displayValue: str(200), reason: str() }),
  expiry: z.object({
    value: isoOrNull,
    displayValue: str(200),
    termValue: posInt,
    termUnit: unit,
    description: str(),
    reason: str(),
  }),
  renewal: z.object({
    type: z.enum(["automatic", "manual", "none", "uncertain"]),
    term: str(300),
    termValue: posInt,
    termUnit: unit,
    description: str(),
    reason: str(),
  }),
  termination: z.object({
    description: str().min(1),
    responsibleParty: str(200),
    noticePeriodValue: posInt,
    noticePeriodUnit: unit,
  }),
  notice: z.object({
    type: z.enum(["renewal", "termination", "other"]),
    noticePeriodValue: posInt,
    noticePeriodUnit: unit,
    dayType: z.enum(["calendar", "business", "unspecified"]),
    responsibleParty: str(200),
    description: str(),
  }),
  obligation: z.object({
    description: str().min(1),
    responsibleParty: str(200),
    deadline: str(500),
    frequency: str(200),
    dueDate: isoOrNull,
    relative: relativeSchema,
    recurrence: recurrenceSchema,
  }),
  ambiguity: z.object({
    description: str(),
    whyAmbiguous: str(),
    clarificationQuestion: str(),
    relatedItems: z.array(str(300)),
    answer: str(),
  }),
  conflict: z.object({ description: str(), sections: z.array(str(100)), answer: str() }),
  policyNote: z.object({
    description: str(),
    relatesTo: z.enum(["renewal_notice", "expiry", "termination", "obligation", "other"]),
    contractRequirement: str(),
    internalPolicyStatement: str(),
    policyLeadValue: posInt,
    policyLeadUnit: unit,
    clarificationQuestion: str(),
  }),
};

export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  party: "Party",
  effectiveDate: "Effective date",
  expiry: "Expiry",
  renewal: "Renewal",
  termination: "Termination",
  notice: "Notice clause",
  obligation: "Obligation",
  ambiguity: "Potential ambiguity",
  conflict: "Potential conflict",
  policyNote: "Policy context",
};

const clip = (s: unknown, n = 70) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

export function noticeText(d: Record<string, any>): string {
  if (d.noticePeriodValue === null || d.noticePeriodValue === undefined) return "no period stated";
  return `${d.noticePeriodValue} ${d.noticePeriodUnit ?? ""}`.trim();
}

/** Short human-readable label used in lists and the audit trail. */
export function itemLabel(category: ItemCategory, d: Record<string, any>): string {
  switch (category) {
    case "party":
      return `Party: ${clip(d.name)}${d.role ? ` (${clip(d.role, 30)})` : ""}`;
    case "effectiveDate":
      return `Effective date: ${d.value ?? clip(d.displayValue)}`;
    case "expiry":
      return `Expiry: ${d.value ?? clip(d.displayValue || d.description)}`;
    case "renewal":
      return `Renewal: ${d.type}${d.term ? ` — ${clip(d.term, 50)}` : ""}`;
    case "termination":
      return `Termination: ${clip(d.description, 60)}`;
    case "notice":
      return `Notice period (${d.type}): ${noticeText(d)}`;
    case "obligation":
      return `Obligation: ${clip(d.description, 60)}`;
    case "ambiguity":
      return `Ambiguity: ${clip(d.description, 60)}`;
    case "conflict":
      return `Conflict: ${clip(d.description, 60)}`;
    case "policyNote":
      return `Policy context: ${clip(d.description, 60)}`;
  }
}

// ------------------------------------------------------------------ comparison helpers (stale detection)
export const normText = (s: unknown): string =>
  String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Canonical, comparison-friendly projection of an item's *structured* values.
 * AI paraphrases of descriptions are deliberately excluded so harmless re-wording by the model does not
 * cause false "stale" flags; wording changes in the CONTRACT are caught through the source text comparison.
 */
export function comparableValue(category: ItemCategory, d: Record<string, any>): Record<string, unknown> {
  const u = (x: unknown) => normalizeUnit(x) ?? (x == null ? null : String(x).toLowerCase());
  switch (category) {
    case "party":
      return { name: normText(d.name), role: normText(d.role) };
    case "effectiveDate":
      return { value: d.value ?? normText(d.displayValue) };
    case "expiry":
      return { value: d.value ?? null, termValue: d.termValue ?? null, termUnit: u(d.termUnit), display: d.value ? null : normText(d.displayValue) };
    case "renewal":
      return { type: d.type, termValue: d.termValue ?? null, termUnit: u(d.termUnit), term: normText(d.term) };
    case "termination":
      return { responsibleParty: normText(d.responsibleParty), v: d.noticePeriodValue ?? null, u: u(d.noticePeriodUnit) };
    case "notice":
      return { type: d.type, v: d.noticePeriodValue ?? null, u: u(d.noticePeriodUnit), dayType: d.dayType };
    case "obligation":
      return {
        responsibleParty: normText(d.responsibleParty),
        deadline: normText(d.deadline),
        frequency: normText(d.frequency),
        dueDate: d.dueDate ?? null,
        relative: d.relative ?? null,
        recurrence: d.recurrence ?? null,
      };
    default:
      return {};
  }
}

/** Human-readable diff of the structured values, e.g. "notice period: 60 days → 90 days". */
export function describeChanges(category: ItemCategory, before: Record<string, any>, after: Record<string, any>): string[] {
  const out: string[] = [];
  const cmp = (name: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${name}: ${fmt(a)} → ${fmt(b)}`);
  };
  const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
  switch (category) {
    case "notice":
    case "termination":
      cmp("notice period", noticeText(before), noticeText(after));
      cmp("responsible party", before.responsibleParty, after.responsibleParty);
      if (category === "notice") cmp("day type", before.dayType, after.dayType);
      break;
    case "effectiveDate":
      cmp("date", before.value ?? before.displayValue, after.value ?? after.displayValue);
      break;
    case "expiry":
      cmp("expiry date", before.value ?? before.displayValue, after.value ?? after.displayValue);
      cmp("term", `${before.termValue ?? ""} ${before.termUnit ?? ""}`.trim(), `${after.termValue ?? ""} ${after.termUnit ?? ""}`.trim());
      break;
    case "renewal":
      cmp("renewal type", before.type, after.type);
      cmp("renewal term", before.term, after.term);
      break;
    case "party":
      cmp("name", before.name, after.name);
      cmp("role", before.role, after.role);
      break;
    case "obligation":
      cmp("responsible party", before.responsibleParty, after.responsibleParty);
      cmp("deadline", before.deadline, after.deadline);
      cmp("frequency", before.frequency, after.frequency);
      cmp("due date", before.dueDate, after.dueDate);
      cmp("relative deadline", before.relative, after.relative);
      cmp("recurrence", before.recurrence, after.recurrence);
      break;
    default:
      break;
  }
  return out;
}

// ------------------------------------------------------------------ AI result -> item drafts
export interface ItemDraft {
  category: ItemCategory;
  order: number;
  label: string;
  data: Record<string, any>;
  original: Record<string, any>;
  source: ValidatedSource & { document: "contract" | "policy" };
  extraSources: (ValidatedSource & { document: "contract" | "policy" })[];
  confidence: "confirmed" | "uncertain";
}

interface DocCtx {
  text: string;
  sections: Section[];
}

export function mapExtractionToDrafts(
  extraction: Extraction,
  contract: DocCtx,
  policyResult: PolicyAnalysis | null,
  policy: DocCtx | null,
): ItemDraft[] {
  const drafts: ItemDraft[] = [];
  let order = 0;

  const cite = (raw: RawSource, doc: DocCtx = contract, kind: "contract" | "policy" = "contract") => ({
    ...validateSource(raw, doc.text, doc.sections),
    document: kind,
  });

  const add = (
    category: ItemCategory,
    data: Record<string, any>,
    raw: RawSource,
    confidence: "confirmed" | "uncertain",
    extras: ItemDraft["extraSources"] = [],
    source?: ItemDraft["source"],
  ) => {
    const src = source ?? cite(raw);
    // Citation rule: no verifiable citation => can never be "confirmed".
    const finalConfidence = src.verified && extras.every((e) => e.verified) ? confidence : "uncertain";
    drafts.push({
      category,
      order: order++,
      label: itemLabel(category, data),
      data,
      original: JSON.parse(JSON.stringify(data)),
      source: src,
      extraSources: extras,
      confidence: finalConfidence,
    });
  };

  for (const p of extraction.parties) add("party", { name: p.name, role: p.role }, p.source, p.confidence);

  if (extraction.effectiveDate) {
    const e = extraction.effectiveDate;
    let value = e.value && isValidISODate(e.value) ? e.value : null;
    let conf = e.confidence;
    let reason = e.reason;
    if (e.value && !value) {
      conf = "uncertain";
      reason = `${reason} (The AI returned a value that is not a valid calendar date; it was discarded.)`.trim();
    }
    if (!value) conf = "uncertain";
    add("effectiveDate", { value, displayValue: e.displayValue, reason }, e.source, conf);
  }

  if (extraction.expiry) {
    const x = extraction.expiry;
    let value = x.value && isValidISODate(x.value) ? x.value : null;
    let conf = x.confidence;
    let reason = x.reason;
    if (x.value && !value) {
      conf = "uncertain";
      reason = `${reason} (The AI returned a value that is not a valid calendar date; it was discarded.)`.trim();
    }
    if (!value) conf = "uncertain"; // derived from term or unknown => never presented as a confirmed fact
    add(
      "expiry",
      { value, displayValue: x.displayValue, termValue: x.termValue, termUnit: x.termUnit, description: x.description, reason },
      x.source,
      conf,
    );
  }

  if (extraction.renewal) {
    const r = extraction.renewal;
    add(
      "renewal",
      { type: r.type, term: r.term, termValue: r.termValue, termUnit: r.termUnit, description: r.description, reason: r.reason },
      r.source,
      r.type === "uncertain" ? "uncertain" : r.confidence,
    );
  }

  for (const t of extraction.termination)
    add(
      "termination",
      { description: t.description, responsibleParty: t.responsibleParty, noticePeriodValue: t.noticePeriodValue, noticePeriodUnit: t.noticePeriodUnit },
      t.source,
      t.confidence,
    );

  for (const n of extraction.noticeClauses) {
    const needsInterp = n.dayType === "business" || n.noticePeriodValue === null || !normalizeUnit(n.noticePeriodUnit);
    add(
      "notice",
      {
        type: n.type,
        noticePeriodValue: n.noticePeriodValue,
        noticePeriodUnit: n.noticePeriodUnit,
        dayType: n.dayType,
        responsibleParty: n.responsibleParty,
        description: n.description,
      },
      n.source,
      needsInterp ? "uncertain" : n.confidence,
    );
  }

  for (const o of extraction.obligations) {
    const dueDate = o.dueDate && isValidISODate(o.dueDate) ? o.dueDate : null;
    add(
      "obligation",
      {
        description: o.description,
        responsibleParty: o.responsibleParty,
        deadline: o.deadline,
        frequency: o.frequency,
        dueDate,
        relative: o.relative,
        recurrence: o.recurrence,
      },
      o.source,
      o.confidence,
    );
  }

  for (const a of extraction.ambiguities)
    add(
      "ambiguity",
      {
        description: a.description,
        whyAmbiguous: a.whyAmbiguous,
        clarificationQuestion: a.clarificationQuestion,
        relatedItems: a.relatedItems,
        answer: "",
      },
      a.source,
      "uncertain",
    );

  for (const c of extraction.conflicts) {
    const refs = c.sourceReferences.map((r) => cite(r));
    const first = refs[0] ?? cite({ exactText: "" });
    add("conflict", { description: c.description, sections: c.sections, answer: "" }, first, "uncertain", refs.slice(1), first);
  }

  if (policyResult && policy) {
    for (const n of policyResult.policyNotes) {
      const cs = cite(n.contractSource);
      const ps = cite(n.policySource, policy, "policy");
      add(
        "policyNote",
        {
          description: n.description,
          relatesTo: n.relatesTo,
          contractRequirement: n.contractRequirement,
          internalPolicyStatement: n.internalPolicyStatement,
          policyLeadValue: n.policyLeadValue,
          policyLeadUnit: n.policyLeadUnit,
          clarificationQuestion: n.clarificationQuestion,
        },
        n.contractSource,
        n.confidence,
        [ps],
        cs,
      );
    }
  }

  return drafts;
}
