/** Application error with a stable machine code and a message that is safe to show in the UI. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const Errors = {
  unsupportedFile: (detail = "Only PDF and DOCX files are supported.") =>
    new AppError(415, "UNSUPPORTED_FILE", detail),
  fileTooLarge: (mb: number) => new AppError(413, "FILE_TOO_LARGE", `File is too large. The limit is ${mb} MB.`),
  tooManyFiles: () =>
    new AppError(400, "TOO_MANY_FILES", "Only one contract file can be uploaded at a time (plus an optional policy file)."),
  emptyDocument: () =>
    new AppError(
      422,
      "EMPTY_DOCUMENT",
      "No readable text was found in this document. Scanned or image-only PDFs need OCR, which is not supported.",
    ),
  documentTooLong: (max: number) =>
    new AppError(422, "DOCUMENT_TOO_LONG", `This document is too long to analyze (limit: ${max.toLocaleString()} characters).`),
  pdfParse: () =>
    new AppError(422, "PDF_PARSE_FAILED", "The PDF could not be read. It may be corrupted, encrypted, or image-only."),
  docxParse: () =>
    new AppError(422, "DOCX_PARSE_FAILED", "The DOCX file could not be read. It may be corrupted or password protected."),
  notFound: (what: string) => new AppError(404, "NOT_FOUND", `${what} was not found.`),
  badRequest: (message: string, details?: unknown) => new AppError(400, "BAD_REQUEST", message, details),
  conflict: (message: string) => new AppError(409, "CONFLICT", message),
  aiUnavailable: (message = "The AI service is currently unavailable. Please try again later.") =>
    new AppError(502, "AI_UNAVAILABLE", message),
  aiNotConfigured: () =>
    new AppError(
      503,
      "AI_NOT_CONFIGURED",
      "No AI provider is configured. Set OPENAI_API_KEY (or AI_PROVIDER=demo for the offline demo extractor) and restart the server.",
    ),
  aiMalformed: () =>
    new AppError(
      502,
      "AI_MALFORMED_RESPONSE",
      "The AI service returned a response that did not match the expected format. Please retry the analysis.",
    ),
  database: () => new AppError(503, "DATABASE_UNAVAILABLE", "The database is currently unavailable. Please try again shortly."),
  dateUnavailable: () =>
    new AppError(422, "DATE_CALCULATION_UNAVAILABLE", "Reminder date cannot be calculated until this item is clarified."),
  versionComparison: () =>
    new AppError(500, "VERSION_COMPARISON_FAILED", "The new version was saved, but comparing it with the previous version failed. Items were not marked stale — please review them manually."),
};
