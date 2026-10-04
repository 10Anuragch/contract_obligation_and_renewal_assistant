import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runExtraction } from "../src/services/extraction.js";
import { extractionSchema } from "../src/ai/schema.js";
import { DemoExtractor } from "../src/ai/demoExtractor.js";
import { normalizeText } from "../src/services/documentParser.js";
import { splitSections } from "../src/services/sections.js";
import type { AiExtractor } from "../src/ai/types.js";

const TEXT = normalizeText(fs.readFileSync(path.resolve(__dirname, "../../fixtures/sample-vendor-agreement.txt"), "utf8"));
const POLICY = normalizeText(fs.readFileSync(path.resolve(__dirname, "../../fixtures/sample-organization-policy.txt"), "utf8"));
const contract = { text: TEXT, sections: splitSections(TEXT) };
const policy = { text: POLICY, sections: splitSections(POLICY) };

const src = (exactText: string) => ({ sectionNumber: "2.2", sectionTitle: "Automatic Renewal", exactText });
const empty = { parties: [], effectiveDate: null, expiry: null, renewal: null, termination: [], noticeClauses: [], obligations: [], ambiguities: [], conflicts: [] };

function fake(responses: unknown[]): AiExtractor & { calls: number; hints: (string | undefined)[] } {
  const f: any = {
    name: "fake",
    calls: 0,
    hints: [],
    async extractContract(_t: string, hint?: string) {
      f.hints.push(hint);
      return responses[Math.min(f.calls++, responses.length - 1)];
    },
    async analyzePolicy() {
      return { policyNotes: [] };
    },
  };
  return f;
}

describe("structured AI response validation", () => {
  it("schema rejects missing citations", () => {
    const bad = { ...empty, parties: [{ name: "A", role: "B", confidence: "confirmed" }] };
    expect(extractionSchema.safeParse(bad).success).toBe(false);
  });
  it("retries once with a hint, then fails with a malformed-response error", async () => {
    const f = fake([{ nonsense: true }, { still: "bad" }]);
    await expect(runExtraction(f, contract, null)).rejects.toMatchObject({ code: "AI_MALFORMED_RESPONSE" });
    expect(f.calls).toBe(2);
    expect(f.hints[1]).toBeTruthy();
  });
  it("recovers when the retry is valid", async () => {
    const f = fake([{ bad: 1 }, empty]);
    const out = await runExtraction(f, contract, null);
    expect(out.drafts).toHaveLength(0);
    expect(f.calls).toBe(2);
  });
});

describe("citation enforcement on extracted items", () => {
  it("never leaves an item 'confirmed' when its quote is not in the document", async () => {
    const good = "at least sixty (60) days before the end of the then-current term";
    const f = fake([
      {
        ...empty,
        noticeClauses: [
          { type: "renewal", noticePeriodValue: 60, noticePeriodUnit: "days", dayType: "calendar", responsibleParty: "Either party", description: "ok", confidence: "confirmed", source: src(good) },
          { type: "renewal", noticePeriodValue: 90, noticePeriodUnit: "days", dayType: "calendar", responsibleParty: "Either party", description: "invented", confidence: "confirmed", source: src("ninety days of invented text") },
        ],
      },
    ]);
    const { drafts } = await runExtraction(f, contract, null);
    expect(drafts[0]).toMatchObject({ confidence: "confirmed" });
    expect(drafts[0].source.verified).toBe(true);
    expect(drafts[1].confidence).toBe("uncertain");
    expect(drafts[1].source.verified).toBe(false);
  });
  it("discards AI-supplied invalid dates and marks the item uncertain", async () => {
    const f = fake([
      { ...empty, effectiveDate: { value: "2026-13-45", displayValue: "January 15, 2026", confidence: "confirmed", reason: "x", source: src("January 15, 2026") } },
    ]);
    const { drafts } = await runExtraction(f, contract, null);
    expect(drafts[0].data.value).toBeNull();
    expect(drafts[0].confidence).toBe("uncertain");
  });
  it("derived expiry (term only) is uncertain, not a fact", async () => {
    const { drafts } = await runExtraction(new DemoExtractor(), contract, null);
    const expiry = drafts.find((d) => d.category === "expiry")!;
    expect(expiry.data.value).toBeNull();
    expect(expiry.confidence).toBe("uncertain");
  });
});

describe("obligation extraction data handling (demo extractor on sample contract)", () => {
  it("extracts the key items, all with verified citations", async () => {
    const { drafts } = await runExtraction(new DemoExtractor(), contract, policy);
    const cats = (c: string) => drafts.filter((d) => d.category === c);
    expect(cats("party").map((d) => d.data.role).sort()).toEqual(["Customer", "Supplier"]);
    expect(cats("effectiveDate")[0].data.value).toBe("2026-01-15");
    expect(cats("renewal")[0].data.type).toBe("automatic");
    expect(cats("notice").find((d) => d.data.type === "renewal")!.data.noticePeriodValue).toBe(60);
    const report = cats("obligation").find((d) => /service-usage report/i.test(d.data.description))!;
    expect(report.data.responsibleParty).toBe("Supplier");
    expect(report.data.recurrence).toMatchObject({ type: "monthly", dayOfMonth: 5 });
    expect(cats("ambiguity").length).toBeGreaterThanOrEqual(2);
    expect(cats("ambiguity").every((d) => !!d.data.clarificationQuestion)).toBe(true);
    expect(cats("policyNote")).toHaveLength(1);
    expect(drafts.every((d) => d.source.verified && d.source.exactText.length > 0)).toBe(true);
  });
});
