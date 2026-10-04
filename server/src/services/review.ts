/**
 * Review state transitions. Pure functions: they take the current item state and return what should change, so the
 * rules (idempotency, preserving the original AI extraction, recording corrections) can be unit tested without a DB.
 */
import type { ItemCategory, ReviewStatus } from "../models/index.js";
import { dataSchemas, itemLabel } from "./items.js";
import { AppError } from "../utils/errors.js";

export interface ReviewableItem {
  category: ItemCategory;
  data: Record<string, any>;
  original: Record<string, any>;
  userCorrection: Record<string, any> | null;
  reviewStatus: ReviewStatus;
  stale?: unknown;
}

export interface ReviewTransition {
  changed: boolean;
  /** Fields to $set on the item when changed. */
  update: Record<string, unknown>;
  action: "item_approved" | "item_rejected" | "item_edited" | null;
  previousValue: unknown;
  newValue: unknown;
  message: string;
}

const NOOP: ReviewTransition = { changed: false, update: {}, action: null, previousValue: null, newValue: null, message: "" };

export function approve(item: ReviewableItem, reviewer: string, now = new Date()): ReviewTransition {
  if (item.reviewStatus === "approved") return NOOP; // duplicate action — idempotent, no new audit event
  return {
    changed: true,
    update: { reviewStatus: "approved", reviewedAt: now, reviewedBy: reviewer },
    action: "item_approved",
    previousValue: { reviewStatus: item.reviewStatus },
    newValue: { reviewStatus: "approved" },
    message: `${itemLabel(item.category, item.data)} approved`,
  };
}

export function reject(item: ReviewableItem, reviewer: string, note = "", now = new Date()): ReviewTransition {
  if (item.reviewStatus === "rejected") return NOOP;
  return {
    changed: true,
    update: { reviewStatus: "rejected", reviewedAt: now, reviewedBy: reviewer, reviewNote: note },
    action: "item_rejected",
    previousValue: { reviewStatus: item.reviewStatus },
    newValue: { reviewStatus: "rejected", note },
    message: `${itemLabel(item.category, item.data)} rejected${note ? ` — ${note}` : ""}`,
  };
}

/** Shallow-merge `patch` onto the current data and validate the result for the item's category. */
export function edit(item: ReviewableItem, patch: Record<string, unknown>, reviewer: string, note = "", now = new Date()): ReviewTransition {
  const merged = { ...item.data, ...patch };
  const parsed = dataSchemas[item.category].safeParse(merged);
  if (!parsed.success) {
    throw new AppError(
      400,
      "VALIDATION_FAILED",
      "The edited values are not valid: " + parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".") || "value"} — ${i.message}`).join("; "),
      parsed.error.issues,
    );
  }
  const next = parsed.data as Record<string, any>;
  if (JSON.stringify(next) === JSON.stringify(item.data)) return NOOP; // nothing actually changed

  return {
    changed: true,
    update: {
      data: next,
      userCorrection: next, // the original AI value stays untouched in `original`
      label: itemLabel(item.category, next),
      reviewStatus: "edited",
      reviewedAt: now,
      reviewedBy: reviewer,
      reviewNote: note,
    },
    action: "item_edited",
    previousValue: item.data,
    newValue: next,
    message: `${itemLabel(item.category, item.data)} edited → ${itemLabel(item.category, next)}`,
  };
}
