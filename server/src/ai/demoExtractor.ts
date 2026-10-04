/**
 * OFFLINE DEMO EXTRACTOR — keyword/regex heuristics, no AI and no network.
 * Exists only so the UI can be tried without an OpenAI key (AI_PROVIDER=demo). It is tuned for the bundled sample
 * contracts and is far less capable than the real AI extractor. Output goes through the same validation pipeline.
 */
import type { AiExtractor } from "./types.js";
import type { Extraction, PolicyAnalysis } from "./schema.js";

type Src = { sectionNumber: string; sectionTitle: string; exactText: string };
type Sentence = Src;
interface Block {
  sectionNumber: string;
  sectionTitle: string;
  text: string;
}

const WORD_NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12,
  fifteen: 15, twenty: 20, thirty: 30, forty: 40, "forty-five": 45, sixty: 60, ninety: 90,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, tenth: 10, fifteenth: 15, last: 28,
};
const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];

const CLAUSE_START = /^(\d{1,3}(?:\.\d{1,3})*)[.)]?\s+(.*)$/;

/**
 * Group raw lines into logical paragraphs. PDFs wrap lines mid-sentence, so continuation lines are joined with a
 * space. (Quotes built from joined text still match the document: citation validation ignores whitespace differences.)
 */
function blocksOf(text: string): Block[] {
  const blocks: Block[] = [];
  let cur: Block | null = null;
  let sectionNumber = "";
  let sectionTitle = "";
  let prevBlank = true;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) {
      prevBlank = true;
      continue;
    }
    const m = CLAUSE_START.exec(t);
    // "30 days after..." wrapped onto a new line is a continuation, not a clause number.
    const isClause = !!m && (m[1].includes(".") || !/^[a-z]/.test(m[2]));
    if (isClause && m) {
      sectionNumber = m[1];
      const heading = /^([A-Z][^.]{2,60})\.\s/.exec(m[2]);
      if (heading) sectionTitle = heading[1];
      else if (m[2].length <= 70 && !/[.;]$/.test(m[2])) sectionTitle = m[2];
      cur = { sectionNumber, sectionTitle, text: m[2] };
      blocks.push(cur);
    } else if (prevBlank || !cur) {
      cur = { sectionNumber, sectionTitle, text: t };
      blocks.push(cur);
    } else {
      cur.text += " " + t;
    }
    prevBlank = false;
  }
  return blocks;
}

function sentencesOf(text: string): Sentence[] {
  const out: Sentence[] = [];
  for (const b of blocksOf(text)) {
    const re = /[^.;]+(?:\([^)]*\)[^.;]*)*[.;]?/g;
    let s: RegExpExecArray | null;
    while ((s = re.exec(b.text))) {
      const piece = s[0].trim();
      if (piece.length < 15) continue;
      out.push({ sectionNumber: b.sectionNumber, sectionTitle: b.sectionTitle, exactText: piece });
    }
  }
  return out;
}

const ordinal = (token: string): number | null => {
  const t = token.toLowerCase();
  if (/^\d+/.test(t)) return parseInt(t, 10);
  return WORD_NUM[t] ?? null;
};

function period(s: string): { value: number | null; unit: string | null; dayType: "calendar" | "business" | "unspecified" } {
  const all = [...s.matchAll(/\((\d+)\)\s*(business days?|calendar days?|days?|weeks?|months?|years?)/gi)];
  // Prefer the number that is introduced like a notice/cure period ("at least sixty (60) days", "within thirty (30) days").
  const m =
    all.find((x) => /(at least|within|upon|giving|notice of|prior to|not less than)\s+(\w+\s+){0,2}$/i.test(s.slice(Math.max(0, (x.index ?? 0) - 30), x.index))) ??
    all[0] ??
    /\b(\d+)\s*(business days?|calendar days?|days?|weeks?|months?|years?)\b/i.exec(s);
  if (!m) return { value: null, unit: null, dayType: "unspecified" };
  const raw = m[2].toLowerCase();
  const business = raw.startsWith("business");
  const calendar = raw.startsWith("calendar");
  const unit = business ? "business days" : raw.replace(/^calendar /, "").replace(/s?$/, "s");
  return { value: Number(m[1]), unit, dayType: business ? "business" : calendar ? "calendar" : "unspecified" };
}

function actor(s: string): string {
  const m = /\b(Either party|Each party|Customer|Supplier|Vendor|Client|Company|Licensor|Licensee)\b(?=[^.]{0,40}\b(?:shall|may|must|will)\b)/.exec(s);
  return m ? m[1] : "Unclear";
}

const src = (s: Sentence): Src => ({ sectionNumber: s.sectionNumber, sectionTitle: s.sectionTitle, exactText: s.exactText });

export class DemoExtractor implements AiExtractor {
  readonly name = "demo";

  async extractContract(text: string): Promise<Extraction> {
    const sents = sentencesOf(text);
    const out: Extraction = {
      parties: [], effectiveDate: null, expiry: null, renewal: null,
      termination: [], noticeClauses: [], obligations: [], ambiguities: [], conflicts: [],
    };

    // Parties + effective date from the preamble ("by and between X ("Customer") and Y ("Supplier")")
    const preBlock = blocksOf(text).find((b) => /by and between/i.test(b.text));
    const preQuote = (preBlock?.text ?? "").replace(/^[\s\S]*?(?=\bThis\s)/, "");
    const pre = /between\s+(.+?)\s*\([^)]*?["“]([^"”]+)["”][^)]*\)\s*,?\s*and\s+(.+?)\s*\([^)]*?["“]([^"”]+)["”][^)]*\)/is.exec(preQuote);
    if (pre && preQuote) {
      const nm = (raw: string) => raw.replace(/,\s+(a|an)\s.*$/is, "").replace(/\s+/g, " ").trim();
      for (const [name, role] of [[pre[1], pre[2]], [pre[3], pre[4]]] as const) {
        out.parties.push({
          name: nm(name), role, confidence: "confirmed",
          source: { sectionNumber: "", sectionTitle: "Preamble", exactText: preQuote },
        });
      }
    }
    const eff = /(?:as of|effective(?: date)?(?: of)?|dated)\s+([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})/.exec(preQuote);
    if (eff) {
      const mi = MONTHS.indexOf(eff[1].toLowerCase());
      if (mi >= 0) {
        out.effectiveDate = {
          value: `${eff[3]}-${String(mi + 1).padStart(2, "0")}-${String(Number(eff[2])).padStart(2, "0")}`,
          displayValue: `${eff[1]} ${eff[2]}, ${eff[3]}`,
          confidence: "confirmed",
          reason: "An explicit calendar date is stated in the opening paragraph.",
          source: { sectionNumber: "", sectionTitle: "Preamble", exactText: preQuote },
        };
      }
    }

    for (const s of sents) {
      const t = s.exactText;

      // Term / expiry
      const term = /(?:initial )?term of\s+(\w+)\s*\((\d+)\)\s*(years?|months?)/i.exec(t);
      if (term && !out.expiry) {
        out.expiry = {
          value: null, displayValue: `${term[2]} ${term[3]} from the Effective Date`,
          termValue: Number(term[2]), termUnit: term[3].toLowerCase().replace(/s?$/, "s"),
          description: `Initial term of ${term[2]} ${term[3]}.`,
          confidence: "uncertain",
          reason: "The contract states a term length but no explicit end date; the end date must be derived from the effective date.",
          source: src(s),
        };
      }
      const explicitEnd = /expire[s]? on\s+([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})/i.exec(t);
      if (explicitEnd) {
        const mi = MONTHS.indexOf(explicitEnd[1].toLowerCase());
        if (mi >= 0)
          out.expiry = {
            value: `${explicitEnd[3]}-${String(mi + 1).padStart(2, "0")}-${String(Number(explicitEnd[2])).padStart(2, "0")}`,
            displayValue: `${explicitEnd[1]} ${explicitEnd[2]}, ${explicitEnd[3]}`, termValue: null, termUnit: null,
            description: "Explicit expiry date stated.", confidence: "confirmed", reason: "Explicit calendar date in the contract.", source: src(s),
          };
      }

      // Renewal
      if (/automatically renew|auto-?renew/i.test(t) && !out.renewal) {
        const rt = /terms? of\s+(\w+)\s*\((\d+)\)\s*(years?|months?)/i.exec(t) ?? /(\w+)\s*\((\d+)\)\s*(year|month)s?\s+each/i.exec(t);
        out.renewal = {
          type: "automatic",
          term: rt ? `successive terms of ${rt[2]} ${rt[3]}` : "",
          termValue: rt ? Number(rt[2]) : null,
          termUnit: rt ? rt[3].toLowerCase().replace(/s?$/, "s") : null,
          description: "The agreement renews automatically unless a notice is given.",
          confidence: "confirmed", reason: "Automatic renewal is stated explicitly.", source: src(s),
        };
      }

      // Notice clauses
      if (/notice/i.test(t) && /\(\d+\)\s*(business |calendar )?(days?|weeks?|months?)|\b\d+\s*(business |calendar )?(days?|weeks?|months?)/i.test(t)) {
        const p = period(t);
        const type = /non-?renewal|renew/i.test(t) ? "renewal" : /terminat/i.test(t) ? "termination" : "other";
        out.noticeClauses.push({
          type, noticePeriodValue: p.value, noticePeriodUnit: p.unit, dayType: p.dayType, responsibleParty: actor(t),
          description: t.length > 160 ? t.slice(0, 157) + "…" : t,
          confidence: p.dayType === "business" ? "uncertain" : "confirmed", source: src(s),
        });
      }

      // Termination
      if (/\bterminate\b/i.test(t) && /\b(may|shall|can)\b/i.test(t)) {
        const p = period(t);
        const vague = /reasonable|appropriate|prompt/i.test(t);
        out.termination.push({
          description: t.length > 200 ? t.slice(0, 197) + "…" : t,
          responsibleParty: /either party/i.test(t) ? "Either party" : actor(t),
          noticePeriodValue: p.value, noticePeriodUnit: p.unit,
          confidence: vague ? "uncertain" : "confirmed", source: src(s),
        });
      }

      // Obligations
      const isTermination = /\bterminat/i.test(t) || /automatically renew|notice of non-?renewal/i.test(t);
      if (/\b(shall|must)\b/i.test(t) && !isTermination && /(report|pay|invoice|deliver|designate|provide|submit|maintain|notify|respond)/i.test(t)) {
        const rec = /(?:by|on)\s+the\s+([\w-]+)(?:\s+day)?\s+(?:of\s+)?(?:each|every)\s+month/i.exec(t);
        const dom = rec ? ordinal(rec[1]) : null;
        const rel = /within\s+\w+\s*\((\d+)\)\s*(days?|weeks?|months?)\s+(?:after|following|of)\s+the\s+Effective Date/i.exec(t);
        const freq = /each month|every month|monthly/i.test(t) ? "monthly" : /annual|each year|yearly/i.test(t) ? "annually" : "";
        const vague = /promptly|reasonable|as soon as|from time to time/i.test(t);
        out.obligations.push({
          description: t.length > 220 ? t.slice(0, 217) + "…" : t,
          responsibleParty: actor(t),
          deadline: (rec ? rec[0] : rel ? rel[0] : /within\s+\w+\s*\(\d+\)\s*\w+[^.;,]*/i.exec(t)?.[0]) ?? "",
          frequency: freq,
          dueDate: null,
          relative: rel ? { value: Number(rel[1]), unit: rel[2].toLowerCase().replace(/s?$/, "s"), anchor: "effectiveDate", direction: "after" } : null,
          recurrence: dom || freq === "monthly"
            ? { type: freq === "monthly" || rec ? "monthly" : "none", dayOfMonth: dom, month: null }
            : null,
          confidence: vague || actor(t) === "Unclear" ? "uncertain" : "confirmed",
          source: src(s),
        });
      }

      // Ambiguities
      const vagueMatch = /\b(reasonable (?:notice|time|period)|promptly|as soon as (?:practicable|possible)|from time to time|appropriate notice)\b/i.exec(t);
      if (vagueMatch) {
        out.ambiguities.push({
          description: `The clause uses the vague term "${vagueMatch[1]}".`,
          whyAmbiguous: "No specific period or measurable criterion is stated, so a calendar date cannot be determined from this wording.",
          relatedItems: [], source: src(s),
          clarificationQuestion: /notice/i.test(vagueMatch[1])
            ? "What notice period should be recorded for this clause?"
            : "What specific timeframe should be recorded for this requirement?",
        });
      }
      if (/business days?/i.test(t) && !/means|defined/i.test(t)) {
        out.ambiguities.push({
          description: "The clause counts time in business days.",
          whyAmbiguous: "The contract text reviewed does not define which days count as business days (for example, which holidays apply), so an exact date cannot be derived.",
          relatedItems: [], source: src(s),
          clarificationQuestion: "Which calendar of business days applies to this clause?",
        });
      }
    }

    // Conflict: two renewal-notice clauses with different periods.
    const renewalNotices = out.noticeClauses.filter((n) => n.type === "renewal" && n.noticePeriodValue !== null);
    const distinct = new Set(renewalNotices.map((n) => `${n.noticePeriodValue}-${n.noticePeriodUnit}`));
    if (distinct.size > 1) {
      out.conflicts.push({
        description: "Different notice periods are stated for renewal notices.",
        sections: renewalNotices.map((n) => n.source.sectionNumber),
        sourceReferences: renewalNotices.map((n) => n.source),
      });
    }
    return out;
  }

  async analyzePolicy(contractText: string, policyText: string): Promise<PolicyAnalysis> {
    const cs = sentencesOf(contractText).find((s) => /notice/i.test(s.exactText) && /renew/i.test(s.exactText));
    const ps = sentencesOf(policyText).find((s) => /renewal/i.test(s.exactText) && /\b\d+\b/.test(s.exactText));
    if (!cs || !ps) return { policyNotes: [] };
    const cp = period(cs.exactText);
    const pp = /(\d+)[- ]days?/i.exec(ps.exactText) ?? /\((\d+)\)\s*days/i.exec(ps.exactText);
    return {
      policyNotes: [
        {
          description: "The internal policy mentions a review lead time that relates to the contract's renewal notice.",
          relatesTo: "renewal_notice",
          contractRequirement: cp.value ? `${cp.value} ${cp.unit} renewal notice` : "Renewal notice requirement",
          internalPolicyStatement: pp ? `${pp[1]}-day internal renewal review` : "Internal renewal review",
          policyLeadValue: pp ? Number(pp[1]) : null,
          policyLeadUnit: pp ? "days" : null,
          clarificationQuestion: "Should the internal review date be tracked alongside the contract notice deadline?",
          confidence: "confirmed",
          contractSource: { sectionNumber: cs.sectionNumber, sectionTitle: cs.sectionTitle, exactText: cs.exactText },
          policySource: { sectionNumber: ps.sectionNumber, sectionTitle: ps.sectionTitle, exactText: ps.exactText },
        },
      ],
    };
  }
}
