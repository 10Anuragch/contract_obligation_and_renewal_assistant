/**
 * Deterministic date logic. NOTHING in this file calls an AI.
 *
 * All dates are handled as calendar dates ("YYYY-MM-DD") to avoid time-zone drift.
 * Internally we use UTC midnight Date objects so arithmetic is stable regardless of the server's TZ.
 */
import { addDays, addMonths, addWeeks, addYears, subDays, subMonths, subWeeks, subYears } from "date-fns";

export type DurationUnit = "days" | "weeks" | "months" | "years";
export const SUPPORTED_UNITS: DurationUnit[] = ["days", "weeks", "months", "years"];

export type CalcResult = { ok: true; date: string; explanation: string } | { ok: false; reason: string };

export const CANNOT_CALCULATE = "Reminder date cannot be calculated until this item is clarified.";

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Strict ISO calendar-date parse. Returns null for anything that is not a real date. */
export function parseISODate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = ISO_RE.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

export function isValidISODate(value: unknown): value is string {
  return parseISODate(value) !== null;
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Today's calendar date in UTC. Injectable everywhere for testing. */
export function todayISO(now: Date = new Date()): string {
  return toISODate(now);
}

/**
 * date-fns operates in local time. We run it on a Date built from UTC components at *local* midnight of the
 * same Y/M/D, then convert back, so results never shift across DST boundaries.
 */
function toLocal(d: Date): Date {
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
function fromLocal(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

export function normalizeUnit(unit: unknown): DurationUnit | null {
  if (typeof unit !== "string") return null;
  const u = unit.trim().toLowerCase();
  if (["day", "days", "calendar day", "calendar days"].includes(u)) return "days";
  if (["week", "weeks"].includes(u)) return "weeks";
  if (["month", "months"].includes(u)) return "months";
  if (["year", "years"].includes(u)) return "years";
  return null; // e.g. "business days" — deliberately unsupported (ambiguous: depends on holiday calendar)
}

export function addDuration(iso: string, value: number, unit: DurationUnit): string | null {
  const base = parseISODate(iso);
  if (!base || !Number.isInteger(value) || value < 0) return null;
  const l = toLocal(base);
  const fn = { days: addDays, weeks: addWeeks, months: addMonths, years: addYears }[unit];
  return toISODate(fromLocal(fn(l, value)));
}

export function subtractDuration(iso: string, value: number, unit: DurationUnit): string | null {
  const base = parseISODate(iso);
  if (!base || !Number.isInteger(value) || value < 0) return null;
  const l = toLocal(base);
  const fn = { days: subDays, weeks: subWeeks, months: subMonths, years: subYears }[unit];
  return toISODate(fromLocal(fn(l, value)));
}

export function diffInDays(fromISO: string, toISO: string): number | null {
  const a = parseISODate(fromISO);
  const b = parseISODate(toISO);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * Notice deadline = expiry − notice period.
 * Example: expiry 2027-12-31, 60 days → 2027-11-01.
 */
export function computeNoticeDeadline(expiryISO: unknown, value: unknown, unit: unknown): CalcResult {
  if (!isValidISODate(expiryISO)) return { ok: false, reason: "No confirmed expiry date is available." };
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
    return { ok: false, reason: "The notice period value is missing or not a whole number." };
  const u = normalizeUnit(unit);
  if (!u) return { ok: false, reason: `The notice period unit "${String(unit ?? "")}" is missing or not supported (use days, weeks or months).` };
  const date = subtractDuration(expiryISO, value, u);
  if (!date) return { ok: false, reason: CANNOT_CALCULATE };
  return { ok: true, date, explanation: `${expiryISO} minus ${value} ${u}` };
}

/** reminder = due − leadDays (never later than the due date itself). */
export function computeReminderDate(dueISO: string | null | undefined, leadDays: number): string | null {
  if (!dueISO || !isValidISODate(dueISO)) return null;
  return subtractDuration(dueISO, Math.max(0, Math.trunc(leadDays)), "days");
}

/**
 * Expiry from a stated term (e.g. "two (2) years commencing on the Effective Date").
 * Convention (shown to the user as "derived — confirm"): the last day of the term is the day before the anniversary.
 */
export function computeExpiryFromTerm(effectiveISO: unknown, value: unknown, unit: unknown): CalcResult {
  if (!isValidISODate(effectiveISO)) return { ok: false, reason: "No effective date with a calendar value is available." };
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0)
    return { ok: false, reason: "The term length is missing or not a whole number." };
  const u = normalizeUnit(unit);
  if (!u) return { ok: false, reason: "The term unit is missing or not supported." };
  const anniversary = addDuration(effectiveISO, value, u);
  if (!anniversary) return { ok: false, reason: CANNOT_CALCULATE };
  const last = subtractDuration(anniversary, 1, "days");
  if (!last) return { ok: false, reason: CANNOT_CALCULATE };
  return { ok: true, date: last, explanation: `${effectiveISO} plus ${value} ${u}, ending the day before the anniversary` };
}

export type TimeStatus = "overdue" | "due_soon" | "upcoming";

/** Pure comparison against an injected "today". */
export function getTimeStatus(dueISO: string | null | undefined, todayISOValue: string, dueSoonDays = 30): TimeStatus | null {
  if (!dueISO) return null;
  const d = diffInDays(todayISOValue, dueISO);
  if (d === null) return null;
  if (d < 0) return "overdue";
  if (d <= dueSoonDays) return "due_soon";
  return "upcoming";
}

// ------------------------------------------------------------------
// Obligation due dates
// ------------------------------------------------------------------

export interface ObligationDateInputs {
  /** Explicit calendar date stated in the contract (YYYY-MM-DD). */
  dueDate?: string | null;
  /** e.g. "within 30 days after the Effective Date". */
  relative?: { value: number | null; unit: string | null; anchor: "effectiveDate" | "expiry" | "none"; direction: "before" | "after" } | null;
  /** e.g. "by the 5th day of each month". */
  recurrence?: {
    type: "none" | "weekly" | "monthly" | "quarterly" | "annual" | "other";
    dayOfMonth: number | null;
    month: number | null;
  } | null;
}

export interface ObligationContext {
  effectiveDate?: string | null;
  expiry?: string | null;
}

export type DueResult =
  | { ok: true; date: string; basis: "explicit" | "relative" | "recurrence"; explanation: string }
  | { ok: false; reason: string };

function daysInMonth(y: number, m1: number): number {
  return new Date(Date.UTC(y, m1, 0)).getUTCDate();
}

function clampDay(y: number, m1: number, day: number): string {
  const d = Math.min(day, daysInMonth(y, m1));
  return `${String(y).padStart(4, "0")}-${String(m1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Next occurrence (on or after `today`) of a day-of-month rule, optionally for specific months. */
export function nextRecurringDate(
  type: "monthly" | "quarterly" | "annual",
  dayOfMonth: number,
  month: number | null,
  todayISOValue: string,
): string | null {
  const t = parseISODate(todayISOValue);
  if (!t || !Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) return null;
  const ty = t.getUTCFullYear();
  const tm = t.getUTCMonth() + 1;
  const candidates: string[] = [];
  for (let offset = 0; offset < 40; offset++) {
    const idx = tm - 1 + offset;
    const y = ty + Math.floor(idx / 12);
    const m1 = (idx % 12) + 1;
    if (type === "monthly") candidates.push(clampDay(y, m1, dayOfMonth));
    else if (type === "quarterly") {
      if (month && Number.isInteger(month) && month >= 1 && month <= 12) {
        if ((m1 - month + 12) % 3 === 0) candidates.push(clampDay(y, m1, dayOfMonth));
      } else if (m1 % 3 === 0) candidates.push(clampDay(y, m1, dayOfMonth)); // calendar quarter-ends
    } else if (type === "annual") {
      if (!month || month < 1 || month > 12) return null;
      if (m1 === month) candidates.push(clampDay(y, m1, dayOfMonth));
    }
  }
  return candidates.find((c) => c >= todayISOValue) ?? null;
}

export function computeObligationDue(inputs: ObligationDateInputs, ctx: ObligationContext, todayISOValue: string): DueResult {
  if (inputs.dueDate) {
    if (!isValidISODate(inputs.dueDate)) return { ok: false, reason: "The stated due date is not a valid calendar date." };
    return { ok: true, date: inputs.dueDate, basis: "explicit", explanation: "Calendar date stated in the contract." };
  }

  const rel = inputs.relative;
  if (rel && rel.anchor !== "none") {
    const anchorDate = rel.anchor === "effectiveDate" ? ctx.effectiveDate : ctx.expiry;
    const anchorName = rel.anchor === "effectiveDate" ? "effective date" : "expiry date";
    if (!isValidISODate(anchorDate)) return { ok: false, reason: `The ${anchorName} is not available, so the relative deadline cannot be placed on the calendar.` };
    const unit = normalizeUnit(rel.unit);
    if (!unit || typeof rel.value !== "number") return { ok: false, reason: "The relative deadline length or unit is missing or not supported." };
    const date = rel.direction === "before" ? subtractDuration(anchorDate, rel.value, unit) : addDuration(anchorDate, rel.value, unit);
    if (!date) return { ok: false, reason: CANNOT_CALCULATE };
    return { ok: true, date, basis: "relative", explanation: `${rel.value} ${unit} ${rel.direction} the ${anchorName} (${anchorDate})` };
  }

  const rec = inputs.recurrence;
  if (rec && (rec.type === "monthly" || rec.type === "quarterly" || rec.type === "annual")) {
    if (!rec.dayOfMonth) return { ok: false, reason: "The recurring day of the month is not specified." };
    const date = nextRecurringDate(rec.type, rec.dayOfMonth, rec.month, todayISOValue);
    if (!date) return { ok: false, reason: "The recurrence could not be placed on the calendar (a month may be missing)." };
    return { ok: true, date, basis: "recurrence", explanation: `Next ${rec.type} occurrence (day ${rec.dayOfMonth}) on or after ${todayISOValue}` };
  }

  return { ok: false, reason: CANNOT_CALCULATE };
}

export function formatDisplayDate(iso: string | null | undefined): string {
  const d = parseISODate(iso ?? "");
  if (!d) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}
