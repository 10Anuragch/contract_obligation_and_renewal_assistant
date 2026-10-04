import { Router } from "express";
import { z } from "zod";
import { AuditEvent, ContractVersion, ExtractedItem } from "../models/index.js";
import { wrap } from "../middleware/errors.js";
import { Errors } from "../utils/errors.js";
import { assertObjectId, plainItem } from "../utils/serialize.js";
import { logEvent, plainEvent } from "../services/audit.js";
import * as review from "../services/review.js";
import { findSectionAt } from "../services/sections.js";

export const itemsRouter = Router();

const REVIEWER = "reviewer"; // no authentication in this MVP — a single local reviewer identity

async function loadItem(id: string) {
  assertObjectId(id, "Item");
  const item: any = await ExtractedItem.findById(id).lean();
  if (!item) throw Errors.notFound("Item");
  return item;
}

/**
 * Serialises review actions per item inside this process, so two simultaneous clicks cannot both be recorded.
 * (The conditional update filter below additionally protects against races on databases with atomic updates.)
 */
const locks = new Map<string, Promise<unknown>>();
async function withItemLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  locks.set(id, next);
  try {
    return await next;
  } finally {
    if (locks.get(id) === next) locks.delete(id);
  }
}

async function persist(item: any, t: review.ReviewTransition, extraFilter: Record<string, unknown>) {
  if (!t.changed) return { item, changed: false };
  const res = await ExtractedItem.updateOne({ _id: item._id, ...extraFilter }, { $set: t.update });
  if (res.matchedCount === 0) return { item: (await ExtractedItem.findById(item._id).lean()) as any, changed: false, raced: true };
  const fresh: any = await ExtractedItem.findById(item._id).lean();
  await logEvent({
    contractId: item.contractId,
    versionId: item.versionId,
    versionNumber: item.versionNumber,
    action: t.action!,
    itemId: item._id,
    itemLabel: fresh.label || item.label,
    message: t.message,
    previousValue: t.previousValue,
    newValue: t.newValue,
  });
  return { item: fresh, changed: true };
}

itemsRouter.get(
  "/:itemId",
  wrap(async (req, res) => {
    const item = await loadItem(req.params.itemId);
    const events: any[] = await AuditEvent.find({ itemId: item._id }).sort({ timestamp: -1 }).lean();
    res.json({ item: plainItem(item), history: events.map(plainEvent) });
  }),
);

itemsRouter.patch(
  "/:itemId",
  wrap(async (req, res) => {
    const body = z.object({ data: z.record(z.string(), z.unknown()), note: z.string().max(1000).optional() }).parse(req.body);
    assertObjectId(req.params.itemId, "Item");
    const r = await withItemLock(req.params.itemId, async () => {
      const item = await loadItem(req.params.itemId);
      const t = review.edit(item, body.data, REVIEWER, body.note ?? "");
      return persist(item, t, { updatedAt: item.updatedAt });
    });
    if ((r as any).raced) throw Errors.conflict("This item was changed by another action. Reload and try again.");
    res.json({ item: plainItem(r.item), changed: r.changed });
  }),
);

itemsRouter.post(
  "/:itemId/approve",
  wrap(async (req, res) => {
    assertObjectId(req.params.itemId, "Item");
    // Two simultaneous clicks produce exactly one state change and one audit event.
    const r = await withItemLock(req.params.itemId, async () => {
      const item = await loadItem(req.params.itemId);
      return persist(item, review.approve(item, REVIEWER), { reviewStatus: { $ne: "approved" } });
    });
    res.json({ item: plainItem(r.item), changed: r.changed });
  }),
);

itemsRouter.post(
  "/:itemId/reject",
  wrap(async (req, res) => {
    const body = z.object({ note: z.string().max(1000).optional() }).parse(req.body ?? {});
    assertObjectId(req.params.itemId, "Item");
    const r = await withItemLock(req.params.itemId, async () => {
      const item = await loadItem(req.params.itemId);
      return persist(item, review.reject(item, REVIEWER, body.note ?? ""), { reviewStatus: { $ne: "rejected" } });
    });
    res.json({ item: plainItem(r.item), changed: r.changed });
  }),
);

// ------------------------------------------------------------------ source viewer
itemsRouter.get(
  "/:itemId/source",
  wrap(async (req, res) => {
    const item = await loadItem(req.params.itemId);
    const plain = plainItem(item);
    const citations = [plain.source, ...plain.extraSources];

    const versionCache = new Map<string, any>();
    const getVersion = async (id: string) => {
      if (!versionCache.has(id)) versionCache.set(id, await ContractVersion.findById(id).lean());
      return versionCache.get(id);
    };

    const views = [];
    for (const c of citations) {
      const v: any = await getVersion(c.versionId ?? plain.versionId);
      const isPolicy = c.document === "policy";
      const text: string = v ? (isPolicy ? v.organizationPolicyText : v.documentText) : "";
      const sections = v ? (isPolicy ? v.policySections : v.sections) ?? [] : [];
      let section: any = null;
      let highlight: { start: number; end: number } | null = null;
      if (c.verified && c.startIndex !== null && c.endIndex !== null) {
        section = findSectionAt(sections, c.startIndex) ?? null;
        if (section) {
          highlight = {
            start: Math.max(0, c.startIndex - section.startIndex),
            end: Math.min(section.text.length, c.endIndex - section.startIndex),
          };
        }
      }
      views.push({
        document: c.document,
        versionNumber: v?.versionNumber ?? c.versionNumber,
        filename: isPolicy ? v?.policyFilename || "Organization policy" : v?.filename,
        sectionNumber: section?.sectionNumber ?? c.sectionNumber,
        sectionTitle: section?.heading ?? c.sectionTitle,
        sectionText: section?.text ?? null,
        highlight,
        verified: c.verified,
        quotedText: c.exactText,
        note: c.note || (c.verified ? "" : "The cited text could not be located in the document. Treat this item as needing review."),
        // Without a located section we still offer the document start so the reader can search manually.
        fullTextLength: text.length,
      });
    }
    res.json({ item: { id: plain.id, label: plain.label, category: plain.category, versionNumber: plain.versionNumber }, citations: views });
  }),
);
