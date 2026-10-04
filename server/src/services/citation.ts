/**
 * Server-side citation validation. The AI proposes a source quote; this code verifies it really exists in the
 * parsed document and records the true location. The AI's section label is never trusted over the real location.
 */
import { findSectionAt, type Section } from "./sections.js";

export interface RawSource {
  sectionNumber?: string | null;
  sectionTitle?: string | null;
  exactText?: string | null;
}

export interface ValidatedSource {
  sectionNumber: string;
  sectionTitle: string;
  exactText: string;
  startIndex: number | null;
  endIndex: number | null;
  /** true only when exactText was found in the document text. */
  verified: boolean;
  /** how the match was made: exact | normalized | none */
  matchType: "exact" | "normalized" | "none";
  /** Present when the AI's claimed section differs from the real one. */
  note?: string;
}

/** One-to-one character folding so offsets stay valid (same length as the input). */
function fold(s: string): string {
  return s
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/ /g, " ");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Locate a quote in the document. Returns [start,end) offsets into `documentText`. */
export function locateQuote(
  documentText: string,
  quote: string,
): { start: number; end: number; matchType: "exact" | "normalized" } | null {
  const q = (quote ?? "").trim();
  if (q.length < 3) return null;

  const direct = documentText.indexOf(q);
  if (direct >= 0) return { start: direct, end: direct + q.length, matchType: "exact" };

  // Tolerate differences in whitespace, curly quotes, dashes and case — never in the words themselves.
  const foldedDoc = fold(documentText);
  const words = fold(q).split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (words.length === 0) return null;
  try {
    const re = new RegExp(words.join("\\s+"), "i");
    const m = re.exec(foldedDoc);
    if (m) return { start: m.index, end: m.index + m[0].length, matchType: "normalized" };
  } catch {
    /* fall through */
  }
  return null;
}

export function validateSource(raw: RawSource | null | undefined, documentText: string, sections: Section[]): ValidatedSource {
  const claimedNumber = (raw?.sectionNumber ?? "").toString().trim();
  const claimedTitle = (raw?.sectionTitle ?? "").toString().trim();
  const quote = (raw?.exactText ?? "").toString().trim();

  const loc = quote ? locateQuote(documentText, quote) : null;
  if (!loc) {
    return {
      sectionNumber: claimedNumber,
      sectionTitle: claimedTitle,
      exactText: quote,
      startIndex: null,
      endIndex: null,
      verified: false,
      matchType: "none",
      note: quote
        ? "The quoted text could not be found in the document. Check the contract manually."
        : "No source text was provided for this item.",
    };
  }

  const section = findSectionAt(sections, loc.start);
  const realNumber = section?.sectionNumber ?? "";
  const realTitle = section?.heading ?? "";
  let note: string | undefined;
  if (claimedNumber && realNumber && claimedNumber.replace(/^(section|clause|article)\s+/i, "") !== realNumber) {
    note = `Section label corrected from "${claimedNumber}" to "${realNumber}" based on where the quoted text actually appears.`;
  }
  return {
    sectionNumber: realNumber || claimedNumber,
    sectionTitle: realTitle || claimedTitle,
    // Store the document's own wording (so the viewer can highlight it exactly).
    exactText: documentText.slice(loc.start, loc.end),
    startIndex: loc.start,
    endIndex: loc.end,
    verified: true,
    matchType: loc.matchType,
    note,
  };
}
