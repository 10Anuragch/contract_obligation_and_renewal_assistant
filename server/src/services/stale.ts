/**
 * Version comparison and stale detection — pure functions, no database, no AI.
 *
 * For each decision the reviewer made on version N-1 (approved / edited / rejected) we look for the matching item in
 * version N and compare (a) the normalized source wording and (b) the structured extracted values.
 *   - matching + unchanged  -> the decision is carried forward
 *   - matching + changed    -> an approved/edited item becomes "stale" (rejected items simply go back to pending)
 *   - no match              -> an approved/edited item is re-created in version N as stale ("disappeared")
 * The new version is never assumed to be correct: anything changed requires review.
 */
import type { ItemCategory, ReviewStatus } from "../models/index.js";
import { comparableValue, describeChanges, normText } from "./items.js";

export interface ComparableItem {
  id: string;
  category: ItemCategory;
  data: Record<string, any>;
  original: Record<string, any>;
  userCorrection?: Record<string, any> | null;
  source: { sectionNumber?: string; sectionTitle?: string; exactText: string } & Record<string, any>;
  extraSources?: any[];
  reviewStatus: ReviewStatus;
  reviewedAt?: Date | null;
  reviewedBy?: string | null;
  reviewNote?: string;
  confidence?: "confirmed" | "uncertain";
  label?: string;
  /**
   * Full text of the contract section that contains the cited quote. Used for "did the source change?" so that
   * a different quote boundary chosen by the AI between runs is not mistaken for a change in the contract.
   */
  contextText?: string;
}

export interface StaleInfo {
  previousApprovedValue: Record<string, any>;
  newValue: Record<string, any> | null;
  reason: string;
  changes: string[];
  disappeared: boolean;
  previousItemId: string;
  previousVersionNumber: number;
}

export type ItemPatch =
  | {
      kind: "carried";
      reviewStatus: "approved" | "edited" | "rejected";
      data: Record<string, any>;
      userCorrection: Record<string, any> | null;
      reviewedAt: Date | null;
      reviewedBy: string | null;
      reviewNote: string;
      carriedFromItemId: string;
    }
  | { kind: "stale"; reviewStatus: "stale"; stale: StaleInfo };

export interface DisappearedItem {
  category: ItemCategory;
  data: Record<string, any>;
  original: Record<string, any>;
  userCorrection: Record<string, any> | null;
  source: ComparableItem["source"];
  extraSources: any[];
  label: string;
  stale: StaleInfo;
}

export interface MergeResult {
  /** index in `newItems` -> patch to apply */
  patches: Map<number, ItemPatch>;
  disappeared: DisappearedItem[];
  stats: { carried: number; stale: number; disappeared: number; compared: number };
}

const SINGLETONS: ItemCategory[] = ["effectiveDate", "expiry", "renewal"];
const DECIDED: ReviewStatus[] = ["approved", "edited", "rejected"];

const tokens = (s: string) => new Set(normText(s).split(" ").filter(Boolean));
export function similarity(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

const MATCH_THRESHOLD = 0.4;

function score(o: ComparableItem, n: ComparableItem): number {
  if (o.category !== n.category) return -1;
  if (SINGLETONS.includes(o.category)) return 1;
  if (o.category === "party") {
    // Parties usually share one citation (the preamble), so the name is the only identity signal.
    return normText(o.original.name) === normText(n.original.name) ? 1 : -1;
  }
  let s = similarity(o.source.exactText, n.source.exactText);
  if (o.source.sectionNumber && o.source.sectionNumber === n.source.sectionNumber) s += 0.15;
  // Same structured value is also good evidence (e.g. same notice period in a re-numbered clause).
  if (JSON.stringify(comparableValue(o.category, o.original)) === JSON.stringify(comparableValue(n.category, n.original))) s += 0.1;
  return Math.min(s, 1);
}

export function mergeVersions(oldItems: ComparableItem[], newItems: ComparableItem[], previousVersionNumber: number): MergeResult {
  const decided = oldItems.filter((o) => DECIDED.includes(o.reviewStatus));
  const pairs: { oi: number; ni: number; s: number }[] = [];
  decided.forEach((o, oi) =>
    newItems.forEach((n, ni) => {
      const s = score(o, n);
      if (s >= MATCH_THRESHOLD) pairs.push({ oi, ni, s });
    }),
  );
  pairs.sort((a, b) => b.s - a.s);

  const usedOld = new Set<number>();
  const usedNew = new Set<number>();
  const patches = new Map<number, ItemPatch>();
  const disappeared: DisappearedItem[] = [];
  let carried = 0;
  let stale = 0;

  for (const p of pairs) {
    if (usedOld.has(p.oi) || usedNew.has(p.ni)) continue;
    usedOld.add(p.oi);
    usedNew.add(p.ni);
    const o = decided[p.oi];
    const n = newItems[p.ni];

    const sourceChanged = normText(o.contextText ?? o.source.exactText) !== normText(n.contextText ?? n.source.exactText);
    const structured = !["ambiguity", "conflict", "policyNote"].includes(o.category);
    const valueChanged =
      structured && JSON.stringify(comparableValue(o.category, o.original)) !== JSON.stringify(comparableValue(n.category, n.original));
    const changed = sourceChanged || valueChanged;

    if (!changed) {
      carried++;
      patches.set(p.ni, {
        kind: "carried",
        reviewStatus: o.reviewStatus as "approved" | "edited" | "rejected",
        data: o.data,
        userCorrection: o.userCorrection ?? null,
        reviewedAt: o.reviewedAt ?? null,
        reviewedBy: o.reviewedBy ?? null,
        reviewNote: o.reviewNote ?? "",
        carriedFromItemId: o.id,
      });
      continue;
    }

    if (o.reviewStatus === "rejected") continue; // a rejected item that changed goes back to pending review

    stale++;
    const changes = describeChanges(o.category, o.data, n.original); // reviewer-approved value vs new extraction
    const reason = sourceChanged && valueChanged
      ? "Related contract language and the extracted value both changed in the newer version."
      : valueChanged
        ? "The extracted value changed in the newer version."
        : "Related contract language changed in the newer version (the extracted values are the same).";
    patches.set(p.ni, {
      kind: "stale",
      reviewStatus: "stale",
      stale: {
        previousApprovedValue: o.data,
        newValue: n.data,
        reason,
        changes,
        disappeared: false,
        previousItemId: o.id,
        previousVersionNumber,
      },
    });
  }

  decided.forEach((o, oi) => {
    if (usedOld.has(oi) || o.reviewStatus === "rejected") return;
    stale++;
    disappeared.push({
      category: o.category,
      data: o.data,
      original: o.original,
      userCorrection: o.userCorrection ?? null,
      source: o.source,
      extraSources: o.extraSources ?? [],
      label: o.label ?? "",
      stale: {
        previousApprovedValue: o.data,
        newValue: null,
        reason: "The source text behind this approved item was not found in the newer version.",
        changes: [],
        disappeared: true,
        previousItemId: o.id,
        previousVersionNumber,
      },
    });
  });

  return { patches, disappeared, stats: { carried, stale, disappeared: disappeared.length, compared: decided.length } };
}
