import { useEffect, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clock, FileSearch, HelpCircle, Loader2, X, XCircle, RefreshCw, Pencil, AlertOctagon } from "lucide-react";

type Tone = "slate" | "green" | "amber" | "red" | "blue" | "violet" | "orange";
const TONES: Record<Tone, string> = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  orange: "bg-orange-50 text-orange-800 ring-orange-300",
};

export function Badge({ tone = "slate", children, icon }: { tone?: Tone; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {icon}
      {children}
    </span>
  );
}

/** "Confirmed by source text" vs "Uncertain interpretation" — never visually the same. */
export function ConfidenceBadge({ confidence, verified = true }: { confidence: string; verified?: boolean }) {
  if (!verified) return <Badge tone="red" icon={<AlertOctagon size={12} />}>Source not verified</Badge>;
  return confidence === "confirmed" ? (
    <Badge tone="green" icon={<CheckCircle2 size={12} />}>Confirmed by source text</Badge>
  ) : (
    <Badge tone="amber" icon={<HelpCircle size={12} />}>Uncertain interpretation</Badge>
  );
}

const REVIEW: Record<string, { tone: Tone; label: string }> = {
  pending: { tone: "blue", label: "Pending Review" },
  approved: { tone: "green", label: "Approved" },
  edited: { tone: "violet", label: "Edited" },
  rejected: { tone: "slate", label: "Rejected" },
  stale: { tone: "orange", label: "Potentially Stale" },
};
export function ReviewBadge({ status }: { status: string }) {
  const r = REVIEW[status] ?? { tone: "slate" as Tone, label: status };
  return <Badge tone={r.tone} icon={status === "stale" ? <AlertTriangle size={12} /> : status === "edited" ? <Pencil size={11} /> : undefined}>{r.label}</Badge>;
}

const STATUS_TONE: Record<string, Tone> = {
  Upcoming: "blue",
  "Due Soon": "amber",
  Overdue: "red",
  Approved: "green",
  "Needs Review": "orange",
  Rejected: "slate",
};
export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-slate-400">—</span>;
  return <Badge tone={STATUS_TONE[status] ?? "slate"} icon={status === "Overdue" ? <Clock size={12} /> : undefined}>{status}</Badge>;
}

export function SourceBadge({ source, onClick }: { source: { sectionNumber?: string; sectionTitle?: string; verified?: boolean }; onClick?: () => void }) {
  const label = source.sectionNumber ? `Section ${source.sectionNumber}` : source.sectionTitle || "Source";
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 hover:border-brand-500 hover:text-brand-700"
      title="View the exact source text"
    >
      <FileSearch size={12} /> {label}
      {source.sectionTitle && source.sectionNumber ? <span className="hidden text-slate-400 sm:inline">· {source.sectionTitle}</span> : null}
    </button>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500" role="status">
      <Loader2 className="animate-spin" size={18} /> {label ?? "Loading…"}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <XCircle size={18} className="mt-0.5 shrink-0" />
      <div className="flex-1">{message}</div>
      {onRetry && (
        <button className="btn-secondary !py-1" onClick={onRetry}>
          <RefreshCw size={14} /> Retry
        </button>
      )}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <div className="text-slate-300">{icon}</div>
      <div className="font-medium text-slate-700">{title}</div>
      {children && <div className="max-w-md text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`card w-full ${wide ? "max-w-3xl" : "max-w-xl"} my-auto`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button className="btn-ghost !p-1" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className={danger ? "btn bg-red-600 text-white hover:bg-red-700" : "btn-primary"} onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 size={14} className="animate-spin" />} {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm text-slate-600">{children}</div>
    </Modal>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export const DISCLAIMER =
  "This tool organizes and summarizes information found in uploaded documents. It does not provide legal advice or determine legal rights or obligations. Review extracted information against the source document.";
