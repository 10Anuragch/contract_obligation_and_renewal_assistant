import { useEffect, useState } from "react";
import { AlertOctagon, FileText } from "lucide-react";
import { api, errMsg } from "../lib/api";
import { Badge, ErrorBox, Modal, Spinner } from "./ui";

function Highlighted({ text, range }: { text: string; range: { start: number; end: number } | null }) {
  if (!range) return <>{text}</>;
  return (
    <>
      {text.slice(0, range.start)}
      <mark className="rounded bg-yellow-200 px-0.5 text-slate-900">{text.slice(range.start, range.end)}</mark>
      {text.slice(range.end)}
    </>
  );
}

export default function SourceViewer({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.get(`/api/items/${itemId}/source`).then(setData).catch((e) => setError(errMsg(e)));
  }, [itemId]);

  return (
    <Modal title="Source text" onClose={onClose} wide>
      {error && <ErrorBox message={error} />}
      {!data && !error && <Spinner />}
      {data && (
        <div className="space-y-5">
          <div className="text-sm text-slate-500">
            Extracted from contract — <span className="font-medium text-slate-700">{data.item.label}</span>
          </div>
          {data.citations.map((c: any, i: number) => (
            <div key={i} className="rounded-lg border border-slate-200">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm">
                <FileText size={15} className="text-slate-400" />
                <span className="font-semibold text-slate-800">
                  {c.sectionNumber ? `Section ${c.sectionNumber}` : "Section"}
                  {c.sectionTitle ? ` — ${c.sectionTitle}` : ""}
                </span>
                <Badge tone={c.document === "policy" ? "violet" : "slate"}>{c.document === "policy" ? "Internal policy" : "Contract"}</Badge>
                <span className="text-xs text-slate-500">
                  {c.filename}
                  {c.versionNumber ? ` · version ${c.versionNumber}` : ""}
                </span>
              </div>
              <div className="p-4">
                {!c.verified && (
                  <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                    <AlertOctagon size={16} className="mt-0.5 shrink-0" />
                    <div>
                      {c.note || "The cited text could not be located in the document. Needs review."}
                      {c.quotedText && <div className="mt-2 rounded bg-white/60 p-2 text-xs italic">“{c.quotedText}”</div>}
                    </div>
                  </div>
                )}
                {c.verified && c.note && <div className="mb-3 text-xs text-amber-700">{c.note}</div>}
                {c.sectionText ? (
                  <blockquote className="whitespace-pre-wrap rounded-md border-l-4 border-slate-300 bg-slate-50 p-3 text-sm leading-relaxed text-slate-700">
                    <Highlighted text={c.sectionText} range={c.highlight} />
                  </blockquote>
                ) : (
                  c.verified && <div className="text-sm text-slate-500">“{c.quotedText}”</div>
                )}
              </div>
            </div>
          ))}
          <p className="text-xs text-slate-400">The highlighted passage is the exact text the extracted item is based on. Review it against the original document.</p>
        </div>
      )}
    </Modal>
  );
}
