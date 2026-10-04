import path from "node:path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { config } from "../config.js";
import { Errors } from "../utils/errors.js";

export type SourceType = "pdf" | "docx" | "text";

export interface ParsedDocument {
  sourceType: SourceType;
  text: string; // normalized
  filename: string;
}

/** Strip path components and anything that is not a safe filename character. */
export function sanitizeFilename(name: string): string {
  const base = path.basename(String(name || "").replace(/\\/g, "/"));
  const cleaned = base.replace(/[^\w.\- ()]+/g, "_").replace(/^\.+/, "").trim();
  return (cleaned || "document").slice(0, 120);
}

/**
 * Normalize extracted text. Offsets used for citations always refer to THIS normalized text,
 * which is the exact text that is stored and shown in the source viewer.
 */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[​‌‍﻿]/g, "")
    .replace(/\f/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function detectFileType(buffer: Buffer, filename: string, mimetype?: string): "pdf" | "docx" {
  const ext = path.extname(filename).toLowerCase();
  const isPdfMagic = buffer.subarray(0, 5).toString("latin1") === "%PDF-";
  const isZipMagic = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (ext === ".pdf") {
    if (!isPdfMagic) throw Errors.unsupportedFile("This file has a .pdf extension but is not a valid PDF.");
    return "pdf";
  }
  if (ext === ".docx") {
    if (!isZipMagic) throw Errors.unsupportedFile("This file has a .docx extension but is not a valid DOCX document.");
    return "docx";
  }
  throw Errors.unsupportedFile(
    `Unsupported file type "${ext || mimetype || "unknown"}". Only PDF and DOCX files are supported.`,
  );
}

async function parsePdf(buffer: Buffer): Promise<string> {
  let parser: PDFParse | undefined;
  try {
    parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    return result.text ?? "";
  } catch {
    throw Errors.pdfParse();
  } finally {
    try {
      await parser?.destroy();
    } catch {
      /* ignore */
    }
  }
}

async function parseDocx(buffer: Buffer): Promise<string> {
  try {
    // Raw text keeps one paragraph per block (headings included) separated by blank lines.
    const result = await mammoth.extractRawText({ buffer });
    return result.value ?? "";
  } catch {
    throw Errors.docxParse();
  }
}

function finalize(text: string): string {
  const normalized = normalizeText(text);
  if (normalized.length < config.minDocumentChars) throw Errors.emptyDocument();
  if (normalized.length > config.maxDocumentChars) throw Errors.documentTooLong(config.maxDocumentChars);
  return normalized;
}

export async function parseUploadedFile(buffer: Buffer, filename: string, mimetype?: string): Promise<ParsedDocument> {
  const safeName = sanitizeFilename(filename);
  const type = detectFileType(buffer, safeName, mimetype);
  const raw = type === "pdf" ? await parsePdf(buffer) : await parseDocx(buffer);
  return { sourceType: type, text: finalize(raw), filename: safeName };
}

export function parsePastedText(text: string, filename = "Pasted text"): ParsedDocument {
  return { sourceType: "text", text: finalize(String(text ?? "")), filename };
}
