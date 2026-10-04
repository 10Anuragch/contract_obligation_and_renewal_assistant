import dotenv from "dotenv";
import path from "node:path";

// Load the repo-root .env first, then a server-local .env (if any) as an override.
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: int("PORT", 5000),
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/contract_assistant",
  clientOrigin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-2024-08-06",
  /** "openai" (default) or "demo" (offline heuristic extractor for trying the UI without an API key). */
  aiProvider: (process.env.AI_PROVIDER || (process.env.OPENAI_API_KEY ? "openai" : "none")).toLowerCase(),
  maxUploadBytes: int("MAX_UPLOAD_MB", 10) * 1024 * 1024,
  maxDocumentChars: int("MAX_DOCUMENT_CHARS", 150_000),
  minDocumentChars: 40,
  /** A deadline within this many days (and not yet past) is "Due Soon". */
  dueSoonDays: int("DUE_SOON_DAYS", 30),
  /** Window used by the dashboard for "upcoming" counts. */
  upcomingWindowDays: int("UPCOMING_WINDOW_DAYS", 90),
  /** Reminder = due date minus this many days. */
  obligationReminderLeadDays: int("OBLIGATION_REMINDER_LEAD_DAYS", 7),
  noticeReminderLeadDays: int("NOTICE_REMINDER_LEAD_DAYS", 14),
};

export type AiProvider = "openai" | "demo" | "none";
