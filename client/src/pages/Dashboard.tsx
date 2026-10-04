import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CalendarClock, ClipboardCheck, FileText, FileUp, Hourglass, Repeat } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { fmtDate, fmtDateTime } from "../lib/format";
import { Empty, ErrorBox, PageHeader, Spinner, StatusBadge, Badge } from "../components/ui";

function StatCard({ label, value, icon, tone, to }: { label: string; value: number; icon: React.ReactNode; tone: string; to?: string }) {
  const body = (
    <div className="card flex items-center gap-4 p-4 transition hover:shadow-md">
      <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${tone}`}>{icon}</div>
      <div>
        <div className="text-2xl font-semibold leading-none text-slate-900">{value}</div>
        <div className="mt-1 text-xs font-medium text-slate-500">{label}</div>
      </div>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const load = () => {
    setError("");
    api.get("/api/dashboard").then(setData).catch((e) => setError(errMsg(e)));
  };
  useEffect(load, []);

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!data) return <Spinner />;
  const c = data.cards;

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={`Deadlines are compared against today (${fmtDate(data.today)}) by application code.`} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Contracts" value={c.contracts} icon={<FileText size={20} />} tone="bg-blue-50 text-blue-600" to="/contracts" />
        <StatCard label="Needs Review" value={c.needsReview} icon={<ClipboardCheck size={20} />} tone="bg-orange-50 text-orange-600" to="/contracts" />
        <StatCard label={`Upcoming Obligations (${data.windowDays}d)`} value={c.upcomingObligations} icon={<CalendarClock size={20} />} tone="bg-emerald-50 text-emerald-600" to="/upcoming" />
        <StatCard label="Renewals / Notice Deadlines" value={c.renewalDeadlines} icon={<Repeat size={20} />} tone="bg-violet-50 text-violet-600" to="/upcoming" />
        <StatCard label="Potentially Stale" value={c.potentiallyStale} icon={<AlertTriangle size={20} />} tone="bg-amber-50 text-amber-600" to="/contracts" />
      </div>
      {(c.overdue > 0 || c.awaitingAnalysis > 0) && (
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          {c.overdue > 0 && (
            <Link to="/upcoming?status=overdue" className="rounded-lg bg-red-50 px-3 py-2 text-red-700 ring-1 ring-red-200">
              {c.overdue} overdue item{c.overdue === 1 ? "" : "s"}
            </Link>
          )}
          {c.awaitingAnalysis > 0 && (
            <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-2 text-slate-600">
              <Hourglass size={14} /> {c.awaitingAnalysis} contract version{c.awaitingAnalysis === 1 ? "" : "s"} awaiting analysis
            </span>
          )}
        </div>
      )}

      <section className="card mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="font-semibold text-slate-900">Upcoming deadlines</h2>
          <Link to="/upcoming" className="text-sm text-brand-600 hover:underline">
            View all
          </Link>
        </div>
        {data.deadlines.length === 0 ? (
          <Empty icon={<CalendarClock size={36} />} title="No dated items yet">
            Upload and analyze a contract. Deadlines appear here once dates can be calculated from the extracted information.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Item</th>
                  <th className="th">Contract</th>
                  <th className="th">Responsible Party</th>
                  <th className="th">Due Date</th>
                  <th className="th">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.deadlines.map((r: any, i: number) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="td font-medium text-slate-800">
                      {r.title}
                      {r.kind !== "obligation" && <Badge tone="violet">{r.kind === "notice" ? "Notice" : "Expiry"}</Badge>}
                    </td>
                    <td className="td">
                      <Link to={`/contracts/${r.contractId}`} className="text-brand-600 hover:underline">
                        {r.contractName}
                      </Link>
                    </td>
                    <td className="td text-slate-600">{r.responsibleParty}</td>
                    <td className="td whitespace-nowrap">{fmtDate(r.dueDate)}</td>
                    <td className="td">
                      <StatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card mt-6 overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="font-semibold text-slate-900">Recent contract versions</h2>
        </div>
        {data.recentVersions.length === 0 ? (
          <Empty icon={<FileUp size={36} />} title="No contracts uploaded">
            <Link to="/upload" className="text-brand-600 hover:underline">
              Upload your first contract
            </Link>{" "}
            to get started.
          </Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.recentVersions.map((v: any) => (
              <li key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <Link to={`/contracts/${v.contractId}`} className="font-medium text-brand-600 hover:underline">
                  {v.contractName}
                </Link>
                <Badge tone="slate">Version {v.versionNumber}</Badge>
                <span className="text-slate-500">{v.filename}</span>
                <span className="ml-auto text-xs text-slate-400">{fmtDateTime(v.uploadedAt)}</span>
                <Badge tone={v.extractionStatus === "complete" ? "green" : v.extractionStatus === "failed" ? "red" : "amber"}>
                  {v.extractionStatus === "complete" ? "Analyzed" : v.extractionStatus === "failed" ? "Analysis failed" : v.extractionStatus === "uploaded" ? "Not analyzed" : "Analyzing"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
