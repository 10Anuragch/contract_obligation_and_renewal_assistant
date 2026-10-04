import { describe, expect, it } from "vitest";
import * as review from "../src/services/review.js";
import { mergeVersions, type ComparableItem } from "../src/services/stale.js";
import { buildSummary } from "../src/services/summary.js";
import { computeAllRows, displayStatus } from "../src/services/deadlines.js";

const cfg = { dueSoonDays: 30, obligationReminderLeadDays: 7, noticeReminderLeadDays: 14 };
const ref = { contractId: "c1", contractName: "Vendor Agreement", versionId: "v1", versionNumber: 1 };

const notice = (n: number, text?: string, status: any = "approved", id = "n1"): ComparableItem => {
  const data = { type: "renewal", noticePeriodValue: n, noticePeriodUnit: "days", dayType: "calendar", responsibleParty: "Either party", description: "" };
  return {
    id, category: "notice", data, original: { ...data }, userCorrection: null, reviewStatus: status,
    source: { sectionNumber: "2.2", sectionTitle: "Renewal", exactText: text ?? `written notice at least ${n} days before the end of the term` },
    label: `Notice period (renewal): ${n} days`,
  };
};
const item = (id: string, category: any, data: any, status: any = "pending", source: any = {}): any => ({
  id, category, data, original: { ...data }, userCorrection: null, reviewStatus: status, confidence: "confirmed",
  source: { sectionNumber: "1", sectionTitle: "", exactText: "x", verified: true, ...source },
});

describe("review actions", () => {
  const base: any = { category: "notice", data: notice(60).data, original: notice(60).data, userCorrection: null, reviewStatus: "pending" };
  it("approve changes status once; duplicate approve is a no-op", () => {
    const t1 = review.approve(base, "me");
    expect(t1).toMatchObject({ changed: true, action: "item_approved", update: { reviewStatus: "approved" } });
    const t2 = review.approve({ ...base, reviewStatus: "approved" }, "me");
    expect(t2).toMatchObject({ changed: false, action: null });
  });
  it("reject records the note; duplicate reject is a no-op", () => {
    expect(review.reject(base, "me", "wrong clause").update).toMatchObject({ reviewStatus: "rejected", reviewNote: "wrong clause" });
    expect(review.reject({ ...base, reviewStatus: "rejected" }, "me").changed).toBe(false);
  });
  it("edit validates, stores the correction, keeps the original and reports old/new values", () => {
    const t = review.edit(base, { noticePeriodValue: 90 }, "me");
    expect(t.changed).toBe(true);
    expect(t.update).toMatchObject({ reviewStatus: "edited", data: { noticePeriodValue: 90 }, userCorrection: { noticePeriodValue: 90 } });
    expect(t.update).not.toHaveProperty("original");
    expect(t.previousValue).toMatchObject({ noticePeriodValue: 60 });
    expect(t.message).toMatch(/60 days.*90 days/);
  });
  it("edit rejects invalid values and ignores no-op edits", () => {
    expect(() => review.edit(base, { noticePeriodValue: -3 }, "me")).toThrowError(/not valid/);
    const od: any = { category: "obligation", data: { description: "d", responsibleParty: "", deadline: "", frequency: "", dueDate: null, relative: null, recurrence: null }, original: {}, userCorrection: null, reviewStatus: "pending" };
    expect(() => review.edit(od, { dueDate: "2026-02-31" }, "me")).toThrowError(/valid date/);
    expect(review.edit(base, { noticePeriodValue: 60 }, "me").changed).toBe(false);
  });
});

describe("stale detection across versions", () => {
  it("approved 60-day notice becomes stale when v2 says 90 days", () => {
    const r = mergeVersions([notice(60)], [notice(90, undefined, "pending", "n2")], 1);
    const p = r.patches.get(0)!;
    expect(p.kind).toBe("stale");
    if (p.kind === "stale") {
      expect(p.stale.previousApprovedValue).toMatchObject({ noticePeriodValue: 60 });
      expect(p.stale.newValue).toMatchObject({ noticePeriodValue: 90 });
      expect(p.stale.changes.join()).toMatch(/60 days → 90 days/);
      expect(p.stale.reason).toMatch(/changed/);
    }
    expect(r.stats.stale).toBe(1);
  });
  it("unchanged approved items carry their decision forward", () => {
    const r = mergeVersions([notice(60)], [notice(60, undefined, "pending", "n2")], 1);
    expect(r.patches.get(0)).toMatchObject({ kind: "carried", reviewStatus: "approved" });
  });
  it("changed wording with the same value is still flagged (source text changed)", () => {
    const r = mergeVersions([notice(60)], [notice(60, "written notice at least 60 days prior to the end of the then-current term", "pending", "n2")], 1);
    expect(r.patches.get(0)).toMatchObject({ kind: "stale" });
  });
  it("approved items whose source disappeared are re-created as stale", () => {
    const r = mergeVersions([notice(60)], [], 1);
    expect(r.disappeared).toHaveLength(1);
    expect(r.disappeared[0].stale).toMatchObject({ disappeared: true, newValue: null });
  });
  it("pending items are not touched; rejected items that change return to pending", () => {
    const pending = mergeVersions([notice(60, undefined, "pending")], [notice(90, undefined, "pending", "n2")], 1);
    expect(pending.patches.size).toBe(0);
    const rejected = mergeVersions([notice(60, undefined, "rejected")], [notice(90, undefined, "pending", "n2")], 1);
    expect(rejected.patches.size).toBe(0);
  });
  it("matches by content, not position", () => {
    const other = { ...notice(30, "Either party may cure within 30 days", "approved", "x1"), data: { ...notice(30).data, type: "termination" }, original: { ...notice(30).data, type: "termination" }, source: { sectionNumber: "5.1", sectionTitle: "", exactText: "Either party may cure within 30 days" } };
    const newOther = { ...other, id: "y1", reviewStatus: "pending" as const };
    const r = mergeVersions([notice(60), other], [newOther, notice(60, undefined, "pending", "n2")], 1);
    expect(r.patches.get(0)).toMatchObject({ kind: "carried" });
    expect(r.patches.get(1)).toMatchObject({ kind: "carried" });
  });
});

describe("deadline rows + reviewed summary", () => {
  const items: any[] = [
    item("e", "effectiveDate", { value: "2026-01-15", displayValue: "January 15, 2026", reason: "" }, "approved"),
    item("x", "expiry", { value: "2027-12-31", displayValue: "", termValue: null, termUnit: null, description: "", reason: "" }, "approved", { sectionNumber: "2.1" }),
    item("r", "renewal", { type: "automatic", term: "1 year", termValue: 1, termUnit: "years", description: "", reason: "" }, "approved"),
    item("n", "notice", { type: "renewal", noticePeriodValue: 60, noticePeriodUnit: "days", dayType: "calendar", responsibleParty: "Either party", description: "" }, "edited"),
    item("o", "obligation", { description: "Submit monthly usage report", responsibleParty: "Customer", deadline: "5th of every month", frequency: "monthly", dueDate: null, relative: null, recurrence: { type: "monthly", dayOfMonth: 5, month: null } }, "approved", { sectionNumber: "5.2" }),
    { ...item("o2", "obligation", { description: "Vague duty", responsibleParty: "Supplier", deadline: "promptly", frequency: "", dueDate: null, relative: null, recurrence: null }, "pending"), confidence: "uncertain" },
    item("o3", "obligation", { description: "Rejected duty", responsibleParty: "Supplier", deadline: "", frequency: "", dueDate: "2026-11-01", relative: null, recurrence: null }, "rejected"),
    item("a", "ambiguity", { description: "reasonable notice", whyAmbiguous: "no period", clarificationQuestion: "What notice period should be recorded?", relatedItems: [], answer: "" }, "pending"),
  ];
  const today = "2026-10-03";
  const { rows, card } = computeAllRows(items, ref, today, cfg);

  it("computes the notice deadline in code: 2027-12-31 − 60 days = 2027-11-01", () => {
    expect(card?.noticeDeadline).toBe("2027-11-01");
    expect(card?.timeStatus).toBe("upcoming");
    expect(card?.reminderDate).toBe("2027-10-18");
  });
  it("monthly obligation lands on the next 5th; vague one says it cannot be calculated", () => {
    const o = rows.find((r) => r.itemId === "o")!;
    expect(o).toMatchObject({ dueDate: "2026-10-05", reminderDate: "2026-09-28", timeStatus: "due_soon" });
    const v = rows.find((r) => r.itemId === "o2")!;
    expect(v.dueDate).toBeNull();
    expect(v.cannotCalculateReason).toMatch(/Reminder date cannot be calculated until this item is clarified/);
    expect(displayStatus(v)).toBe("Needs Review");
  });
  it("overdue is determined by comparing with today", () => {
    const late = computeAllRows(items, ref, "2027-11-15", cfg);
    expect(displayStatus(late.rows.find((r) => r.kind === "notice")!)).toBe("Overdue");
  });
  it("rejected items are labelled Rejected", () => {
    expect(displayStatus(rows.find((r) => r.itemId === "o3")!)).toBe("Rejected");
  });

  const summary = buildSummary({ contractName: "Vendor Agreement", filename: "v.pdf", versionNumber: 2, uploadedAt: new Date("2026-10-03"), items, rows, card, statusOf: displayStatus });
  it("states its basis, counts and disclaimer", () => {
    expect(summary.basedOn).toMatch(/Contract Version 2/);
    expect(summary.reviewStatusLine).toBe("4 approved, 1 edited, 1 rejected, 1 requiring clarification (2 pending review, 0 potentially stale)");
    expect(summary.disclaimer).toMatch(/does not provide legal advice/);
  });
  it("separates reviewed, rejected, uncertain and ambiguous items", () => {
    expect(summary.obligations).toHaveLength(1);
    expect(summary.rejected.map((e) => e.itemId)).toEqual(["o3"]);
    expect(summary.uncertain.map((e) => e.itemId)).toContain("o2");
    expect(summary.ambiguities[0].question).toMatch(/notice period/);
    expect(summary.notices[0].edited).toBe(true);
  });
});
