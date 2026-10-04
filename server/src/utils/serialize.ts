import mongoose from "mongoose";
import { AppError, Errors } from "./errors.js";

export const idStr = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export function assertObjectId(id: string, what = "Resource"): string {
  if (!mongoose.isValidObjectId(id) || String(id).length !== 24) throw Errors.notFound(what);
  return id;
}

function plainSource(s: any) {
  if (!s) return s;
  return {
    sectionNumber: s.sectionNumber ?? "",
    sectionTitle: s.sectionTitle ?? "",
    exactText: s.exactText ?? "",
    startIndex: s.startIndex ?? null,
    endIndex: s.endIndex ?? null,
    verified: !!s.verified,
    matchType: s.matchType ?? "none",
    note: s.note ?? "",
    document: s.document ?? "contract",
    versionId: idStr(s.versionId),
    versionNumber: s.versionNumber ?? null,
  };
}

/** Lean item document -> API shape (string ids). */
export function plainItem(d: any) {
  return {
    id: String(d._id),
    contractId: String(d.contractId),
    versionId: String(d.versionId),
    versionNumber: d.versionNumber,
    category: d.category,
    order: d.order,
    label: d.label,
    data: d.data,
    original: d.original,
    userCorrection: d.userCorrection ?? null,
    source: plainSource(d.source),
    extraSources: (d.extraSources ?? []).map(plainSource),
    confidence: d.confidence,
    reviewStatus: d.reviewStatus,
    reviewedAt: d.reviewedAt ?? null,
    reviewedBy: d.reviewedBy ?? null,
    reviewNote: d.reviewNote ?? "",
    stale: d.stale
      ? { ...d.stale, previousItemId: idStr(d.stale.previousItemId) }
      : null,
    carriedFromItemId: idStr(d.carriedFromItemId),
    carriedFromVersionNumber: d.carriedFromVersionNumber ?? null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}
export type PlainItemDoc = ReturnType<typeof plainItem>;

export function plainVersion(v: any, extra: Record<string, unknown> = {}) {
  return {
    id: String(v._id),
    contractId: String(v.contractId),
    versionNumber: v.versionNumber,
    filename: v.filename,
    sourceType: v.sourceType,
    fileSize: v.fileSize,
    uploadedAt: v.uploadedAt,
    characterCount: (v.documentText ?? "").length,
    sectionCount: (v.sections ?? []).length,
    hasPolicy: !!(v.organizationPolicyText && v.organizationPolicyText.length),
    policyFilename: v.policyFilename || "",
    extractionStatus: v.extractionStatus,
    extractionError: v.extractionError ?? null,
    analysisStartedAt: v.analysisStartedAt ?? null,
    analyzedAt: v.analyzedAt ?? null,
    aiProvider: v.aiProvider || "",
    comparison: v.comparison ?? null,
    createdAt: v.createdAt,
    ...extra,
  };
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
