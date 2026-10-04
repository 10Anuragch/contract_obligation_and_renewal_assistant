import { ContractVersion, ExtractedItem } from "../models/index.js";
import { getExtractor } from "../ai/provider.js";
import { runExtraction } from "./extraction.js";
import { logEvent } from "./audit.js";
import { mergeVersions, type ComparableItem } from "./stale.js";
import { AppError, Errors } from "../utils/errors.js";
import { itemLabel } from "./items.js";
import { findSectionAt } from "./sections.js";

const running = new Set<Promise<void>>();

/** Resolves when all background analyses have finished (used by tests and graceful shutdown). */
export async function whenIdle(): Promise<void> {
  while (running.size) await Promise.allSettled([...running]);
}

/**
 * Atomically claim a version for analysis. Returns null when it is already being analysed or finished,
 * which makes a double-click / duplicate request harmless.
 */
export async function claimForAnalysis(versionId: string) {
  return ContractVersion.findOneAndUpdate(
    { _id: versionId, extractionStatus: { $in: ["uploaded", "failed"] } },
    { $set: { extractionStatus: "analyzing", extractionError: null, analysisStartedAt: new Date() } },
    { returnDocument: "after" },
  ).lean();
}

export function startAnalysis(version: any): void {
  const p = analyzeVersion(version).catch((err) => console.error("[analysis] unexpected failure", err)).finally(() => running.delete(p));
  running.add(p);
}

async function fail(version: any, err: unknown) {
  const e = err instanceof AppError ? err : Errors.aiUnavailable("The analysis failed unexpectedly. Please retry.");
  await ContractVersion.updateOne(
    { _id: version._id },
    { $set: { extractionStatus: "failed", extractionError: { code: e.code, message: e.message } } },
  );
  await logEvent({
    contractId: version.contractId,
    versionId: version._id,
    versionNumber: version.versionNumber,
    action: "analysis_failed",
    message: `Analysis failed: ${e.message}`,
    actor: "system",
  });
}

export async function analyzeVersion(version: any): Promise<void> {
  await logEvent({
    contractId: version.contractId,
    versionId: version._id,
    versionNumber: version.versionNumber,
    action: "analysis_started",
    message: `Analysis of version ${version.versionNumber} started`,
    actor: "system",
  });

  let output;
  let providerName = "";
  try {
    const extractor = getExtractor();
    providerName = extractor.name;
    output = await runExtraction(
      extractor,
      { text: version.documentText, sections: version.sections },
      version.organizationPolicyText ? { text: version.organizationPolicyText, sections: version.policySections ?? [] } : null,
    );
  } catch (err) {
    await fail(version, err);
    return;
  }

  try {
    await ContractVersion.updateOne({ _id: version._id }, { $set: { extractionStatus: "saving" } });
    await ExtractedItem.deleteMany({ versionId: version._id }); // safe re-run after a failed attempt

    const docs = output.drafts.map((d) => ({
      contractId: version.contractId,
      versionId: version._id,
      versionNumber: version.versionNumber,
      category: d.category,
      order: d.order,
      label: d.label,
      data: d.data,
      original: d.original,
      userCorrection: null,
      source: { ...d.source, versionId: version._id, versionNumber: version.versionNumber },
      extraSources: d.extraSources.map((s) => ({ ...s, versionId: version._id, versionNumber: version.versionNumber })),
      confidence: d.confidence,
      reviewStatus: "pending",
    }));
    const inserted = docs.length ? await ExtractedItem.insertMany(docs) : [];

    let comparison: Record<string, unknown> | null = null;
    try {
      comparison = await compareWithPrevious(version, inserted.map((d: any) => d.toObject?.() ?? d));
    } catch (err) {
      console.error("[analysis] version comparison failed", err);
      comparison = { error: Errors.versionComparison().message };
      await logEvent({
        contractId: version.contractId,
        versionId: version._id,
        versionNumber: version.versionNumber,
        action: "version_comparison_failed",
        message: Errors.versionComparison().message,
        actor: "system",
      });
    }

    await ContractVersion.updateOne(
      { _id: version._id },
      {
        $set: {
          extractionStatus: "complete",
          extractionResult: output.extraction,
          policyResult: output.policyResult,
          aiProvider: providerName,
          analyzedAt: new Date(),
          comparison,
          extractionError: null,
        },
      },
    );
    await logEvent({
      contractId: version.contractId,
      versionId: version._id,
      versionNumber: version.versionNumber,
      action: "analysis_completed",
      message: `Contract version ${version.versionNumber} analyzed — ${docs.length} items extracted for review`,
      actor: "system",
    });
  } catch (err) {
    console.error("[analysis] saving failed", err);
    await fail(version, Errors.database());
  }
}

/** Compare against the latest earlier version that finished analysis; apply carried decisions and stale marks. */
async function compareWithPrevious(version: any, newDocs: any[]): Promise<Record<string, unknown> | null> {
  const prev: any = await ContractVersion.findOne({
    contractId: version.contractId,
    versionNumber: { $lt: version.versionNumber },
    extractionStatus: "complete",
  })
    .sort({ versionNumber: -1 })
    .lean();
  if (!prev) return null;

  const oldDocs: any[] = await ExtractedItem.find({ versionId: prev._id }).lean();
  const sectionsFor = (versionId: unknown) => (String(versionId) === String(version._id) ? version.sections : prev.sections) ?? [];
  const contextOf = (d: any): string | undefined => {
    const src = d.source;
    if (!src?.verified || src.startIndex == null) return undefined;
    // Citations always point into the version they were made in (items re-created as stale point at the older one).
    const secs = String(src.versionId ?? d.versionId) === String(prev._id) ? prev.sections : sectionsFor(d.versionId);
    return findSectionAt(secs ?? [], src.startIndex)?.text;
  };
  const toComparable = (d: any): ComparableItem => ({
    contextText: contextOf(d),
    id: String(d._id),
    category: d.category,
    data: d.data,
    original: d.original,
    userCorrection: d.userCorrection,
    source: d.source,
    extraSources: d.extraSources,
    reviewStatus: d.reviewStatus,
    reviewedAt: d.reviewedAt,
    reviewedBy: d.reviewedBy,
    reviewNote: d.reviewNote,
    confidence: d.confidence,
    label: d.label,
  });

  const result = mergeVersions(oldDocs.map(toComparable), newDocs.map(toComparable), prev.versionNumber);
  const now = new Date();

  let carriedCount = 0;
  for (const [index, patch] of result.patches) {
    const target = newDocs[index];
    if (patch.kind === "carried") {
      carriedCount++;
      await ExtractedItem.updateOne(
        { _id: target._id },
        {
          $set: {
            reviewStatus: patch.reviewStatus,
            data: patch.data,
            userCorrection: patch.userCorrection,
            reviewedAt: patch.reviewedAt,
            reviewedBy: patch.reviewedBy,
            reviewNote: patch.reviewNote,
            label: itemLabel(target.category, patch.data),
            carriedFromItemId: patch.carriedFromItemId,
            carriedFromVersionNumber: prev.versionNumber,
          },
        },
      );
    } else {
      await ExtractedItem.updateOne(
        { _id: target._id },
        { $set: { reviewStatus: "stale", stale: { ...patch.stale, detectedAt: now } } },
      );
      await logEvent({
        contractId: version.contractId,
        versionId: version._id,
        versionNumber: version.versionNumber,
        action: "item_marked_stale",
        itemId: target._id,
        itemLabel: target.label,
        message: `${target.label} marked potentially stale — ${patch.stale.reason}${patch.stale.changes.length ? ` (${patch.stale.changes.join("; ")})` : ""}`,
        previousValue: patch.stale.previousApprovedValue,
        newValue: patch.stale.newValue,
        actor: "system",
      });
    }
  }

  for (const gone of result.disappeared) {
    const created: any = await ExtractedItem.create({
      contractId: version.contractId,
      versionId: version._id,
      versionNumber: version.versionNumber,
      category: gone.category,
      order: 10_000 + newDocs.length,
      label: gone.label,
      data: gone.data,
      original: gone.original,
      userCorrection: gone.userCorrection,
      // The citation still points into the PREVIOUS version's text, where it was approved.
      source: { ...gone.source, versionId: prev._id, versionNumber: prev.versionNumber },
      extraSources: gone.extraSources,
      confidence: "uncertain",
      reviewStatus: "stale",
      stale: { ...gone.stale, detectedAt: now },
    });
    await logEvent({
      contractId: version.contractId,
      versionId: version._id,
      versionNumber: version.versionNumber,
      action: "item_marked_stale",
      itemId: created._id,
      itemLabel: gone.label,
      message: `${gone.label} marked potentially stale — ${gone.stale.reason}`,
      previousValue: gone.data,
      newValue: null,
      actor: "system",
    });
  }

  if (carriedCount > 0) {
    await logEvent({
      contractId: version.contractId,
      versionId: version._id,
      versionNumber: version.versionNumber,
      action: "item_carried_forward",
      message: `${carriedCount} earlier review decision${carriedCount === 1 ? "" : "s"} carried forward from version ${prev.versionNumber} (source text and values unchanged)`,
      actor: "system",
    });
  }

  return {
    comparedToVersionId: String(prev._id),
    comparedToVersionNumber: prev.versionNumber,
    carried: carriedCount,
    stale: result.stats.stale,
    disappeared: result.stats.disappeared,
    reviewedItemsCompared: result.stats.compared,
    comparedAt: now,
    error: null,
  };
}
