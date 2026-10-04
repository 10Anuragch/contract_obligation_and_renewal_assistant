/**
 * Deadline computation for one analysed contract version. Pure functions over plain item objects.
 * The AI only supplied the raw ingredients (dates/periods quoted in the contract); every calendar date shown to the
 * user is produced here.
 */
import {
  addDuration,
  computeExpiryFromTerm,
  computeNoticeDeadline,
  computeObligationDue,
  computeReminderDate,
  getTimeStatus,
  isValidISODate,
  normalizeUnit,
  subtractDuration,
  CANNOT_CALCULATE,
  type TimeStatus,
} from "./dates.js";
import type { ReviewStatus } from "../models/index.js";

export interface PlainItem {
  id: string;
  category: string;
  data: Record<string, any>;
  reviewStatus: ReviewStatus;
  confidence: "confirmed" | "uncertain";
  source: { sectionNumber?: string; sectionTitle?: string; verified?: boolean };
}

export interface DeadlineConfig {
  dueSoonDays: number;
  obligationReminderLeadDays: number;
  noticeReminderLeadDays: number;
}

export interface ContractRef {
  contractId: string;
  contractName: string;
  versionId: string;
  versionNumber: number;
}

export interface DeadlineRow extends ContractRef {
  kind: "obligation" | "notice" | "expiry";
  itemId: string | null;
  title: string;
  responsibleParty: string;
  dueDate: string | null;
  reminderDate: string | null;
  timeStatus: TimeStatus | null;
  reviewStatus: ReviewStatus | "derived";
  confidence: "confirmed" | "uncertain";
  sectionNumber: string;
  sectionTitle: string;
  basis: string; // how the date was calculated
  cannotCalculateReason: string | null;
}

export interface RenewalCard extends ContractRef {
  expiry: { date: string | null; derived: boolean; explanation: string; itemId: string | null; reason: string | null };
  currentTermEnd: string | null;
  renewal: { type: string; term: string; itemId: string | null } | null;
  renewalDate: string | null;
  notice: { value: number | null; unit: string | null; itemIds: string[]; conflict: boolean } | null;
  noticeDeadline: string | null;
  reminderDate: string | null;
  timeStatus: TimeStatus | null;
  cannotCalculateReason: string | null;
  needsReview: boolean;
  policy: {
    itemId: string;
    contractRequirement: string;
    internalPolicyStatement: string;
    internalReviewDate: string | null;
    note: string;
  } | null;
}

const rank = (s: ReviewStatus) => (s === "approved" || s === "edited" ? 0 : s === "pending" ? 1 : 2);
export const isUsable = (i: PlainItem) => i.reviewStatus !== "rejected";
const decided = (i: PlainItem) => i.reviewStatus === "approved" || i.reviewStatus === "edited";

function pick(items: PlainItem[], category: string): PlainItem | undefined {
  return items
    .filter((i) => i.category === category && isUsable(i))
    .sort((a, b) => rank(a.reviewStatus) - rank(b.reviewStatus))[0];
}

export function resolveContext(items: PlainItem[]) {
  const eff = pick(items, "effectiveDate");
  const exp = pick(items, "expiry");
  return {
    effectiveDate: eff && isValidISODate(eff.data.value) ? (eff.data.value as string) : null,
    expiry: exp && isValidISODate(exp.data.value) ? (exp.data.value as string) : null,
    effItem: eff,
    expItem: exp,
  };
}

export function computeRenewalCard(items: PlainItem[], ref: ContractRef, today: string, cfg: DeadlineConfig): RenewalCard | null {
  const eff = pick(items, "effectiveDate");
  const exp = pick(items, "expiry");
  const ren = pick(items, "renewal");
  const allNotices = items.filter((i) => i.category === "notice" && i.data.type === "renewal" && isUsable(i));
  if (!exp && !ren && allNotices.length === 0) return null;

  // ---- expiry (explicit date, else derived from stated term)
  let expiryDate: string | null = null;
  let derived = false;
  let explanation = "";
  let expiryReason: string | null = null;
  if (exp) {
    if (isValidISODate(exp.data.value)) {
      expiryDate = exp.data.value;
      explanation = "Expiry date stated in the contract.";
    } else if (exp.data.termValue) {
      const r = computeExpiryFromTerm(eff?.data.value, exp.data.termValue, exp.data.termUnit);
      if (r.ok) {
        expiryDate = r.date;
        derived = true;
        explanation = `Derived: ${r.explanation}. Confirm the end-date convention against the contract.`;
      } else expiryReason = r.reason;
    } else expiryReason = "The contract text does not provide a calendar expiry date or a term length that can be applied.";
  } else expiryReason = "No expiry clause was extracted.";

  // ---- roll forward through automatic renewal terms to the "then-current" term end
  let termEnd = expiryDate;
  const renewalType = ren?.data.type ?? null;
  if (termEnd && termEnd < today && renewalType === "automatic") {
    const unit = normalizeUnit(ren?.data.termUnit);
    const n = ren?.data.termValue;
    if (unit && Number.isInteger(n) && n > 0) {
      for (let k = 1; k <= 600; k++) {
        const candidate = addDuration(expiryDate!, k * n, unit);
        if (candidate && candidate >= today) {
          termEnd = candidate;
          explanation += ` Rolled forward through ${k} automatic renewal term${k > 1 ? "s" : ""} to the current term end.`;
          break;
        }
      }
    }
  }

  // ---- renewal notice period
  const preferred = allNotices.some(decided) ? allNotices.filter(decided) : allNotices;
  const keys = new Set(preferred.map((n) => `${n.data.noticePeriodValue}|${normalizeUnit(n.data.noticePeriodUnit) ?? n.data.noticePeriodUnit}|${n.data.dayType}`));
  const conflict = keys.size > 1;
  const chosen = preferred[0];
  const notice = chosen
    ? {
        value: (chosen.data.noticePeriodValue ?? null) as number | null,
        unit: (chosen.data.noticePeriodUnit ?? null) as string | null,
        itemIds: preferred.map((n) => n.id),
        conflict,
      }
    : null;

  // ---- notice deadline
  let noticeDeadline: string | null = null;
  let reason: string | null = null;
  if (renewalType === "none") reason = "The contract is recorded as not renewing, so no renewal-notice deadline applies.";
  else if (!notice) reason = "No renewal-notice clause was extracted. " + CANNOT_CALCULATE;
  else if (conflict) reason = "Conflicting renewal-notice periods were extracted. " + CANNOT_CALCULATE;
  else if (chosen.data.dayType === "business" || /business/i.test(String(notice.unit ?? "")))
    reason = "The notice period is counted in business days, which depends on a holiday calendar. " + CANNOT_CALCULATE;
  else if (!termEnd) reason = `${expiryReason ?? "The expiry date is unknown."} ${CANNOT_CALCULATE}`;
  else {
    const r = computeNoticeDeadline(termEnd, notice.value, notice.unit);
    if (r.ok) noticeDeadline = r.date;
    else reason = `${r.reason} ${CANNOT_CALCULATE}`;
  }

  // ---- internal policy (clearly separate from the contract)
  let policy: RenewalCard["policy"] = null;
  const pn = items
    .filter((i) => i.category === "policyNote" && isUsable(i) && i.data.relatesTo === "renewal_notice")
    .sort((a, b) => rank(a.reviewStatus) - rank(b.reviewStatus))[0];
  if (pn) {
    const unit = normalizeUnit(pn.data.policyLeadUnit);
    const internal = termEnd && unit && Number.isInteger(pn.data.policyLeadValue) ? subtractDuration(termEnd, pn.data.policyLeadValue, unit) : null;
    policy = {
      itemId: pn.id,
      contractRequirement: pn.data.contractRequirement,
      internalPolicyStatement: pn.data.internalPolicyStatement,
      internalReviewDate: internal,
      note: "Internal policy guidance only — it does not change the contract's terms.",
    };
  }

  const keyItems = [exp, ren, ...preferred].filter(Boolean) as PlainItem[];
  return {
    ...ref,
    expiry: { date: expiryDate, derived, explanation, itemId: exp?.id ?? null, reason: expiryReason },
    currentTermEnd: termEnd,
    renewal: ren ? { type: ren.data.type, term: ren.data.term ?? "", itemId: ren.id } : null,
    renewalDate: renewalType === "automatic" && termEnd ? addDuration(termEnd, 1, "days") : null,
    notice,
    noticeDeadline,
    reminderDate: computeReminderDate(noticeDeadline, cfg.noticeReminderLeadDays),
    timeStatus: getTimeStatus(noticeDeadline, today, cfg.dueSoonDays),
    cannotCalculateReason: noticeDeadline ? null : reason,
    needsReview: keyItems.length === 0 || keyItems.some((i) => !decided(i)) || derived,
    policy,
  };
}

export function computeObligationRows(items: PlainItem[], ref: ContractRef, today: string, cfg: DeadlineConfig): DeadlineRow[] {
  const ctx = resolveContext(items);
  // Derived expiry is also usable as an anchor (flagged elsewhere as derived).
  const card = computeRenewalCard(items, ref, today, cfg);
  const expiryAnchor = ctx.expiry ?? card?.expiry.date ?? null;

  return items
    .filter((i) => i.category === "obligation") // rejected rows are kept so they can be shown as "Rejected"
    .map((i) => {
      const calc = computeObligationDue(
        { dueDate: i.data.dueDate, relative: i.data.relative, recurrence: i.data.recurrence },
        { effectiveDate: ctx.effectiveDate, expiry: expiryAnchor },
        today,
      );
      const due = calc.ok ? calc.date : null;
      return {
        ...ref,
        kind: "obligation" as const,
        itemId: i.id,
        title: i.data.description,
        responsibleParty: i.data.responsibleParty || "Unclear",
        dueDate: due,
        reminderDate: computeReminderDate(due, cfg.obligationReminderLeadDays),
        timeStatus: getTimeStatus(due, today, cfg.dueSoonDays),
        reviewStatus: i.reviewStatus,
        confidence: i.confidence,
        sectionNumber: i.source.sectionNumber ?? "",
        sectionTitle: i.source.sectionTitle ?? "",
        basis: calc.ok ? calc.explanation : "",
        cannotCalculateReason: calc.ok ? null : calc.reason === CANNOT_CALCULATE ? CANNOT_CALCULATE : `${calc.reason} ${CANNOT_CALCULATE}`,
      };
    });
}

/** Rows for the dashboard/upcoming list: obligations + the renewal notice deadline + expiry. */
export function computeAllRows(items: PlainItem[], ref: ContractRef, today: string, cfg: DeadlineConfig): { rows: DeadlineRow[]; card: RenewalCard | null } {
  const card = computeRenewalCard(items, ref, today, cfg);
  const rows = computeObligationRows(items, ref, today, cfg);
  if (card) {
    const noticeItem = card.notice?.itemIds[0] ?? null;
    const noticeSource = items.find((i) => i.id === noticeItem)?.source;
    const noticeStatus = items.find((i) => i.id === noticeItem)?.reviewStatus ?? "pending";
    rows.push({
      ...ref,
      kind: "notice",
      itemId: noticeItem,
      title: card.notice?.value != null ? `Renewal notice deadline (${card.notice.value} ${card.notice.unit ?? ""} before term end)`.replace("  ", " ") : "Renewal notice deadline",
      responsibleParty: items.find((i) => i.id === noticeItem)?.data.responsibleParty || "Either party",
      dueDate: card.noticeDeadline,
      reminderDate: card.reminderDate,
      timeStatus: card.timeStatus,
      reviewStatus: noticeStatus,
      confidence: items.find((i) => i.id === noticeItem)?.confidence ?? "uncertain",
      sectionNumber: noticeSource?.sectionNumber ?? "",
      sectionTitle: noticeSource?.sectionTitle ?? "",
      basis: card.noticeDeadline ? `Term end ${card.currentTermEnd} minus ${card.notice?.value} ${card.notice?.unit}` : "",
      cannotCalculateReason: card.noticeDeadline ? null : card.cannotCalculateReason,
    });
    if (card.currentTermEnd) {
      const expItem = items.find((i) => i.id === card.expiry.itemId);
      rows.push({
        ...ref,
        kind: "expiry",
        itemId: card.expiry.itemId,
        title: card.expiry.derived ? "Contract term ends (derived)" : "Contract expiry",
        responsibleParty: "—",
        dueDate: card.currentTermEnd,
        reminderDate: null,
        timeStatus: getTimeStatus(card.currentTermEnd, today, cfg.dueSoonDays),
        reviewStatus: expItem?.reviewStatus ?? "pending",
        confidence: card.expiry.derived ? "uncertain" : expItem?.confidence ?? "uncertain",
        sectionNumber: expItem?.source.sectionNumber ?? "",
        sectionTitle: expItem?.source.sectionTitle ?? "",
        basis: card.expiry.explanation,
        cannotCalculateReason: null,
      });
    }
  }
  return { rows, card };
}

/** The label shown in tables: date-based status takes priority; otherwise the review state. */
export function displayStatus(row: Pick<DeadlineRow, "timeStatus" | "reviewStatus">): string {
  if (row.reviewStatus === "rejected") return "Rejected";
  if (row.timeStatus === "overdue") return "Overdue";
  if (row.timeStatus === "due_soon") return "Due Soon";
  if (row.reviewStatus === "pending" || row.reviewStatus === "stale") return "Needs Review";
  if (row.timeStatus === "upcoming") return "Upcoming";
  return "Approved";
}
