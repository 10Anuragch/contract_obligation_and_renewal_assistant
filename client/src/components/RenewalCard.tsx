import { Link } from "react-router-dom";
import { CalendarClock, Info } from "lucide-react";
import { fmtDate } from "../lib/format";
import { Badge, StatusBadge } from "./ui";

const STATUS_LABEL: Record<string, string> = { overdue: "Overdue", due_soon: "Due Soon", upcoming: "Upcoming" };

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 py-1 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-800">{children}</dd>
    </div>
  );
}

export default function RenewalCardView({ card, showContractLink }: { card: any; showContractLink?: boolean }) {
  const status = card.timeStatus ? STATUS_LABEL[card.timeStatus] : null;
  return (
    <div className="card p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <CalendarClock size={16} className="text-brand-600" />
        <h3 className="font-semibold text-slate-900">
          {showContractLink ? (
            <Link to={`/contracts/${card.contractId}`} className="hover:underline">{card.contractName}</Link>
          ) : (
            "Renewal & notice"
          )}
        </h3>
        <Badge tone="slate">v{card.versionNumber}</Badge>
        {card.needsReview && <Badge tone="orange">Needs Review</Badge>}
        <div className="ml-auto"><StatusBadge status={status} /></div>
      </div>
      <dl>
        <Line label="Expiry">
          {card.currentTermEnd ? (
            <>
              {fmtDate(card.currentTermEnd)}
              {card.expiry.derived && <Badge tone="amber">Derived — confirm</Badge>}
            </>
          ) : (
            <span className="text-amber-700">{card.expiry.reason}</span>
          )}
        </Line>
        <Line label="Renewal">
          {card.renewal ? (
            <span className="capitalize">{card.renewal.type}{card.renewal.term ? ` — ${card.renewal.term}` : ""}</span>
          ) : (
            <span className="text-slate-400">Not extracted</span>
          )}
        </Line>
        <Line label="Notice required">
          {card.notice && card.notice.value != null ? `${card.notice.value} ${card.notice.unit ?? ""}` : <span className="text-slate-400">Not stated</span>}
          {card.notice?.conflict && <Badge tone="red">Conflicting periods</Badge>}
        </Line>
        <Line label="Notice deadline">
          {card.noticeDeadline ? <b>{fmtDate(card.noticeDeadline)}</b> : <span className="text-amber-700">{card.cannotCalculateReason}</span>}
        </Line>
        {card.noticeDeadline && <Line label="Reminder">{fmtDate(card.reminderDate)}</Line>}
      </dl>
      {card.expiry.explanation && (
        <p className="mt-2 flex gap-1.5 text-xs text-slate-400">
          <Info size={12} className="mt-0.5 shrink-0" /> {card.expiry.explanation}
        </p>
      )}
      {card.policy && (
        <div className="mt-3 grid gap-2 rounded-lg border border-violet-200 bg-violet-50/40 p-3 text-sm sm:grid-cols-2">
          <div>
            <div className="label !mb-0.5">Contract requirement</div>
            {card.policy.contractRequirement}
          </div>
          <div>
            <div className="label !mb-0.5 text-violet-600">Internal policy</div>
            {card.policy.internalPolicyStatement}
            {card.policy.internalReviewDate && <div className="mt-1 text-xs text-violet-800">Internal review date: {fmtDate(card.policy.internalReviewDate)}</div>}
          </div>
          <p className="text-xs text-slate-500 sm:col-span-2">{card.policy.note}</p>
        </div>
      )}
    </div>
  );
}
