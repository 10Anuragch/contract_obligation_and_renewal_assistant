import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { Badge, DISCLAIMER, ErrorBox, PageHeader, Spinner } from "../components/ui";

export default function About() {
  const [h, setH] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api.get("/api/health").then(setH).catch((e) => setErr(errMsg(e)));
  }, []);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Settings / About" />
      <div className="card flex gap-3 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <ShieldAlert className="mt-0.5 shrink-0" size={18} />
        <div>
          <div className="font-semibold">Information-management tool — not legal advice</div>
          <p className="mt-1">{DISCLAIMER}</p>
        </div>
      </div>

      <div className="card p-5 text-sm text-slate-700">
        <h2 className="mb-2 font-semibold text-slate-900">How it works</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Upload a text-based PDF or DOCX, or paste text. An internal policy can be added for context.</li>
          <li>AI extracts structured items. Each item cites exact text from the document, which the server verifies.</li>
          <li>You approve, edit or reject every item. Your corrections and the original extraction are both preserved.</li>
          <li>Application code — not AI — calculates notice deadlines, reminders and Upcoming / Due Soon / Overdue status.</li>
          <li>Uploading a new version flags previously approved items whose source text or values changed.</li>
        </ol>
      </div>

      <div className="card p-5 text-sm">
        <h2 className="mb-3 font-semibold text-slate-900">System status</h2>
        {err && <ErrorBox message={err} />}
        {!h && !err && <Spinner />}
        {h && (
          <dl className="grid grid-cols-[170px_1fr] gap-y-2">
            <dt className="text-slate-500">Database</dt>
            <dd><Badge tone={h.database === "connected" ? "green" : "red"}>{h.database}</Badge></dd>
            <dt className="text-slate-500">AI provider</dt>
            <dd>
              <Badge tone={h.ai.configured ? "green" : "amber"}>{h.ai.configured ? h.ai.provider : "not configured"}</Badge>
              {h.ai.model && <span className="ml-2 text-slate-500">{h.ai.model}</span>}
              {h.ai.provider === "demo" && <span className="ml-2 text-xs text-slate-500">offline heuristic extractor for demos only</span>}
            </dd>
            <dt className="text-slate-500">Upload limit</dt>
            <dd>{h.limits.maxUploadMb} MB per file</dd>
            <dt className="text-slate-500">“Due Soon” window</dt>
            <dd>{h.settings.dueSoonDays} days</dd>
            <dt className="text-slate-500">Reminder lead time</dt>
            <dd>{h.settings.obligationReminderLeadDays} days (obligations) · {h.settings.noticeReminderLeadDays} days (notice deadlines)</dd>
          </dl>
        )}
        <p className="mt-3 text-xs text-slate-400">These values are configured with environment variables on the server (see the README).</p>
      </div>
    </div>
  );
}
