import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowDownUp, CalendarClock } from "lucide-react";
import { api, errMsg, qs } from "../lib/api";
import { fmtDate } from "../lib/format";
import { Badge, ConfidenceBadge, Empty, ErrorBox, PageHeader, Spinner, StatusBadge } from "../components/ui";
import RenewalCardView from "../components/RenewalCard";

export default function Upcoming() {
  const [sp, setSp] = useSearchParams();
  const status = sp.get("status") ?? "";
  const contractId = sp.get("contractId") ?? "";
  const party = sp.get("party") ?? "";
  const sort = sp.get("sort") ?? "due";
  const dir = sp.get("dir") ?? "asc";

  const [data, setData] = useState<any>(null);
  const [cards, setCards] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    setSp(n, { replace: true });
  };

  useEffect(() => {
    setLoading(true);
    setError("");
    Promise.all([
      api.get(`/api/obligations${qs({ status, contractId, party, sort, dir })}`),
      api.get(`/api/deadlines${qs({ contractId })}`),
    ])
      .then(([o, d]) => {
        setData(o);
        setCards(d.cards);
      })
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, [status, contractId, party, sort, dir]);

  const sortBtn = (key: string, label: string) => (
    <button className="inline-flex items-center gap-1 hover:text-slate-800" onClick={() => { set("sort", key); set("dir", sort === key && dir === "asc" ? "desc" : "asc"); }}>
      {label} <ArrowDownUp size={11} className={sort === key ? "text-brand-600" : "opacity-40"} />
    </button>
  );

  return (
    <div>
      <PageHeader title="Upcoming" subtitle={data ? `Dates are calculated by application code and compared with today (${fmtDate(data.today)}).` : undefined} />

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Renewal &amp; notice deadlines</h2>
      {cards.length === 0 && !loading ? (
        <div className="card mb-8">
          <Empty icon={<CalendarClock size={36} />} title="No renewal information yet">Renewal and notice cards appear after a contract with expiry or renewal clauses has been analyzed.</Empty>
        </div>
      ) : (
        <div className="mb-8 grid gap-4 lg:grid-cols-2">
          {cards.map((c) => (
            <RenewalCardView key={c.contractId} card={c} showContractLink />
          ))}
        </div>
      )}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Obligations</h2>
      <div className="card mb-3 flex flex-wrap items-end gap-3 p-3">
        <div>
          <label className="label" htmlFor="fs">Status</label>
          <select id="fs" className="input !w-40" value={status} onChange={(e) => set("status", e.target.value)}>
            <option value="">All</option>
            <option value="upcoming">Upcoming</option>
            <option value="due_soon">Due soon</option>
            <option value="overdue">Overdue</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="fc">Contract</label>
          <select id="fc" className="input !w-56" value={contractId} onChange={(e) => set("contractId", e.target.value)}>
            <option value="">All contracts</option>
            {data?.filters.contracts.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="fp">Responsible party</label>
          <select id="fp" className="input !w-48" value={party} onChange={(e) => set("party", e.target.value)}>
            <option value="">All parties</option>
            {data?.filters.parties.map((p: string) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        {(status || contractId || party) && (
          <button className="btn-ghost" onClick={() => setSp({}, { replace: true })}>Clear filters</button>
        )}
      </div>

      {error && <ErrorBox message={error} />}
      {loading && !data && <Spinner />}
      {data && (
        <div className="card overflow-x-auto">
          {data.rows.length === 0 ? (
            <Empty icon={<CalendarClock size={36} />} title="No obligations match">Try clearing the filters, or analyze a contract to extract obligations.</Empty>
          ) : (
            <table className="w-full min-w-[980px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Obligation</th>
                  <th className="th">{sortBtn("party", "Responsible")}</th>
                  <th className="th">{sortBtn("contract", "Contract")}</th>
                  <th className="th">{sortBtn("due", "Due date")}</th>
                  <th className="th">Reminder</th>
                  <th className="th">{sortBtn("status", "Status")}</th>
                  <th className="th">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.map((r: any) => (
                  <tr key={r.itemId} className="hover:bg-slate-50">
                    <td className="td max-w-xs">
                      <div className="font-medium text-slate-800">{r.title}</div>
                      <div className="mt-1"><ConfidenceBadge confidence={r.confidence} /></div>
                    </td>
                    <td className="td text-slate-600">{r.responsibleParty}</td>
                    <td className="td"><Link className="text-brand-600 hover:underline" to={`/contracts/${r.contractId}`}>{r.contractName}</Link></td>
                    <td className="td whitespace-nowrap">
                      {r.dueDate ? fmtDate(r.dueDate) : <span className="text-xs text-amber-700">{r.cannotCalculateReason}</span>}
                    </td>
                    <td className="td whitespace-nowrap text-slate-500">{fmtDate(r.reminderDate)}</td>
                    <td className="td"><StatusBadge status={r.status} /></td>
                    <td className="td whitespace-nowrap">{r.sectionNumber ? <Badge tone="slate">Section {r.sectionNumber}</Badge> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
