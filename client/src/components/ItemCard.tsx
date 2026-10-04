import { useState, type ReactNode } from "react";
import { AlertTriangle, Calendar, Check, History, HelpCircle, Loader2, Pencil, X } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { CATEGORY_LABEL, fmtDate, fmtDateTime, noticeText, timeStatusLabel } from "../lib/format";
import { Badge, ConfidenceBadge, ConfirmDialog, Modal, ReviewBadge, SourceBadge, StatusBadge } from "./ui";
import EditForm from "./EditForm";
import SourceViewer from "./SourceViewer";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-2 py-0.5 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-slate-800">{children || <span className="text-slate-400">Not stated</span>}</dd>
    </div>
  );
}

function Body({ item }: { item: any }) {
  const d = item.data;
  switch (item.category) {
    case "party":
      return (
        <dl>
          <Row label="Name">{d.name}</Row>
          <Row label="Role">{d.role}</Row>
        </dl>
      );
    case "effectiveDate":
      return (
        <dl>
          <Row label="Date">{d.value ? fmtDate(d.value) : null}</Row>
          <Row label="Contract wording">{d.displayValue}</Row>
          {d.reason && <Row label="Basis">{d.reason}</Row>}
        </dl>
      );
    case "expiry":
      return (
        <dl>
          <Row label="Expiry date">{d.value ? fmtDate(d.value) : null}</Row>
          <Row label="Term">{d.termValue ? `${d.termValue} ${d.termUnit ?? ""}` : null}</Row>
          <Row label="Contract wording">{d.displayValue || d.description}</Row>
          {d.reason && <Row label="Basis">{d.reason}</Row>}
        </dl>
      );
    case "renewal":
      return (
        <dl>
          <Row label="Renewal type">{<span className="capitalize">{d.type}</span>}</Row>
          <Row label="Renewal term">{d.term}</Row>
          {d.description && <Row label="Description">{d.description}</Row>}
        </dl>
      );
    case "termination":
      return (
        <dl>
          <Row label="Description">{d.description}</Row>
          <Row label="Responsible">{d.responsibleParty}</Row>
          {d.noticePeriodValue != null && <Row label="Notice">{noticeText(d)}</Row>}
        </dl>
      );
    case "notice":
      return (
        <dl>
          <Row label="Type"><span className="capitalize">{d.type}</span></Row>
          <Row label="Notice period">
            {noticeText(d)}
            {d.dayType === "business" && <span className="ml-2 text-xs text-amber-700">(counted in business days)</span>}
          </Row>
          <Row label="Responsible">{d.responsibleParty}</Row>
          {d.description && <Row label="Description">{d.description}</Row>}
        </dl>
      );
    case "obligation":
      return (
        <dl>
          <Row label="Description">{d.description}</Row>
          <Row label="Responsible">{d.responsibleParty}</Row>
          <Row label="Deadline">{d.deadline}</Row>
          <Row label="Frequency">{d.frequency}</Row>
          {d.dueDate && <Row label="Stated date">{fmtDate(d.dueDate)}</Row>}
        </dl>
      );
    case "ambiguity":
      return (
        <dl>
          <Row label="Description">{d.description}</Row>
          <Row label="Why ambiguous">{d.whyAmbiguous}</Row>
          <Row label="Clarification question">
            <span className="inline-flex items-start gap-1 font-medium text-slate-900">
              <HelpCircle size={14} className="mt-0.5 shrink-0 text-amber-600" />
              {d.clarificationQuestion}
            </span>
          </Row>
          {d.answer && <Row label="Your note">{d.answer}</Row>}
        </dl>
      );
    case "conflict":
      return (
        <dl>
          <Row label="Description">{d.description}</Row>
          {d.answer && <Row label="Your note">{d.answer}</Row>}
        </dl>
      );
    case "policyNote":
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="label !mb-0.5">Contract requirement</div>
            {d.contractRequirement || "—"}
          </div>
          <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3 text-sm">
            <div className="label !mb-0.5 text-violet-600">Internal policy (not a legal authority)</div>
            {d.internalPolicyStatement || "—"}
          </div>
          <p className="sm:col-span-2 text-xs text-slate-500">{d.description} The internal policy does not change the contract’s terms.</p>
        </div>
      );
    default:
      return null;
  }
}

function Computed({ item }: { item: any }) {
  const c = item.computed;
  if (!c) return null;
  if (item.category === "obligation") {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-sm">
        <Calendar size={14} className="text-slate-400" />
        {c.dueDate ? (
          <>
            <span>
              Next due: <b>{fmtDate(c.dueDate)}</b>
            </span>
            <span className="text-slate-500">Reminder: {fmtDate(c.reminderDate)}</span>
            <StatusBadge status={c.status} />
            <span className="text-xs text-slate-400">Calculated by the application: {c.basis}</span>
          </>
        ) : (
          <span className="text-amber-700">{c.cannotCalculateReason}</span>
        )}
      </div>
    );
  }
  if (item.category === "notice") {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-sm">
        <Calendar size={14} className="text-slate-400" />
        {c.noticeDeadline ? (
          <>
            <span>
              Notice deadline: <b>{fmtDate(c.noticeDeadline)}</b>
            </span>
            <span className="text-slate-500">Reminder: {fmtDate(c.reminderDate)}</span>
            {c.timeStatus && <Badge tone={c.timeStatus === "overdue" ? "red" : c.timeStatus === "due_soon" ? "amber" : "blue"}>{timeStatusLabel[c.timeStatus]}</Badge>}
            <span className="text-xs text-slate-400">Calculated: term end {fmtDate(c.termEnd)} minus {noticeText(item.data)}</span>
          </>
        ) : (
          <span className="text-amber-700">{c.cannotCalculateReason}</span>
        )}
      </div>
    );
  }
  if (item.category === "expiry") {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-sm">
        <Calendar size={14} className="text-slate-400" />
        {c.date ? (
          <>
            <span>
              {c.derived ? "Derived term end" : "Term end"}: <b>{fmtDate(c.date)}</b>
            </span>
            {c.derived && <Badge tone="amber">Derived — confirm against the contract</Badge>}
            <span className="text-xs text-slate-400">{c.explanation}</span>
          </>
        ) : (
          <span className="text-amber-700">{c.reason} Reminder date cannot be calculated until this item is clarified.</span>
        )}
      </div>
    );
  }
  return null;
}

export default function ItemCard({ item, onChanged }: { item: any; onChanged: (updated: any) => void }) {
  const [viewSource, setViewSource] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<null | "approve" | "reject">(null);
  const [history, setHistory] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<"" | "approve" | "reject" | "edit">("");
  const [error, setError] = useState("");
  const [rejectNote, setRejectNote] = useState("");

  const isStale = item.reviewStatus === "stale";
  const rejected = item.reviewStatus === "rejected";

  async function act(kind: "approve" | "reject") {
    setBusy(kind);
    setError("");
    try {
      const r = await api.post(`/api/items/${item.id}/${kind}`, kind === "reject" ? { note: rejectNote } : {});
      onChanged({ ...item, ...r.item, computed: item.computed });
      setConfirm(null);
      setRejectNote("");
    } catch (e) {
      setError(errMsg(e));
      setConfirm(null);
    } finally {
      setBusy("");
    }
  }

  async function save(data: Record<string, any>, note: string) {
    setBusy("edit");
    setError("");
    try {
      const r = await api.patch(`/api/items/${item.id}`, { data, note });
      onChanged({ ...item, ...r.item, computed: item.computed });
      setEditing(false);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy("");
    }
  }

  async function showHistory() {
    try {
      setHistory((await api.get(`/api/items/${item.id}`)).history);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <div className={`card p-4 ${rejected ? "opacity-60" : ""} ${isStale ? "border-orange-300 ring-1 ring-orange-200" : ""}`} data-testid={`item-${item.category}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{CATEGORY_LABEL[item.category]}</span>
        <ConfidenceBadge confidence={item.confidence} verified={item.source.verified} />
        <ReviewBadge status={item.reviewStatus} />
        {item.carriedFromVersionNumber && <Badge tone="slate">Decision carried from v{item.carriedFromVersionNumber}</Badge>}
        <div className="ml-auto">
          <SourceBadge source={item.source} onClick={() => setViewSource(true)} />
        </div>
      </div>

      {isStale && item.stale && (
        <div className="mb-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
          <div className="mb-1 flex items-center gap-1.5 font-semibold">
            <AlertTriangle size={15} /> Potentially stale — source changed in newer contract version
          </div>
          <div>{item.stale.reason}</div>
          {item.stale.changes?.length > 0 && <ul className="mt-1 list-disc pl-5">{item.stale.changes.map((c: string) => <li key={c}>{c}</li>)}</ul>}
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <StaleValue title={`Previous approved value (v${item.stale.previousVersionNumber})`} category={item.category} data={item.stale.previousApprovedValue} />
            <StaleValue title="New extracted value" category={item.category} data={item.stale.newValue} empty="Not found in the newer version" />
          </div>
          <div className="mt-2 text-xs">Approve to confirm the current value, or edit it. The newer version is not assumed to be correct.</div>
        </div>
      )}

      <Body item={item} />
      <Computed item={item} />

      {item.source.note && !item.source.verified && <div className="mt-2 text-xs text-red-700">{item.source.note}</div>}
      {item.source.note && item.source.verified && <div className="mt-2 text-xs text-amber-700">{item.source.note}</div>}
      {item.reviewNote && <div className="mt-2 text-xs italic text-slate-500">Reviewer note: {item.reviewNote}</div>}
      {item.userCorrection && (
        <div className="mt-2 text-xs text-violet-700">
          Corrected by reviewer{item.reviewedAt ? ` on ${fmtDateTime(item.reviewedAt)}` : ""}. The original extraction is preserved in the history.
        </div>
      )}
      {error && (
        <div role="alert" className="mt-2 rounded bg-red-50 p-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <button className="btn-secondary" onClick={() => setEditing(true)} disabled={!!busy}>
          <Pencil size={14} /> Edit
        </button>
        <button className="btn-success" onClick={() => setConfirm("approve")} disabled={!!busy || item.reviewStatus === "approved"}>
          {busy === "approve" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Approve
        </button>
        <button className="btn-danger" onClick={() => setConfirm("reject")} disabled={!!busy || rejected}>
          {busy === "reject" ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />} Reject
        </button>
        <button className="btn-ghost ml-auto" onClick={showHistory}>
          <History size={14} /> History
        </button>
      </div>

      {viewSource && <SourceViewer itemId={item.id} onClose={() => setViewSource(false)} />}
      {editing && <EditForm item={item} busy={busy === "edit"} error={error} onSave={save} onClose={() => { setEditing(false); setError(""); }} />}
      {confirm === "approve" && (
        <ConfirmDialog title="Approve this item?" confirmLabel="Approve" busy={busy === "approve"} onConfirm={() => act("approve")} onCancel={() => setConfirm(null)}>
          Mark “{item.label}” as reviewed and approved. Confirm that it matches the source text.
          {item.confidence === "uncertain" && <div className="mt-2 rounded bg-amber-50 p-2 text-amber-800">This item is an uncertain interpretation. Check it against the source before approving.</div>}
        </ConfirmDialog>
      )}
      {confirm === "reject" && (
        <ConfirmDialog title="Reject this item?" confirmLabel="Reject" danger busy={busy === "reject"} onConfirm={() => act("reject")} onCancel={() => setConfirm(null)}>
          Rejected items are excluded from deadlines and the reviewed summary, but stay in the audit history.
          <input className="input mt-3" placeholder="Reason (optional)" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} />
        </ConfirmDialog>
      )}
      {history && (
        <Modal title="Item history" onClose={() => setHistory(null)} wide>
          {history.length === 0 ? (
            <div className="text-sm text-slate-500">No review actions recorded yet.</div>
          ) : (
            <ol className="space-y-3">
              {history.map((h) => (
                <li key={h.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <div className="text-xs text-slate-400">{fmtDateTime(h.timestamp)}</div>
                  <div className="font-medium text-slate-800">{h.message}</div>
                </li>
              ))}
            </ol>
          )}
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-slate-600">Original AI extraction</summary>
            <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-3 text-xs">{JSON.stringify(item.original, null, 2)}</pre>
          </details>
        </Modal>
      )}
    </div>
  );
}

function StaleValue({ title, category, data, empty }: { title: string; category: string; data: any; empty?: string }) {
  let text = empty ?? "—";
  if (data) {
    if (category === "notice" || category === "termination") text = `${noticeText(data)}${data.responsibleParty ? ` · ${data.responsibleParty}` : ""}`;
    else if (category === "obligation") text = [data.description, data.deadline, data.frequency].filter(Boolean).join(" · ");
    else if (category === "party") text = `${data.name} (${data.role})`;
    else if (category === "effectiveDate") text = data.value ? fmtDate(data.value) : data.displayValue;
    else if (category === "expiry") text = data.value ? fmtDate(data.value) : `${data.termValue ?? ""} ${data.termUnit ?? ""}`.trim() || data.displayValue;
    else if (category === "renewal") text = `${data.type}${data.term ? ` · ${data.term}` : ""}`;
    else text = data.description ?? JSON.stringify(data);
  }
  return (
    <div className="rounded-md bg-white/70 p-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-orange-700">{title}</div>
      <div className="text-sm text-slate-800">{text}</div>
    </div>
  );
}
