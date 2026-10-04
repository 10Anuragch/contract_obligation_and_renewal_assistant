import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, FileUp } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { fmtDate, fmtDateTime, SOURCE_LABEL } from "../lib/format";
import { Badge, Empty, ErrorBox, PageHeader, Spinner, StatusBadge } from "../components/ui";

export default function Contracts() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const load = () => {
    setError("");
    api.get("/api/contracts").then((r) => setRows(r.contracts)).catch((e) => setError(errMsg(e)));
  };
  useEffect(load, []);

  return (
    <div>
      <PageHeader
        title="Contracts"
        subtitle="Each contract keeps every uploaded version and every review decision."
        actions={
          <Link to="/upload" className="btn-primary">
            <FileUp size={15} /> Upload Contract
          </Link>
        }
      />
      {error && <ErrorBox message={error} onRetry={load} />}
      {!rows && !error && <Spinner />}
      {rows && rows.length === 0 && (
        <div className="card">
          <Empty icon={<FileText size={40} />} title="No contracts yet">
            Upload a text-based PDF or DOCX, or paste contract text, to extract obligations and renewal deadlines for review.
          </Empty>
        </div>
      )}
      {rows && rows.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Contract</th>
                <th className="th">Current version</th>
                <th className="th">Review progress</th>
                <th className="th">Next deadline</th>
                <th className="th">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="td">
                    <Link to={`/contracts/${c.id}`} className="font-medium text-brand-600 hover:underline">
                      {c.name}
                    </Link>
                    <div className="text-xs text-slate-400">
                      {c.originalFilename} · {SOURCE_LABEL[c.sourceType]}
                    </div>
                  </td>
                  <td className="td">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="slate">v{c.currentVersion?.versionNumber ?? "—"}</Badge>
                      {c.currentVersion?.extractionStatus !== "complete" && (
                        <Badge tone={c.currentVersion?.extractionStatus === "failed" ? "red" : "amber"}>
                          {c.currentVersion?.extractionStatus === "failed" ? "Analysis failed" : c.currentVersion?.extractionStatus === "uploaded" ? "Not analyzed" : "Analyzing"}
                        </Badge>
                      )}
                      <span className="text-xs text-slate-400">{c.versionCount} version{c.versionCount === 1 ? "" : "s"}</span>
                    </div>
                  </td>
                  <td className="td">
                    {c.counts.total === 0 ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {c.counts.pending > 0 && <Badge tone="blue">{c.counts.pending} pending</Badge>}
                        {c.counts.stale > 0 && <Badge tone="orange">{c.counts.stale} stale</Badge>}
                        <Badge tone="green">{c.counts.approved + c.counts.edited} reviewed</Badge>
                        {c.counts.rejected > 0 && <Badge tone="slate">{c.counts.rejected} rejected</Badge>}
                      </div>
                    )}
                  </td>
                  <td className="td">
                    {c.nextDeadline ? (
                      <div>
                        <div className="text-slate-800">{fmtDate(c.nextDeadline.dueDate)}</div>
                        <div className="mb-1 text-xs text-slate-500">{c.nextDeadline.title}</div>
                        <StatusBadge status={c.nextDeadline.status} />
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="td whitespace-nowrap text-xs text-slate-500">{fmtDateTime(c.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
