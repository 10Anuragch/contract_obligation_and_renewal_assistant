import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, Download, FileClock, FilePlus2, FileText, Loader2, Play, Printer, ScrollText } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { CATEGORY_LABEL, fmtDate, fmtDateTime, fmtSize, SOURCE_LABEL } from "../lib/format";
import { Badge, Empty, ErrorBox, Modal, PageHeader, ReviewBadge, Spinner, StatusBadge } from "../components/ui";
import ItemCard from "../components/ItemCard";
import RenewalCardView from "../components/RenewalCard";

type Tab = "review" | "deadlines" | "versions" | "summary" | "history";
const TABS: { id: Tab; label: string }[] = [
  { id: "review", label: "Review & Extraction" },
  { id: "deadlines", label: "Renewal & Deadlines" },
  { id: "versions", label: "Version History" },
  { id: "summary", label: "Reviewed Summary" },
  { id: "history", label: "Audit History" },
];

const GROUPS: { title: string; cats: string[]; hint?: string }[] = [
  { title: "Parties, dates & renewal", cats: ["party", "effectiveDate", "expiry", "renewal"] },
  { title: "Termination & notice", cats: ["termination", "notice"] },
  { title: "Obligations", cats: ["obligation"] },
  { title: "Ambiguities & clarification questions", cats: ["ambiguity"], hint: "Potential ambiguities are surfaced for your review. They are not resolved by the tool." },
  { title: "Potential conflicts", cats: ["conflict"] },
  { title: "Organization policy context", cats: ["policyNote"], hint: "Internal policy guidance only — kept separate from contract terms." },
];

export default function ContractDetail() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as Tab) || "review";
  const setTab = (t: Tab) => setSp({ tab: t }, { replace: true });

  const [detail, setDetail] = useState<any>(null);
  const [versionId, setVersionId] = useState<string>("");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [itemsError, setItemsError] = useState("");
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const poll = useRef<number | undefined>(undefined);

  const loadDetail = useCallback(async () => {
    try {
      const d = await api.get(`/api/contracts/${id}`);
      setDetail(d);
      return d;
    } catch (e) {
      setError(errMsg(e));
    }
  }, [id]);

  const loadItems = useCallback(
    async (vid?: string, quiet = false) => {
      if (!quiet) setLoading(true);
      setItemsError("");
      try {
        const r = await api.get(`/api/contracts/${id}/items${vid ? `?versionId=${vid}` : ""}`);
        setData(r);
        setVersionId(r.version.id);
      } catch (e) {
        setItemsError(errMsg(e));
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    (async () => {
      const d = await loadDetail();
      if (d) {
        const cur = d.versions.find((v: any) => v.isCurrent) ?? d.versions[0];
        const target = d.contract.effectiveVersionId ?? cur?.id;
        if (target) await loadItems(target);
      }
    })();
    return () => window.clearTimeout(poll.current);
  }, [loadDetail, loadItems]);

  // resume polling if the version is mid-analysis (e.g. page reload)
  const current = detail?.versions.find((v: any) => v.isCurrent);
  useEffect(() => {
    if (current && (current.extractionStatus === "analyzing" || current.extractionStatus === "saving") && !analyzing) watch(current.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, current?.extractionStatus]);

  function watch(vid: string) {
    setAnalyzing(true);
    const tick = async () => {
      try {
        const r = await api.get(`/api/contracts/${id}/versions/${vid}`);
        if (r.version.extractionStatus === "complete" || r.version.extractionStatus === "failed") {
          setAnalyzing(false);
          const d = await loadDetail();
          if (r.version.extractionStatus === "complete") await loadItems(vid);
          else if (d) setError(r.version.extractionError?.message ?? "The analysis failed.");
          return;
        }
      } catch (e) {
        setAnalyzing(false);
        setError(errMsg(e));
        return;
      }
      poll.current = window.setTimeout(tick, 1000);
    };
    tick();
  }

  async function analyze(vid: string) {
    if (analyzing) return;
    setError("");
    setAnalyzing(true);
    try {
      await api.post(`/api/contracts/${id}/versions/${vid}/analyze`);
      await loadDetail();
      watch(vid);
    } catch (e) {
      setAnalyzing(false);
      setError(errMsg(e));
    }
  }

  const onItemChanged = (updated: any) => {
    setData((d: any) => (d ? { ...d, items: d.items.map((i: any) => (i.id === updated.id ? { ...i, ...updated } : i)) } : d));
    loadItems(versionId, true); // refresh computed dates + counts
    loadDetail();
  };

  if (error && !detail) return <ErrorBox message={error} onRetry={() => { setError(""); loadDetail(); }} />;
  if (!detail) return <Spinner />;

  const c = detail.contract;
  const versions: any[] = detail.versions;
  const viewing = versions.find((v) => v.id === versionId);
  const viewingIsCurrent = viewing?.isCurrent;
  const needsAnalysis = current && (current.extractionStatus === "uploaded" || current.extractionStatus === "failed");

  return (
    <div>
      <PageHeader
        title={c.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {c.originalFilename} · {SOURCE_LABEL[c.sourceType]} <Badge tone="slate">Current: Version {c.currentVersionNumber}</Badge>
          </span>
        }
        actions={
          <>
            {needsAnalysis && (
              <button className="btn-primary" onClick={() => analyze(current.id)} disabled={analyzing}>
                {analyzing ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} {current.extractionStatus === "failed" ? "Retry analysis" : "Analyze Contract"}
              </button>
            )}
            <Link to={`/contracts/${c.id}/upload`} className="btn-secondary">
              <FilePlus2 size={15} /> Upload New Version
            </Link>
          </>
        }
      />

      {analyzing && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-brand-100 bg-brand-50 p-3 text-sm text-brand-700" role="status">
          <Loader2 size={16} className="animate-spin" /> Analyzing version {current?.versionNumber}… extracted items will appear for review when complete.
        </div>
      )}
      {error && <div className="mb-4"><ErrorBox message={error} onRetry={needsAnalysis ? () => analyze(current.id) : undefined} /></div>}
      {current?.extractionStatus === "failed" && !error && current.extractionError && (
        <div className="mb-4"><ErrorBox message={current.extractionError.message} onRetry={() => analyze(current.id)} /></div>
      )}
      {needsAnalysis && current.extractionStatus === "uploaded" && !analyzing && data && !viewingIsCurrent && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Version {current.versionNumber} has been uploaded but not analyzed yet. You are viewing the latest analyzed version (v{viewing?.versionNumber}). Analyze version {current.versionNumber} to compare it and flag items that may have become stale.
        </div>
      )}

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium ${tab === t.id ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            {t.label}
            {t.id === "review" && data?.counts.stale > 0 && <span className="ml-1.5 rounded-full bg-orange-100 px-1.5 text-xs text-orange-700">{data.counts.stale}</span>}
          </button>
        ))}
      </div>

      {tab === "review" && (
        <ReviewTab data={data} loading={loading} error={itemsError} versions={versions} versionId={versionId} onVersion={(v: string) => loadItems(v)} onChanged={onItemChanged} needsAnalysis={!data && needsAnalysis} onAnalyze={() => analyze(current.id)} analyzing={analyzing} />
      )}
      {tab === "deadlines" && <DeadlinesTab data={data} contractId={c.id} />}
      {tab === "versions" && <VersionsTab contractId={c.id} versions={versions} onView={(v: string) => { loadItems(v); setTab("review"); }} onAnalyze={analyze} analyzing={analyzing} />}
      {tab === "summary" && <SummaryTab contractId={c.id} key={`${c.id}-${data?.version.id}`} disabled={!data} />}
      {tab === "history" && <HistoryTab contractId={c.id} />}
    </div>
  );
}

// ---------------------------------------------------------------- review
const FILTERS = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending Review" },
  { id: "stale", label: "Potentially Stale" },
  { id: "uncertain", label: "Uncertain" },
  { id: "reviewed", label: "Approved / Edited" },
  { id: "rejected", label: "Rejected" },
];

function ReviewTab({ data, loading, error, versions, versionId, onVersion, onChanged, needsAnalysis, onAnalyze, analyzing }: any) {
  const [filter, setFilter] = useState("all");
  const items: any[] = data?.items ?? [];
  const shown = useMemo(
    () =>
      items.filter((i) =>
        filter === "all" ? true
        : filter === "pending" ? i.reviewStatus === "pending"
        : filter === "stale" ? i.reviewStatus === "stale"
        : filter === "uncertain" ? i.confidence === "uncertain" && i.reviewStatus !== "rejected"
        : filter === "reviewed" ? i.reviewStatus === "approved" || i.reviewStatus === "edited"
        : i.reviewStatus === "rejected",
      ),
    [items, filter],
  );

  if (error) return <ErrorBox message={error} />;
  if (loading && !data) return <Spinner />;
  if (!data)
    return (
      <div className="card">
        <Empty icon={<ScrollText size={40} />} title="This contract has not been analyzed yet">
          Run the analysis to extract parties, dates, clauses and obligations. Each item will cite its exact source text and wait for your review.
          {needsAnalysis && (
            <div className="mt-4">
              <button className="btn-primary" onClick={onAnalyze} disabled={analyzing}>
                {analyzing ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Analyze Contract
              </button>
            </div>
          )}
        </Empty>
      </div>
    );

  const k = data.counts;
  const cmp = data.version.comparison;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="text-sm text-slate-500" htmlFor="ver">Version</label>
        <select id="ver" className="input !w-auto" value={versionId} onChange={(e) => onVersion(e.target.value)}>
          {versions.map((v: any) => (
            <option key={v.id} value={v.id} disabled={v.extractionStatus !== "complete"}>
              Version {v.versionNumber}{v.isCurrent ? " (current)" : ""}{v.extractionStatus !== "complete" ? " — not analyzed" : ""}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <Badge tone="blue">{k.pending} pending</Badge>
          <Badge tone="green">{k.approved} approved</Badge>
          <Badge tone="violet">{k.edited} edited</Badge>
          <Badge tone="slate">{k.rejected} rejected</Badge>
          {k.stale > 0 && <Badge tone="orange">{k.stale} potentially stale</Badge>}
        </div>
      </div>

      {cmp && !cmp.error && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600">
          Compared with version {cmp.comparedToVersionNumber}: {cmp.carried} earlier decision{cmp.carried === 1 ? "" : "s"} carried forward (source unchanged),{" "}
          <b className={cmp.stale ? "text-orange-700" : ""}>{cmp.stale} approved item{cmp.stale === 1 ? "" : "s"} potentially stale</b>
          {cmp.disappeared ? ` (${cmp.disappeared} no longer found in the new text)` : ""}. The newer version is not assumed to be correct — please review.
        </div>
      )}
      {cmp?.error && <div className="mb-4"><ErrorBox message={cmp.error} /></div>}

      <div className="mb-5 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)} className={`rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset ${filter === f.id ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-300 hover:bg-slate-50"}`}>
            {f.label}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="card"><Empty icon={<FileText size={36} />} title="No items were extracted">The analysis completed but found no extractable items in this document.</Empty></div>
      ) : shown.length === 0 ? (
        <div className="card"><Empty title="No items match this filter" /></div>
      ) : (
        <div className="space-y-8">
          {GROUPS.map((g) => {
            const rows = shown.filter((i) => g.cats.includes(i.category));
            if (rows.length === 0) return null;
            return (
              <section key={g.title}>
                <div className="mb-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{g.title} <span className="font-normal text-slate-400">({rows.length})</span></h2>
                  {g.hint && <p className="text-xs text-slate-400">{g.hint}</p>}
                </div>
                <div className="space-y-3">
                  {rows.map((i) => <ItemCard key={i.id} item={i} onChanged={onChanged} />)}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- deadlines
function DeadlinesTab({ data, contractId }: { data: any; contractId: string }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api.get(`/api/obligations?contractId=${contractId}&includeRejected=true`).then((r) => setRows(r.rows)).catch((e) => setErr(errMsg(e)));
  }, [contractId, data?.counts]);
  if (!data) return <div className="card"><Empty icon={<FileClock size={36} />} title="Nothing to show yet">Analyze the contract to calculate deadlines.</Empty></div>;
  return (
    <div className="space-y-6">
      {data.renewalCard ? <RenewalCardView card={data.renewalCard} /> : <div className="card"><Empty title="No renewal or expiry information was extracted" /></div>}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Obligation deadlines</h2>
        {err && <ErrorBox message={err} />}
        {!rows && !err && <Spinner />}
        {rows && (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="bg-slate-50"><tr><th className="th">Obligation</th><th className="th">Responsible</th><th className="th">Due date</th><th className="th">Reminder</th><th className="th">Status</th><th className="th">Source</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.itemId} className={r.reviewStatus === "rejected" ? "opacity-50" : ""}>
                    <td className="td max-w-sm font-medium text-slate-800">{r.title}</td>
                    <td className="td text-slate-600">{r.responsibleParty}</td>
                    <td className="td whitespace-nowrap">{r.dueDate ? fmtDate(r.dueDate) : <span className="text-xs text-amber-700">{r.cannotCalculateReason}</span>}</td>
                    <td className="td whitespace-nowrap text-slate-500">{fmtDate(r.reminderDate)}</td>
                    <td className="td"><StatusBadge status={r.status} /></td>
                    <td className="td">{r.sectionNumber ? <Badge tone="slate">Section {r.sectionNumber}</Badge> : "—"}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={6}>No obligations extracted.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- versions
function VersionsTab({ contractId, versions, onView, onAnalyze, analyzing }: any) {
  const [doc, setDoc] = useState<any>(null);
  const [docErr, setDocErr] = useState("");
  async function openDoc(v: any) {
    setDocErr("");
    try {
      setDoc(await api.get(`/api/contracts/${contractId}/versions/${v.id}/document`));
    } catch (e) {
      setDocErr(errMsg(e));
    }
  }
  return (
    <div className="space-y-3">
      {docErr && <ErrorBox message={docErr} />}
      {versions.map((v: any) => (
        <div key={v.id} className="card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-slate-900">Version {v.versionNumber}</h3>
            {v.isCurrent && <Badge tone="blue">Current version</Badge>}
            <Badge tone={v.extractionStatus === "complete" ? "green" : v.extractionStatus === "failed" ? "red" : "amber"}>
              {v.extractionStatus === "complete" ? "Analyzed" : v.extractionStatus === "failed" ? "Analysis failed" : v.extractionStatus === "uploaded" ? "Not analyzed" : "Analyzing"}
            </Badge>
            <span className="ml-auto text-sm text-slate-500">Uploaded: {fmtDateTime(v.uploadedAt)}</span>
          </div>
          <div className="mt-1 text-sm text-slate-500">
            {v.filename} · {SOURCE_LABEL[v.sourceType]} · {fmtSize(v.fileSize)} · {v.characterCount?.toLocaleString?.() ?? ""} characters{v.hasPolicy ? " · with policy" : ""}
          </div>
          {v.counts?.total > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone="blue">{v.counts.pending} pending</Badge><Badge tone="green">{v.counts.approved} approved</Badge><Badge tone="violet">{v.counts.edited} edited</Badge><Badge tone="slate">{v.counts.rejected} rejected</Badge>
              {v.counts.stale > 0 && <Badge tone="orange">{v.counts.stale} potentially stale</Badge>}
            </div>
          )}
          {v.comparison && !v.comparison.error && (
            <p className="mt-2 text-xs text-slate-500">
              Compared with v{v.comparison.comparedToVersionNumber}: {v.comparison.carried} decisions carried forward, {v.comparison.stale} potentially stale.
            </p>
          )}
          {v.extractionError && <p className="mt-2 text-xs text-red-700">{v.extractionError.message}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {v.extractionStatus === "complete" && <button className="btn-secondary" onClick={() => onView(v.id)}>Review this version</button>}
            {(v.extractionStatus === "uploaded" || v.extractionStatus === "failed") && (
              <button className="btn-primary" disabled={analyzing} onClick={() => onAnalyze(v.id)}><Play size={14} /> {v.extractionStatus === "failed" ? "Retry analysis" : "Analyze"}</button>
            )}
            <button className="btn-ghost" onClick={() => openDoc(v)}><ScrollText size={14} /> View parsed text</button>
          </div>
        </div>
      ))}
      {doc && (
        <Modal title={`Version ${doc.versionNumber} — parsed text`} onClose={() => setDoc(null)} wide>
          <div className="mb-2 text-xs text-slate-500">{doc.filename} · {doc.sections.length} sections detected</div>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto">
            {doc.sections.map((s: any) => (
              <div key={s.sectionId} className="rounded border border-slate-200 p-3">
                <div className="mb-1 text-xs font-semibold text-slate-500">{s.sectionNumber ? `Section ${s.sectionNumber}` : "Section"}{s.heading ? ` — ${s.heading}` : ""}</div>
                <div className="whitespace-pre-wrap text-sm text-slate-700">{s.text}</div>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- summary
function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{n}. {title}</h3>
      {children}
    </section>
  );
}
function EntryList({ entries, empty = "None reviewed yet." }: { entries: any[]; empty?: string }) {
  if (!entries.length) return <p className="text-sm italic text-slate-400">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {entries.map((e) => (
        <li key={e.itemId} className="text-sm text-slate-800">
          • {e.text}
          {e.source.sectionNumber && <span className="ml-1.5 text-xs text-slate-400">(Section {e.source.sectionNumber}{e.source.sectionTitle ? ` — ${e.source.sectionTitle}` : ""})</span>}
          {e.edited && <span className="ml-1.5 text-xs text-violet-600">edited by reviewer</span>}
          {e.note && <span className="ml-1.5 text-xs text-amber-700">— {e.note}</span>}
        </li>
      ))}
    </ul>
  );
}

function SummaryTab({ contractId, disabled }: { contractId: string; disabled: boolean }) {
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function generate() {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      setRes(await api.get(`/api/contracts/${contractId}/summary?log=true`));
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  function download() {
    const blob = new Blob([res.markdown], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${res.summary.overview.contractName.replace(/[^\w-]+/g, "_")}_v${res.summary.overview.versionNumber}_summary.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (disabled) return <div className="card"><Empty icon={<ScrollText size={36} />} title="No summary yet">A reviewed summary is available once the contract has been analyzed.</Empty></div>;
  if (!res)
    return (
      <div className="card">
        <Empty icon={<ScrollText size={36} />} title="Reviewed contract summary">
          Builds a structured summary from the items you approved or edited. Rejected and unreviewed items are listed separately.
          <div className="mt-4">
            <button className="btn-primary" onClick={generate} disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <ScrollText size={15} />} Generate summary</button>
          </div>
          {err && <div className="mt-3 text-left"><ErrorBox message={err} /></div>}
        </Empty>
      </div>
    );

  const s = res.summary;
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2 print:hidden">
        <button className="btn-secondary" onClick={generate} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : null} Regenerate</button>
        <button className="btn-secondary" onClick={download}><Download size={14} /> Download (.md)</button>
        <button className="btn-secondary" onClick={() => window.print()}><Printer size={14} /> Print</button>
      </div>
      {err && <ErrorBox message={err} />}
      <article className="card space-y-6 p-6">
        <header>
          <h2 className="text-lg font-semibold text-slate-900">{s.title}</h2>
          <div className="text-sm text-slate-600">{s.overview.contractName}</div>
          <p className="mt-1 text-sm text-slate-600">{s.basedOn}</p>
          <p className="mt-2 inline-block rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-800">Review status: {s.reviewStatusLine}.</p>
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{s.disclaimer}</p>
        </header>
        <Section n={1} title="Contract overview">
          <p className="text-sm text-slate-700">{s.overview.filename} · Version {s.overview.versionNumber} · uploaded {fmtDateTime(s.overview.uploadedAt)} · {s.overview.totalItems} extracted items</p>
        </Section>
        <Section n={2} title="Parties"><EntryList entries={s.parties} /></Section>
        <Section n={3} title="Effective date"><EntryList entries={s.effectiveDate} /></Section>
        <Section n={4} title="Expiry"><EntryList entries={s.expiry} /></Section>
        <Section n={5} title="Renewal terms"><EntryList entries={s.renewal} /></Section>
        <Section n={6} title="Termination terms"><EntryList entries={s.termination} /></Section>
        <Section n={7} title="Notice requirements"><EntryList entries={s.notices} /></Section>
        <Section n={8} title="Key obligations"><EntryList entries={s.obligations} /></Section>
        <Section n={9} title="Upcoming deadlines">
          {s.renewalCard && (
            <div className="mb-2 rounded-lg bg-slate-50 p-3 text-sm">
              Expiry: {s.renewalCard.expiry} · Renewal: {s.renewalCard.renewal} · Notice: {s.renewalCard.noticePeriod} · Notice deadline: <b>{s.renewalCard.noticeDeadline}</b>
            </div>
          )}
          {s.upcomingDeadlines.length ? (
            <ul className="space-y-1 text-sm">
              {s.upcomingDeadlines.map((d: any, i: number) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <span className="w-28 text-slate-600">{d.display}</span> {d.title} <StatusBadge status={d.status} />
                  {d.note && <span className="text-xs text-amber-700">{d.note}</span>}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm italic text-slate-400">No calculable deadlines yet.</p>}
        </Section>
        <Section n={10} title="Ambiguities requiring clarification">
          {s.ambiguities.length ? (
            <ul className="space-y-2">
              {s.ambiguities.map((a: any) => (
                <li key={a.itemId} className="text-sm">
                  • {a.text} {a.source.sectionNumber && <span className="text-xs text-slate-400">(Section {a.source.sectionNumber})</span>}
                  <div className="ml-4 text-slate-600">Clarification question: <span className="font-medium">{a.question}</span></div>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm italic text-slate-400">None outstanding.</p>}
        </Section>
        <Section n={11} title="Items rejected by reviewer"><EntryList entries={s.rejected} empty="None." /></Section>
        <Section n={12} title="Items that remain uncertain"><EntryList entries={s.uncertain} empty="None." /></Section>
        {s.policyContext.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Internal policy context (not part of the contract)</h3>
            <EntryList entries={s.policyContext} />
          </section>
        )}
      </article>
    </div>
  );
}

// ---------------------------------------------------------------- audit history
function HistoryTab({ contractId }: { contractId: string }) {
  const [events, setEvents] = useState<any[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api.get(`/api/contracts/${contractId}/audit-history`).then((r) => setEvents(r.events)).catch((e) => setErr(errMsg(e)));
  }, [contractId]);
  if (err) return <ErrorBox message={err} />;
  if (!events) return <Spinner />;
  if (events.length === 0) return <div className="card"><Empty title="No history yet" /></div>;
  const icon = (a: string) => (a === "item_marked_stale" ? <AlertTriangle size={14} className="text-orange-600" /> : <span className="h-2 w-2 rounded-full bg-brand-500" />);
  return (
    <div className="card divide-y divide-slate-100">
      {events.map((e) => (
        <div key={e.id} className="flex items-start gap-3 px-4 py-3 text-sm">
          <div className="mt-1.5 flex w-4 justify-center">{icon(e.action)}</div>
          <div className="min-w-0 flex-1">
            <div className="text-slate-800">{e.message || e.action}</div>
            <div className="text-xs text-slate-400">{fmtDateTime(e.timestamp)}{e.versionNumber ? ` · version ${e.versionNumber}` : ""} · {e.actor}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
