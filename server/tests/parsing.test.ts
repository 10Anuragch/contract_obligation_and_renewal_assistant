import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePastedText, parseUploadedFile, sanitizeFilename, normalizeText } from "../src/services/documentParser.js";
import { splitSections } from "../src/services/sections.js";
import { locateQuote, validateSource } from "../src/services/citation.js";
import { buildDocx, buildPdf } from "../src/utils/buildDocs.js";

const fixture = (n: string) => fs.readFileSync(path.resolve(__dirname, "../../fixtures", n), "utf8");
const TEXT = fixture("sample-vendor-agreement.txt");

describe("document parsing", () => {
  it("parses a text PDF", async () => {
    const doc = await parseUploadedFile(await buildPdf(TEXT), "a.pdf");
    expect(doc.sourceType).toBe("pdf");
    expect(doc.text).toContain("sixty (60) days");
  });
  it("parses a DOCX", async () => {
    const doc = await parseUploadedFile(await buildDocx(TEXT), "a.docx");
    expect(doc.sourceType).toBe("docx");
    expect(doc.text).toContain("2.2 Automatic Renewal");
  });
  it("accepts pasted text", () => {
    expect(parsePastedText(TEXT).sourceType).toBe("text");
  });
  it("rejects unsupported, spoofed, corrupt and empty input with clear errors", async () => {
    await expect(parseUploadedFile(Buffer.from("hello"), "a.exe")).rejects.toMatchObject({ code: "UNSUPPORTED_FILE" });
    await expect(parseUploadedFile(Buffer.from("not a pdf at all"), "a.pdf")).rejects.toMatchObject({ code: "UNSUPPORTED_FILE" });
    await expect(parseUploadedFile(Buffer.from("%PDF-1.4 garbage garbage"), "a.pdf")).rejects.toMatchObject({ code: "PDF_PARSE_FAILED" });
    await expect(parseUploadedFile(Buffer.from("PK\u0003\u0004 garbage garbage"), "a.docx")).rejects.toMatchObject({ code: "DOCX_PARSE_FAILED" });
    expect(() => parsePastedText("   ")).toThrowError(/No readable text/);
  });
  it("sanitizes filenames", () => {
    expect(sanitizeFilename("../../etc/pass wd<script>.pdf")).toBe("pass wd_script_.pdf");
  });
  it("normalizes whitespace", () => {
    expect(normalizeText("a  b\r\n\r\n\r\n\r\nc d")).toBe("a b\n\nc d");
  });
});

describe("sections", () => {
  const sections = splitSections(normalizeText(TEXT));
  it("preserves explicit numbers, headings and exact offsets", () => {
    const s = sections.find((x) => x.sectionNumber === "2.2")!;
    expect(s.heading).toBe("Automatic Renewal");
    const text = normalizeText(TEXT);
    expect(text.slice(s.startIndex, s.endIndex)).toBe(s.text);
  });
  it("falls back to paragraphs when there is no numbering", () => {
    const s = splitSections("First paragraph here.\n\nSecond paragraph here.");
    expect(s.map((x) => x.sectionNumber)).toEqual(["¶1", "¶2"]);
  });
});

describe("citation validation", () => {
  const text = normalizeText(TEXT);
  const sections = splitSections(text);
  it("verifies exact quotes and corrects the section label from the real location", () => {
    const v = validateSource({ sectionNumber: "9.9", sectionTitle: "Fake", exactText: "at least sixty (60) days before the end" }, text, sections);
    expect(v.verified).toBe(true);
    expect(v.sectionNumber).toBe("2.2");
    expect(v.note).toMatch(/corrected/);
    expect(text.slice(v.startIndex!, v.endIndex!)).toBe(v.exactText);
  });
  it("tolerates whitespace/quote differences but not different words", () => {
    expect(locateQuote(text, "Customer   shall\npay Supplier a monthly fee")).not.toBeNull();
    expect(locateQuote(text, "Customer shall pay Supplier a weekly fee")).toBeNull();
  });
  it("flags invented citations as unverified", () => {
    const v = validateSource({ sectionNumber: "2.2", sectionTitle: "", exactText: "This text never appears in the contract." }, text, sections);
    expect(v.verified).toBe(false);
    expect(v.startIndex).toBeNull();
  });
});
