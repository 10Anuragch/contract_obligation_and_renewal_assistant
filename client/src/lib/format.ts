export function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(+d)) return "—";
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fmtSize(bytes?: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const SOURCE_LABEL: Record<string, string> = { pdf: "PDF", docx: "DOCX", text: "Pasted text" };

export const CATEGORY_LABEL: Record<string, string> = {
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

export function noticeText(d: any): string {
  if (d?.noticePeriodValue === null || d?.noticePeriodValue === undefined) return "No period stated";
  return `${d.noticePeriodValue} ${d.noticePeriodUnit ?? ""}`.trim();
}

export const timeStatusLabel: Record<string, string> = { overdue: "Overdue", due_soon: "Due Soon", upcoming: "Upcoming" };
