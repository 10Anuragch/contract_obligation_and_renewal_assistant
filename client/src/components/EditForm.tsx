import { useState } from "react";
import { Loader2 } from "lucide-react";
import { CATEGORY_LABEL } from "../lib/format";
import { Modal } from "./ui";

type FieldType = "text" | "textarea" | "number" | "date" | "select";
interface Field {
  key: string; // dotted path for nested objects
  label: string;
  type: FieldType;
  options?: { value: string; label: string }[];
  help?: string;
}

const UNITS = [
  { value: "", label: "—" },
  { value: "days", label: "days" },
  { value: "weeks", label: "weeks" },
  { value: "months", label: "months" },
  { value: "years", label: "years" },
  { value: "business days", label: "business days" },
];
const DAYTYPE = [
  { value: "calendar", label: "Calendar days" },
  { value: "business", label: "Business days" },
  { value: "unspecified", label: "Not specified" },
];

const FIELDS: Record<string, Field[]> = {
  party: [
    { key: "name", label: "Name", type: "text" },
    { key: "role", label: "Role", type: "text" },
  ],
  effectiveDate: [
    { key: "value", label: "Date (calendar)", type: "date", help: "Leave empty if the contract gives no explicit calendar date." },
    { key: "displayValue", label: "Wording in contract", type: "text" },
  ],
  expiry: [
    { key: "value", label: "Expiry date (calendar)", type: "date", help: "Leave empty to let the application derive it from the term and effective date." },
    { key: "termValue", label: "Term length", type: "number" },
    { key: "termUnit", label: "Term unit", type: "select", options: UNITS },
    { key: "displayValue", label: "Wording in contract", type: "text" },
    { key: "description", label: "Description", type: "textarea" },
  ],
  renewal: [
    {
      key: "type",
      label: "Renewal type",
      type: "select",
      options: [
        { value: "automatic", label: "Automatic" },
        { value: "manual", label: "Manual" },
        { value: "none", label: "None" },
        { value: "uncertain", label: "Uncertain" },
      ],
    },
    { key: "term", label: "Renewal term wording", type: "text" },
    { key: "termValue", label: "Renewal term length", type: "number" },
    { key: "termUnit", label: "Renewal term unit", type: "select", options: UNITS },
    { key: "description", label: "Description", type: "textarea" },
  ],
  termination: [
    { key: "description", label: "Description", type: "textarea" },
    { key: "responsibleParty", label: "Responsible party", type: "text" },
    { key: "noticePeriodValue", label: "Notice period", type: "number" },
    { key: "noticePeriodUnit", label: "Notice unit", type: "select", options: UNITS },
  ],
  notice: [
    {
      key: "type",
      label: "Notice type",
      type: "select",
      options: [
        { value: "renewal", label: "Renewal / non-renewal" },
        { value: "termination", label: "Termination" },
        { value: "other", label: "Other" },
      ],
    },
    { key: "noticePeriodValue", label: "Notice period", type: "number" },
    { key: "noticePeriodUnit", label: "Unit", type: "select", options: UNITS },
    { key: "dayType", label: "Day counting", type: "select", options: DAYTYPE },
    { key: "responsibleParty", label: "Responsible party", type: "text" },
    { key: "description", label: "Description", type: "textarea" },
  ],
  obligation: [
    { key: "description", label: "Description", type: "textarea" },
    { key: "responsibleParty", label: "Responsible party", type: "text" },
    { key: "deadline", label: "Deadline (contract wording)", type: "text" },
    { key: "frequency", label: "Frequency", type: "text" },
    { key: "dueDate", label: "Explicit due date", type: "date", help: "Only if the contract states a calendar date." },
    {
      key: "recurrence.type",
      label: "Recurrence",
      type: "select",
      options: [
        { value: "", label: "None" },
        { value: "weekly", label: "Weekly" },
        { value: "monthly", label: "Monthly" },
        { value: "quarterly", label: "Quarterly" },
        { value: "annual", label: "Annual" },
      ],
    },
    { key: "recurrence.dayOfMonth", label: "Recurring day of month", type: "number" },
    { key: "recurrence.month", label: "Month (1–12, annual/quarterly)", type: "number" },
    { key: "relative.value", label: "Relative deadline length", type: "number" },
    { key: "relative.unit", label: "Relative unit", type: "select", options: UNITS },
    {
      key: "relative.anchor",
      label: "Relative to",
      type: "select",
      options: [
        { value: "", label: "—" },
        { value: "effectiveDate", label: "Effective date" },
        { value: "expiry", label: "Expiry date" },
      ],
    },
    {
      key: "relative.direction",
      label: "Before / after",
      type: "select",
      options: [
        { value: "after", label: "After" },
        { value: "before", label: "Before" },
      ],
    },
  ],
  ambiguity: [
    { key: "description", label: "Description", type: "textarea" },
    { key: "whyAmbiguous", label: "Why it is ambiguous", type: "textarea" },
    { key: "clarificationQuestion", label: "Clarification question", type: "textarea" },
    { key: "answer", label: "Your clarification / note", type: "textarea", help: "Record what you learned from your own records. This does not change the contract text." },
  ],
  conflict: [
    { key: "description", label: "Description", type: "textarea" },
    { key: "answer", label: "Your clarification / note", type: "textarea" },
  ],
  policyNote: [
    { key: "description", label: "Description", type: "textarea" },
    { key: "contractRequirement", label: "Contract says", type: "textarea" },
    { key: "internalPolicyStatement", label: "Internal policy says", type: "textarea" },
    { key: "policyLeadValue", label: "Internal lead time", type: "number" },
    { key: "policyLeadUnit", label: "Lead time unit", type: "select", options: UNITS },
  ],
};

const get = (o: any, path: string) => path.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);

function build(category: string, values: Record<string, string>, original: any) {
  const out: Record<string, any> = {};
  const nested: Record<string, Record<string, any>> = {};
  for (const f of FIELDS[category]) {
    const raw = values[f.key] ?? "";
    let v: any = raw;
    if (f.type === "number") v = raw === "" ? null : Number(raw);
    else if (f.type === "date") v = raw === "" ? null : raw;
    else if (f.type === "select" && f.key.endsWith("Unit") ) v = raw === "" ? null : raw;
    if (f.key.includes(".")) {
      const [p, k] = f.key.split(".");
      (nested[p] ??= {})[k] = v === "" ? null : v;
    } else out[f.key] = v;
  }
  if (category === "obligation") {
    const r = nested.recurrence ?? {};
    out.recurrence = r.type ? { type: r.type, dayOfMonth: r.dayOfMonth ?? null, month: r.month ?? null } : null;
    const l = nested.relative ?? {};
    out.relative = l.anchor ? { value: l.value ?? null, unit: l.unit ?? null, anchor: l.anchor, direction: l.direction || "after" } : null;
  }
  void original;
  return out;
}

export default function EditForm({
  item,
  busy,
  error,
  onSave,
  onClose,
}: {
  item: any;
  busy: boolean;
  error: string;
  onSave: (data: Record<string, any>, note: string) => void;
  onClose: () => void;
}) {
  const fields = FIELDS[item.category] ?? [];
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((f) => {
        const v = get(item.data, f.key);
        const dflt = f.key === "relative.direction" ? "after" : "";
        return [f.key, v === null || v === undefined ? dflt : String(v)];
      }),
    ),
  );
  const [note, setNote] = useState("");
  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));

  return (
    <Modal
      title={`Edit ${CATEGORY_LABEL[item.category] ?? "item"}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy} onClick={() => onSave(build(item.category, values, item.data), note)}>
            {busy && <Loader2 size={14} className="animate-spin" />} Save correction
          </button>
        </>
      }
    >
      <p className="mb-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
        Your correction is saved alongside the original extraction, which is never overwritten. Both remain in the audit history.
      </p>
      {error && (
        <div role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.key} className={f.type === "textarea" ? "sm:col-span-2" : ""}>
            <label className="label" htmlFor={`f-${f.key}`}>
              {f.label}
            </label>
            {f.type === "textarea" ? (
              <textarea id={`f-${f.key}`} rows={3} className="input" value={values[f.key]} onChange={(e) => set(f.key, e.target.value)} />
            ) : f.type === "select" ? (
              <select id={`f-${f.key}`} className="input" value={values[f.key]} onChange={(e) => set(f.key, e.target.value)}>
                {f.options!.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`f-${f.key}`}
                className="input"
                type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                min={f.type === "number" ? 0 : undefined}
                value={values[f.key]}
                onChange={(e) => set(f.key, e.target.value)}
              />
            )}
            {f.help && <div className="mt-1 text-xs text-slate-400">{f.help}</div>}
          </div>
        ))}
        <div className="sm:col-span-2">
          <label className="label" htmlFor="f-note">
            Note (optional)
          </label>
          <input id="f-note" className="input" placeholder="Why was this corrected?" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
