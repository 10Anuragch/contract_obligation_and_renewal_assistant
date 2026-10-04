import { createHash } from "node:crypto";

export interface Section {
  sectionId: string;
  sectionNumber: string; // "" when the contract has no explicit number for this block
  heading: string;
  text: string; // full text of the section including its heading line
  startIndex: number; // offsets into the normalized document text
  endIndex: number;
}

// "4.2 Term and Renewal", "Section 4.2. Term", "ARTICLE 4 – TERM", "(a) ..." is NOT treated as a section.
const NUMBERED_LINE =
  /^(?:(?:section|article|clause)\s+)?(\d{1,3}(?:\.\d{1,3}){0,4})[.):]?\s+(\S.*)$/i;

/** A numbered line is a heading if it is short and does not read like a sentence. */
function splitHeading(rest: string): { heading: string; inlineBody: string } {
  const trimmed = rest.trim();
  // "Term and Renewal. This Agreement shall..." -> heading before first ". " when short
  const dot = trimmed.match(/^([A-Z][^.:]{2,70})[.:]\s+(\S.*)$/);
  if (dot) return { heading: dot[1].trim(), inlineBody: dot[2] };
  if (trimmed.length <= 80 && !/[.;,]$/.test(trimmed)) return { heading: trimmed, inlineBody: "" };
  return { heading: "", inlineBody: trimmed };
}

/**
 * Split normalized text into sections, preserving explicit numbering and exact offsets.
 * Falls back to paragraph blocks ("¶1", "¶2", …) when the document has no numbered sections.
 */
export function splitSections(text: string): Section[] {
  const lines: { text: string; start: number }[] = [];
  let pos = 0;
  for (const line of text.split("\n")) {
    lines.push({ text: line, start: pos });
    pos += line.length + 1;
  }

  type Mark = { start: number; number: string; heading: string };
  const marks: Mark[] = [];
  for (const l of lines) {
    const m = NUMBERED_LINE.exec(l.text.trim());
    if (!m) continue;
    // Skip lines that are clearly list items inside text such as "30 days after..." (very short number at line start with lowercase continuation)
    const num = m[1];
    const rest = m[2];
    if (!num.includes(".") && /^[a-z]/.test(rest) && !/^section|article|clause/i.test(l.text)) continue;
    const { heading } = splitHeading(rest);
    marks.push({ start: l.start, number: num, heading });
  }

  const sections: Section[] = [];
  const push = (start: number, end: number, number: string, heading: string) => {
    const body = text.slice(start, end).replace(/\s+$/, "");
    if (!body.trim()) return;
    const idx = sections.length + 1;
    sections.push({
      sectionId: `s${idx}`,
      sectionNumber: number,
      heading,
      text: body,
      startIndex: start,
      endIndex: start + body.length,
    });
  };

  if (marks.length >= 2) {
    if (marks[0].start > 0) push(0, marks[0].start, "", "Preamble");
    marks.forEach((mk, i) => push(mk.start, i + 1 < marks.length ? marks[i + 1].start : text.length, mk.number, mk.heading));
    return sections;
  }

  // Fallback: paragraph blocks.
  const re = /\n{2,}/g;
  let last = 0;
  let n = 0;
  let m: RegExpExecArray | null;
  const blocks: [number, number][] = [];
  while ((m = re.exec(text))) {
    blocks.push([last, m.index]);
    last = m.index + m[0].length;
  }
  blocks.push([last, text.length]);
  for (const [s, e] of blocks) {
    if (!text.slice(s, e).trim()) continue;
    n += 1;
    const firstLine = text.slice(s, e).split("\n")[0];
    push(s, e, `¶${n}`, firstLine.length <= 70 ? firstLine : "");
  }
  return sections;
}

export function findSectionAt(sections: Section[], index: number): Section | undefined {
  return sections.find((s) => index >= s.startIndex && index < s.endIndex) ??
    sections.find((s) => index === s.endIndex);
}

export function hashText(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}
