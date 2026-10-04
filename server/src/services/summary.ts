/**
 * Reviewed summary. Composed deterministically from the reviewer-approved/edited items — no AI call, so every
 * statement in it can be traced to an item with a source citation. Rejected and unreviewed items are reported
 * separately and never mixed into the "reviewed" sections.
 */
import { formatDisplayDate } from "./dates.js";
import type { DeadlineRow, PlainItem, RenewalCard } from "./deadlines.js";
import { noticeText } from "./items.js";

export const DISCLAIMER =
  "This tool organizes and summarizes information found in uploaded documents. It does not provide legal advice or determine legal rights or obligations. Review extracted information against the source document.";

export interface SummaryItemInput extends PlainItem {
  userCorrection?: unknown;
  stale?: { reason?: string; previousApprovedValue?: unknown; newValue?: unknown } | null;
}

export interface SummaryEntry {
  itemId: string;
  text: string;
  reviewStatus: string;
  confidence: string;
  edited: boolean;
  source: { sectionNumber: string; sectionTitle: string; verified: boolean };
  note?: string;
}

export interface ReviewedSummary {
  title: string;
  disclaimer: string;
  basedOn: string;
  generatedAt: string;
  reviewStatusLine: string;
  counts: { approved: number; edited: number; rejected: number; pending: number; stale: number; requiringClarification: number };
  overview: { contractName: string; filename: string; versionNumber: number; uploadedAt: string | null; totalItems: number };
  parties: SummaryEntry[];
  effectiveDate: SummaryEntry[];
  expiry: SummaryEntry[];
  renewal: SummaryEntry[];
  termination: SummaryEntry[];
  notices: SummaryEntry[];
  obligations: SummaryEntry[];
  upcomingDeadlines: { title: string; dueDate: string | null; display: string; status: string; responsibleParty: string; note: string }[];
  renewalCard: { expiry: string; renewal: string; noticePeriod: string; noticeDeadline: string; status: string } | null;
  ambiguities: (SummaryEntry & { question: string; why: string })[];
  rejected: SummaryEntry[];
  uncertain: SummaryEntry[];
  policyContext: SummaryEntry[];
}

const dash = (v: unknown) => (v === null || v === undefined || v === "" ? "not stated" : String(v));

export function describeItem(category: string, d: Record<string, any>): string {
  switch (category) {
    case "party":
      return `${d.name} — ${d.role || "role not stated"}`;
    case "effectiveDate":
      return d.value ? `${formatDisplayDate(d.value)}${d.displayValue ? ` (contract wording: "${d.displayValue}")` : ""}` : dash(d.displayValue);
    case "expiry":
      return d.value
        ? `${formatDisplayDate(d.value)}${d.description ? ` — ${d.description}` : ""}`
        : `${dash(d.displayValue || d.description)}${d.termValue ? ` (term: ${d.termValue} ${d.termUnit ?? ""})` : ""}`;
    case "renewal":
      return `${d.type} renewal${d.term ? ` — ${d.term}` : ""}${d.description ? `. ${d.description}` : ""}`;
    case "termination":
      return `${d.description} (Responsible: ${dash(d.responsibleParty)}; notice: ${noticeText(d)})`;
    case "notice":
      return `${d.type} notice — ${noticeText(d)}${d.dayType === "business" ? " (counted in business days)" : ""}${d.description ? `. ${d.description}` : ""}`;
    case "obligation":
      return `${d.description} — Responsible: ${dash(d.responsibleParty)}; Deadline: ${d.deadline || d.frequency ? [d.deadline, d.frequency].filter(Boolean).join(", ") : "not stated"}`;
    case "ambiguity":
      return `${d.description}`;
    case "conflict":
      return `${d.description}`;
    case "policyNote":
      return `Contract: ${d.contractRequirement} | Internal policy: ${d.internalPolicyStatement}`;
    default:
      return JSON.stringify(d);
  }
}

export function buildSummary(args: {
  contractName: string;
  filename: string;
  versionNumber: number;
  uploadedAt: Date | string | null;
  items: SummaryItemInput[];
  rows: DeadlineRow[];
  card: RenewalCard | null;
  statusOf: (row: DeadlineRow) => string;
  now?: Date;
}): ReviewedSummary {
  const { items } = args;
  const isDecided = (i: SummaryItemInput) => i.reviewStatus === "approved" || i.reviewStatus === "edited";
  const entry = (i: SummaryItemInput, extra: Partial<SummaryEntry> = {}): SummaryEntry => ({
    itemId: i.id,
    text: describeItem(i.category, i.data),
    reviewStatus: i.reviewStatus,
    confidence: i.confidence,
    edited: i.reviewStatus === "edited" || i.userCorrection != null,
    source: {
      sectionNumber: i.source.sectionNumber ?? "",
      sectionTitle: i.source.sectionTitle ?? "",
      verified: i.source.verified !== false,
    },
    ...extra,
  });
  const reviewed = (cat: string) => items.filter((i) => i.category === cat && isDecided(i)).map((i) => entry(i));

  const unresolved = items.filter(
    (i) => (i.category === "ambiguity" || i.category === "conflict") && i.reviewStatus !== "rejected" && !String(i.data.answer ?? "").trim(),
  );
  const count = (s: string) => items.filter((i) => i.reviewStatus === s).length;
  const counts = {
    approved: count("approved"),
    edited: count("edited"),
    rejected: count("rejected"),
    pending: count("pending"),
    stale: count("stale"),
    requiringClarification: unresolved.length,
  };
  const reviewStatusLine =
    `${counts.approved} approved, ${counts.edited} edited, ${counts.rejected} rejected, ${counts.requiringClarification} requiring clarification` +
    (counts.pending || counts.stale ? ` (${counts.pending} pending review, ${counts.stale} potentially stale)` : "");

  const uncertain = items
    .filter(
      (i) =>
        !["ambiguity", "conflict"].includes(i.category) &&
        i.reviewStatus !== "rejected" &&
        ((i.confidence === "uncertain" && !isDecided(i)) || i.reviewStatus === "stale" || i.source.verified === false),
    )
    .map((i) =>
      entry(i, {
        note:
          i.reviewStatus === "stale"
            ? `Potentially stale — ${i.stale?.reason ?? "source changed in newer contract version"}`
            : i.source.verified === false
              ? "Source text could not be verified in the document"
              : i.reviewStatus === "pending"
                ? "Uncertain interpretation — awaiting review"
                : "Uncertain interpretation",
      }),
    );

  const rows = args.rows.filter((r) => r.dueDate && r.reviewStatus !== "rejected").sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1));
  const card = args.card;

  return {
    title: "Reviewed Information Summary",
    disclaimer: DISCLAIMER,
    basedOn: `Source: Contract Version ${args.versionNumber}. This summary is based on the reviewed extracted information (approved and edited items) — not on the unreviewed AI output.`,
    generatedAt: (args.now ?? new Date()).toISOString(),
    reviewStatusLine,
    counts,
    overview: {
      contractName: args.contractName,
      filename: args.filename,
      versionNumber: args.versionNumber,
      uploadedAt: args.uploadedAt ? new Date(args.uploadedAt).toISOString() : null,
      totalItems: items.length,
    },
    parties: reviewed("party"),
    effectiveDate: reviewed("effectiveDate"),
    expiry: reviewed("expiry"),
    renewal: reviewed("renewal"),
    termination: reviewed("termination"),
    notices: reviewed("notice"),
    obligations: reviewed("obligation"),
    upcomingDeadlines: rows.slice(0, 20).map((r) => ({
      title: r.title,
      dueDate: r.dueDate,
      display: formatDisplayDate(r.dueDate),
      status: args.statusOf(r),
      responsibleParty: r.responsibleParty,
      note: r.reviewStatus === "approved" || r.reviewStatus === "edited" ? "" : "Based on an item that has not been approved yet",
    })),
    renewalCard: card
      ? {
          expiry: card.currentTermEnd ? `${formatDisplayDate(card.currentTermEnd)}${card.expiry.derived ? " (derived — confirm)" : ""}` : "Not available",
          renewal: card.renewal ? `${card.renewal.type}${card.renewal.term ? ` — ${card.renewal.term}` : ""}` : "Not extracted",
          noticePeriod: card.notice && card.notice.value !== null ? `${card.notice.value} ${card.notice.unit ?? ""}`.trim() : "Not stated",
          noticeDeadline: card.noticeDeadline ? formatDisplayDate(card.noticeDeadline) : card.cannotCalculateReason ?? "Not available",
          status: card.timeStatus ?? "—",
        }
      : null,
    ambiguities: unresolved.map((i) => ({
      ...entry(i),
      question: String(i.data.clarificationQuestion ?? ""),
      why: String(i.data.whyAmbiguous ?? ""),
    })),
    rejected: items.filter((i) => i.reviewStatus === "rejected").map((i) => entry(i)),
    uncertain,
    policyContext: items.filter((i) => i.category === "policyNote" && isDecided(i)).map((i) => entry(i)),
  };
}

export function summaryToMarkdown(s: ReviewedSummary): string {
  const cite = (e: SummaryEntry) => (e.source.sectionNumber ? ` _(Section ${e.source.sectionNumber}${e.source.sectionTitle ? ` — ${e.source.sectionTitle}` : ""})_` : "");
  const list = (arr: SummaryEntry[], empty = "None reviewed yet.") =>
    arr.length ? arr.map((e) => `- ${e.text}${cite(e)}${e.edited ? " ✎ edited" : ""}${e.note ? ` — ${e.note}` : ""}`).join("\n") : `_${empty}_`;
  const lines = [
    `# ${s.title}`,
    `**${s.overview.contractName}** — ${s.basedOn}`,
    `**Review status:** ${s.reviewStatusLine}.`,
    `> ${s.disclaimer}`,
    `## 1. Contract overview\n- File: ${s.overview.filename}\n- Version: ${s.overview.versionNumber}\n- Uploaded: ${s.overview.uploadedAt ? formatDisplayDate(s.overview.uploadedAt.slice(0, 10)) : "—"}`,
    `## 2. Parties\n${list(s.parties)}`,
    `## 3. Effective date\n${list(s.effectiveDate)}`,
    `## 4. Expiry\n${list(s.expiry)}`,
    `## 5. Renewal terms\n${list(s.renewal)}`,
    `## 6. Termination terms\n${list(s.termination)}`,
    `## 7. Notice requirements\n${list(s.notices)}`,
    `## 8. Key obligations\n${list(s.obligations)}`,
    `## 9. Upcoming deadlines\n` +
      (s.upcomingDeadlines.length
        ? s.upcomingDeadlines.map((d) => `- ${d.display} — ${d.title} (${d.status})${d.note ? ` — ${d.note}` : ""}`).join("\n")
        : "_No calculable deadlines yet._"),
    `## 10. Ambiguities requiring clarification\n` +
      (s.ambiguities.length ? s.ambiguities.map((a) => `- ${a.text}${cite(a)}\n  - Clarification question: ${a.question}`).join("\n") : "_None outstanding._"),
    `## 11. Items rejected by reviewer\n${list(s.rejected, "None.")}`,
    `## 12. Items that remain uncertain\n${list(s.uncertain, "None.")}`,
  ];
  return lines.join("\n\n") + "\n";
}
