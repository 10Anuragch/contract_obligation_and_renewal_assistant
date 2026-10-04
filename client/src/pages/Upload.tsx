import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, ClipboardPaste, FileText, Loader2, Play, ShieldAlert, UploadCloud, X } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { fmtDateTime, fmtSize, SOURCE_LABEL } from "../lib/format";
import { ErrorBox, PageHeader } from "../components/ui";

const MAX_MB = 10;
const ok = (f: File) => /\.(pdf|docx)$/i.test(f.name);

function validate(f: File | null, what: string): string {
  if (!f) return "";
  if (!ok(f)) return `${what}: "${f.name}" is not supported. Only PDF and DOCX files are accepted.`;
  if (f.size > MAX_MB * 1024 * 1024) return `${what}: file is larger than ${MAX_MB} MB.`;
  if (f.size === 0) return `${what}: the file is empty.`;
  return "";
}

function FileDrop({ file, onFile, label, id }: { file: File | null; onFile: (f: File | null) => void; label: string; id: string }) {
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (e.dataTransfer.files.length > 1) return onFile(null);
        onFile(e.dataTransfer.files[0] ?? null);
      }}
      className={`rounded-xl border-2 border-dashed p-6 text-center transition ${drag ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-slate-50/50"}`}
    >
      <input id={id} ref={ref} type="file" accept=".pdf,.docx" className="sr-only" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      {file ? (
        <div className="flex items-center justify-center gap-3 text-sm">
          <FileText className="text-brand-600" size={20} />
          <div className="text-left">
            <div className="font-medium text-slate-800">{file.name}</div>
            <div className="text-xs text-slate-500">{fmtSize(file.size)}</div>
          </div>
          <button type="button" className="btn-ghost !p-1" onClick={() => { onFile(null); if (ref.current) ref.current.value = ""; }} aria-label="Remove file">
            <X size={16} />
          </button>
        </div>
      ) : (
        <label htmlFor={id} className="cursor-pointer">
          <UploadCloud className="mx-auto mb-2 text-slate-400" size={28} />
          <div className="text-sm font-medium text-slate-700">{label}</div>
          <div className="text-xs text-slate-500">Drag and drop, or click to browse · PDF or DOCX · up to {MAX_MB} MB</div>
        </label>
      )}
    </div>
  );
}

const STAGES = ["Uploading", "Parsing", "Analyzing", "Saving", "Complete"] as const;

function Progress({ stage, failed }: { stage: number; failed?: boolean }) {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label="Processing status">
      {STAGES.map((s, i) => {
        const done = i < stage || (i === stage && s === "Complete");
        const active = i === stage && s !== "Complete" && !failed;
        return (
          <li key={s} className={`flex items-center gap-1.5 rounded-full px-3 py-1 ${done ? "bg-emerald-50 text-emerald-700" : active ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-400"}`}>
            {done ? <CheckCircle2 size={14} /> : active ? <Loader2 size={14} className="animate-spin" /> : <span className="h-2 w-2 rounded-full bg-current opacity-40" />}
            {s}
          </li>
        );
      })}
    </ol>
  );
}

export default function Upload() {
  const { id: contractId } = useParams(); // present when uploading a new version
  const nav = useNavigate();
  const [mode, setMode] = useState<"file" | "text">("file");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [policyMode, setPolicyMode] = useState<"none" | "file" | "text">("none");
  const [policyFile, setPolicyFile] = useState<File | null>(null);
  const [policyText, setPolicyText] = useState("");
  const [error, setError] = useState("");
  const [stage, setStage] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ contractId: string; version: any; name: string } | null>(null);
  const [analysisFailed, setAnalysisFailed] = useState(false);
  const [contractName, setContractName] = useState("");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (contractId) api.get(`/api/contracts/${contractId}`).then((r) => setContractName(r.contract.name)).catch(() => undefined);
    return () => window.clearTimeout(timer.current);
  }, [contractId]);

  const problem = (mode === "file" ? validate(file, "Contract") : "") || (policyMode === "file" ? validate(policyFile, "Policy") : "");
  const hasContract = mode === "file" ? !!file : text.trim().length > 0;
  const canUpload = hasContract && !problem && !busy && !created;

  async function upload() {
    setError("");
    setBusy(true);
    setStage(0);
    try {
      const form = new FormData();
      if (name.trim()) form.append("name", name.trim());
      if (mode === "file" && file) form.append("contractFile", file);
      else form.append("contractText", text);
      if (policyMode === "file" && policyFile) form.append("policyFile", policyFile);
      if (policyMode === "text" && policyText.trim()) form.append("policyText", policyText);
      const pending = api.upload(contractId ? `/api/contracts/${contractId}/versions` : "/api/contracts", form);
      window.setTimeout(() => setStage((s) => (s === 0 ? 1 : s)), 350); // the server parses within this same request
      const r = await pending;
      setCreated({ contractId: contractId ?? r.contract.id, version: r.version, name: r.contract?.name ?? contractName });
      setStage(1);
    } catch (e) {
      setError(errMsg(e));
      setStage(-1);
    } finally {
      setBusy(false);
    }
  }

  async function analyze() {
    if (!created || busy) return;
    setError("");
    setAnalysisFailed(false);
    setBusy(true);
    setStage(2);
    try {
      await api.post(`/api/contracts/${created.contractId}/versions/${created.version.id}/analyze`);
      const poll = async () => {
        try {
          const r = await api.get(`/api/contracts/${created.contractId}/versions/${created.version.id}`);
          const st = r.version.extractionStatus;
          if (st === "analyzing") setStage(2);
          else if (st === "saving") setStage(3);
          else if (st === "complete") {
            setStage(4);
            setBusy(false);
            timer.current = window.setTimeout(() => nav(`/contracts/${created.contractId}`), 900);
            return;
          } else if (st === "failed") {
            setError(r.version.extractionError?.message ?? "The analysis failed. Please try again.");
            setAnalysisFailed(true);
            setBusy(false);
            return;
          }
        } catch (e) {
          setError(errMsg(e));
          setBusy(false);
          return;
        }
        timer.current = window.setTimeout(poll, 1000);
      };
      poll();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
      setStage(1);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={contractId ? "Upload New Version" : "Upload Contract"}
        subtitle={contractId ? `Adds a new version to “${contractName || "this contract"}”. Earlier versions and review decisions are kept.` : "One contract at a time. Text-based PDF, DOCX, or pasted text (no OCR)."}
      />

      {!created && (
        <div className="card space-y-6 p-5">
          {!contractId && (
            <div>
              <label className="label" htmlFor="cname">
                Contract name (optional)
              </label>
              <input id="cname" className="input" placeholder="e.g. Vendor Services Agreement" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
            </div>
          )}

          <div>
            <div className="mb-3 inline-flex rounded-lg bg-slate-100 p-1 text-sm" role="tablist">
              {([["file", "Upload file", UploadCloud], ["text", "Paste text", ClipboardPaste]] as const).map(([k, l, Icon]) => (
                <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium ${mode === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>
                  <Icon size={14} /> {l}
                </button>
              ))}
            </div>
            {mode === "file" ? (
              <FileDrop id="contract-file" file={file} onFile={setFile} label="Choose a contract file" />
            ) : (
              <>
                <textarea aria-label="Contract text" className="input min-h-56 font-mono text-xs" placeholder="Paste the full contract text here…" value={text} onChange={(e) => setText(e.target.value)} />
                <div className="mt-1 text-xs text-slate-400">{text.length.toLocaleString()} characters</div>
              </>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 p-4">
            <div className="mb-1 text-sm font-semibold text-slate-800">Organization policy (optional)</div>
            <p className="mb-3 text-xs text-slate-500">
              A short internal policy can add process context, such as an internal review lead time. It is kept separate from the contract and is not a legal authority.
            </p>
            <div className="mb-3 inline-flex rounded-lg bg-slate-100 p-1 text-sm">
              {([["none", "None"], ["file", "File"], ["text", "Paste text"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setPolicyMode(k)} className={`rounded-md px-3 py-1 font-medium ${policyMode === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>
                  {l}
                </button>
              ))}
            </div>
            {policyMode === "file" && <FileDrop id="policy-file" file={policyFile} onFile={setPolicyFile} label="Choose a policy file" />}
            {policyMode === "text" && <textarea aria-label="Policy text" className="input min-h-28 text-xs" placeholder="Paste the policy text…" value={policyText} onChange={(e) => setPolicyText(e.target.value)} />}
          </div>

          {problem && <ErrorBox message={problem} />}
          {error && <ErrorBox message={error} />}

          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <ShieldAlert size={14} /> Not legal advice. You will review every extracted item.
            </p>
            <button className="btn-primary" disabled={!canUpload} onClick={upload}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <UploadCloud size={15} />} {busy ? "Uploading…" : "Upload"}
            </button>
          </div>
          {busy && <Progress stage={stage} />}
        </div>
      )}

      {created && (
        <div className="card space-y-5 p-5">
          <div>
            <div className="mb-3 flex items-center gap-2 text-emerald-700">
              <CheckCircle2 size={18} /> <span className="font-semibold">Document uploaded and parsed</span>
            </div>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div><dt className="label !mb-0">Filename</dt><dd>{created.version.filename}</dd></div>
              <div><dt className="label !mb-0">Type</dt><dd>{SOURCE_LABEL[created.version.sourceType]}</dd></div>
              <div><dt className="label !mb-0">Size</dt><dd>{fmtSize(created.version.fileSize)}</dd></div>
              <div><dt className="label !mb-0">Uploaded</dt><dd>{fmtDateTime(created.version.uploadedAt)}</dd></div>
              <div><dt className="label !mb-0">Version</dt><dd>Version {created.version.versionNumber}</dd></div>
              <div><dt className="label !mb-0">Text found</dt><dd>{created.version.characterCount.toLocaleString()} characters · {created.version.sectionCount} sections{created.version.hasPolicy ? " · policy attached" : ""}</dd></div>
            </dl>
          </div>
          {error && <ErrorBox message={error} onRetry={analysisFailed ? analyze : undefined} />}
          {stage >= 2 && <Progress stage={stage} failed={analysisFailed} />}
          <div className="flex items-center justify-between gap-3">
            <Link to={`/contracts/${created.contractId}`} className="text-sm text-slate-500 hover:underline">
              Analyze later
            </Link>
            <button className="btn-primary" disabled={busy || stage === 4} onClick={analyze}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} {busy ? "Analyzing…" : analysisFailed ? "Retry analysis" : "Analyze Contract"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
