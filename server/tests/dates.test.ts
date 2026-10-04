import { describe, expect, it } from "vitest";
import {
  addDuration,
  computeExpiryFromTerm,
  computeNoticeDeadline,
  computeObligationDue,
  computeReminderDate,
  getTimeStatus,
  nextRecurringDate,
  parseISODate,
  subtractDuration,
} from "../src/services/dates.js";

describe("notice deadline (deterministic)", () => {
  it("expiry 2027-12-31 minus 60 days = 2027-11-01", () => {
    const r = computeNoticeDeadline("2027-12-31", 60, "days");
    expect(r).toMatchObject({ ok: true, date: "2027-11-01" });
  });
  it("supports weeks and months", () => {
    expect(computeNoticeDeadline("2027-12-31", 2, "weeks")).toMatchObject({ ok: true, date: "2027-12-17" });
    expect(computeNoticeDeadline("2027-12-31", 3, "months")).toMatchObject({ ok: true, date: "2027-09-30" });
  });
  it("crosses leap years correctly", () => {
    expect(computeNoticeDeadline("2028-03-01", 1, "days")).toMatchObject({ date: "2028-02-29" });
    expect(computeNoticeDeadline("2027-03-01", 1, "days")).toMatchObject({ date: "2027-02-28" });
  });
  it("refuses when inputs are missing, invalid or ambiguous", () => {
    expect(computeNoticeDeadline(null, 60, "days").ok).toBe(false);
    expect(computeNoticeDeadline("2027-02-30", 60, "days").ok).toBe(false);
    expect(computeNoticeDeadline("2027-12-31", null, "days").ok).toBe(false);
    expect(computeNoticeDeadline("2027-12-31", 5, "business days").ok).toBe(false);
    expect(computeNoticeDeadline("2027-12-31", 5, null).ok).toBe(false);
  });
});

describe("date helpers", () => {
  it("parses strictly", () => {
    expect(parseISODate("2026-02-29")).toBeNull();
    expect(parseISODate("2026-2-9")).toBeNull();
    expect(parseISODate("2026-01-15")).not.toBeNull();
  });
  it("add/subtract are timezone-stable", () => {
    expect(addDuration("2026-03-28", 1, "days")).toBe("2026-03-29");
    expect(addDuration("2026-10-24", 2, "days")).toBe("2026-10-26"); // DST change weekends
    expect(subtractDuration("2026-03-31", 1, "months")).toBe("2026-02-28");
  });
  it("expiry from a 2-year term ends the day before the anniversary", () => {
    expect(computeExpiryFromTerm("2026-01-15", 2, "years")).toMatchObject({ ok: true, date: "2028-01-14" });
    expect(computeExpiryFromTerm(null, 2, "years").ok).toBe(false);
  });
  it("reminder = due minus lead days", () => {
    expect(computeReminderDate("2027-11-01", 14)).toBe("2027-10-18");
    expect(computeReminderDate(null, 14)).toBeNull();
  });
});

describe("time status", () => {
  it("overdue / due soon / upcoming relative to an injected today", () => {
    expect(getTimeStatus("2026-09-30", "2026-10-03", 30)).toBe("overdue");
    expect(getTimeStatus("2026-10-03", "2026-10-03", 30)).toBe("due_soon");
    expect(getTimeStatus("2026-11-02", "2026-10-03", 30)).toBe("due_soon");
    expect(getTimeStatus("2026-11-03", "2026-10-03", 30)).toBe("upcoming");
    expect(getTimeStatus(null, "2026-10-03")).toBeNull();
  });
});

describe("obligation due dates", () => {
  const ctx = { effectiveDate: "2026-01-15", expiry: "2028-01-14" };
  it("explicit date wins", () => {
    expect(computeObligationDue({ dueDate: "2026-12-01" }, ctx, "2026-10-03")).toMatchObject({ ok: true, date: "2026-12-01", basis: "explicit" });
  });
  it("relative to effective date", () => {
    const r = computeObligationDue({ relative: { value: 10, unit: "days", anchor: "effectiveDate", direction: "after" } }, ctx, "2026-10-03");
    expect(r).toMatchObject({ ok: true, date: "2026-01-25", basis: "relative" });
  });
  it("relative without anchor date is not calculable", () => {
    const r = computeObligationDue({ relative: { value: 10, unit: "days", anchor: "effectiveDate", direction: "after" } }, { effectiveDate: null }, "2026-10-03");
    expect(r.ok).toBe(false);
  });
  it("monthly recurrence picks the next occurrence, clamping short months", () => {
    expect(nextRecurringDate("monthly", 5, null, "2026-10-03")).toBe("2026-10-05");
    expect(nextRecurringDate("monthly", 5, null, "2026-10-06")).toBe("2026-11-05");
    expect(nextRecurringDate("monthly", 31, null, "2027-02-10")).toBe("2027-02-28");
  });
  it("vague deadlines are not calculable", () => {
    const r = computeObligationDue({ recurrence: { type: "none", dayOfMonth: null, month: null } }, ctx, "2026-10-03");
    expect(r).toMatchObject({ ok: false });
  });
});
