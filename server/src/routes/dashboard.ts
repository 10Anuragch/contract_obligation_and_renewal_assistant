import { Router, type Request } from "express";
import mongoose from "mongoose";
import { Contract, ContractVersion } from "../models/index.js";
import { wrap } from "../middleware/errors.js";
import { loadPortfolio } from "../services/portfolio.js";
import { addDuration, isValidISODate, todayISO } from "../services/dates.js";
import { aiStatus } from "../ai/provider.js";
import { config } from "../config.js";

export const dashboardRouter = Router();

/** `?today=YYYY-MM-DD` lets tests and demos pin the comparison date; defaults to the real current date. */
export function resolveToday(req: Request): string {
  const q = req.query.today;
  return typeof q === "string" && isValidISODate(q) ? q : todayISO();
}

dashboardRouter.get(
  "/health",
  wrap(async (_req, res) => {
    const ai = aiStatus();
    res.json({
      ok: true,
      database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
      ai: { provider: ai.provider, configured: ai.configured, model: ai.provider === "openai" ? config.openaiModel : null },
      limits: { maxUploadMb: Math.round(config.maxUploadBytes / 1024 / 1024), maxDocumentChars: config.maxDocumentChars },
      settings: {
        dueSoonDays: config.dueSoonDays,
        upcomingWindowDays: config.upcomingWindowDays,
        obligationReminderLeadDays: config.obligationReminderLeadDays,
        noticeReminderLeadDays: config.noticeReminderLeadDays,
      },
    });
  }),
);

dashboardRouter.get(
  "/dashboard",
  wrap(async (req, res) => {
    const today = resolveToday(req);
    const windowEnd = addDuration(today, config.upcomingWindowDays, "days")!;
    const entries = await loadPortfolio(today);

    const live = entries.flatMap((e) => e.rows.filter((r) => r.reviewStatus !== "rejected"));
    const dated = live.filter((r) => r.dueDate).sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : 0));
    const inWindow = (r: { dueDate: string | null }) => !!r.dueDate && r.dueDate >= today && r.dueDate <= windowEnd;

    const upcomingObligations = dated.filter((r) => r.kind === "obligation" && inWindow(r)).length;
    const overdue = dated.filter((r) => r.kind !== "expiry" && r.timeStatus === "overdue").length;
    const renewalDeadlines = entries.filter((e) => e.card?.noticeDeadline && inWindow({ dueDate: e.card.noticeDeadline })).length;
    const countItems = (status: string) => entries.reduce((n, e) => n + e.items.filter((i) => i.reviewStatus === status).length, 0);

    const recent: any[] = await ContractVersion.find({}, "contractId versionNumber filename uploadedAt extractionStatus sourceType")
      .sort({ uploadedAt: -1 })
      .limit(6)
      .lean();
    const names = new Map<string, string>(
      (await Contract.find({ _id: { $in: recent.map((v) => v.contractId) } }, "name").lean()).map((c: any) => [String(c._id), c.name]),
    );

    res.json({
      today,
      cards: {
        contracts: entries.length,
        needsReview: entries.filter((e) => e.items.some((i) => i.reviewStatus === "pending" || i.reviewStatus === "stale")).length,
        awaitingAnalysis: entries.filter((e) => e.currentVersion && e.currentVersion.extractionStatus !== "complete").length,
        upcomingObligations,
        overdue,
        renewalDeadlines,
        potentiallyStale: countItems("stale"),
      },
      windowDays: config.upcomingWindowDays,
      deadlines: dated.slice(0, 12),
      recentVersions: recent.map((v) => ({
        id: String(v._id),
        contractId: String(v.contractId),
        contractName: names.get(String(v.contractId)) ?? "Contract",
        versionNumber: v.versionNumber,
        filename: v.filename,
        uploadedAt: v.uploadedAt,
        extractionStatus: v.extractionStatus,
      })),
    });
  }),
);

/** Obligations (and other dated items) with filtering/sorting. */
dashboardRouter.get(
  "/obligations",
  wrap(async (req, res) => {
    const today = resolveToday(req);
    const q = req.query;
    const entries = await loadPortfolio(today);
    let rows = entries.flatMap((e) => e.rows).filter((r) => r.kind === "obligation");
    if (q.includeRejected !== "true") rows = rows.filter((r) => r.reviewStatus !== "rejected");

    const contracts = entries.map((e) => ({ id: String(e.contract._id), name: e.contract.name }));
    const parties = [...new Set(rows.map((r) => r.responsibleParty))].sort();

    if (typeof q.status === "string" && q.status) rows = rows.filter((r) => r.timeStatus === q.status);
    if (typeof q.contractId === "string" && q.contractId) rows = rows.filter((r) => r.contractId === q.contractId);
    if (typeof q.party === "string" && q.party) rows = rows.filter((r) => r.responsibleParty.toLowerCase() === q.party!.toString().toLowerCase());
    if (q.hasDate === "true") rows = rows.filter((r) => r.dueDate);

    const sort = typeof q.sort === "string" ? q.sort : "due";
    const dir = q.dir === "desc" ? -1 : 1;
    const cmp = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1);
    rows.sort((a, b) => {
      const k =
        sort === "contract" ? a.contractName.localeCompare(b.contractName)
        : sort === "party" ? a.responsibleParty.localeCompare(b.responsibleParty)
        : sort === "status" ? (a.status ?? "").localeCompare(b.status ?? "")
        : cmp(a.dueDate, b.dueDate);
      return k * dir || cmp(a.dueDate, b.dueDate);
    });

    res.json({ today, rows, filters: { contracts, parties } });
  }),
);

/** Renewal / notice deadline cards, one per contract. */
dashboardRouter.get(
  "/deadlines",
  wrap(async (req, res) => {
    const today = resolveToday(req);
    const entries = await loadPortfolio(today);
    let cards = entries.filter((e) => e.card).map((e) => ({ ...e.card!, status: e.card!.timeStatus, pendingNewVersion: e.pendingNewVersion }));
    if (typeof req.query.status === "string" && req.query.status) cards = cards.filter((c) => c.status === req.query.status);
    if (typeof req.query.contractId === "string" && req.query.contractId) cards = cards.filter((c) => c.contractId === req.query.contractId);
    cards.sort((a, b) => ((a.noticeDeadline ?? "9999") < (b.noticeDeadline ?? "9999") ? -1 : 1));
    res.json({ today, cards });
  }),
);
