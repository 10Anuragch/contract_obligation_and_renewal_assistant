/**
 * Cross-contract read model used by the dashboard, Upcoming and Deadlines endpoints.
 * Uses each contract's "effective" version: the current version if it has been analysed, otherwise the latest
 * analysed earlier version (so deadlines never disappear just because a new upload awaits analysis).
 */
import { Contract, ContractVersion, ExtractedItem } from "../models/index.js";
import { config } from "../config.js";
import { plainItem } from "../utils/serialize.js";
import {
  computeAllRows,
  displayStatus,
  type ContractRef,
  type DeadlineConfig,
  type DeadlineRow,
  type PlainItem,
  type RenewalCard,
} from "./deadlines.js";

export const deadlineConfig = (): DeadlineConfig => ({
  dueSoonDays: config.dueSoonDays,
  obligationReminderLeadDays: config.obligationReminderLeadDays,
  noticeReminderLeadDays: config.noticeReminderLeadDays,
});

export interface PortfolioEntry {
  contract: any;
  currentVersion: any | null;
  effectiveVersion: any | null;
  pendingNewVersion: boolean;
  versionCount: number;
  items: ReturnType<typeof plainItem>[];
  rows: (DeadlineRow & { status: string })[];
  card: RenewalCard | null;
}

export function pickEffectiveVersion(currentId: string | null, versions: any[]): { effective: any | null; current: any | null } {
  const current = versions.find((v) => String(v._id) === currentId) ?? versions.sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null;
  if (current && current.extractionStatus === "complete") return { effective: current, current };
  const latestComplete = versions
    .filter((v) => v.extractionStatus === "complete")
    .sort((a, b) => b.versionNumber - a.versionNumber)[0];
  return { effective: latestComplete ?? null, current };
}

export async function loadPortfolio(today: string): Promise<PortfolioEntry[]> {
  const contracts: any[] = await Contract.find().sort({ updatedAt: -1 }).lean();
  if (contracts.length === 0) return [];
  const versions: any[] = await ContractVersion.find(
    { contractId: { $in: contracts.map((c) => c._id) } },
    "contractId versionNumber filename sourceType fileSize uploadedAt extractionStatus analyzedAt comparison createdAt",
  ).lean();

  const chosen = contracts.map((c) => {
    const vs = versions.filter((v) => String(v.contractId) === String(c._id));
    return { contract: c, versionCount: vs.length, ...pickEffectiveVersion(c.currentVersionId ? String(c.currentVersionId) : null, vs) };
  });

  const versionIds = chosen.map((x) => x.effective?._id).filter(Boolean);
  const itemDocs: any[] = versionIds.length ? await ExtractedItem.find({ versionId: { $in: versionIds } }).sort({ order: 1 }).lean() : [];
  const cfg = deadlineConfig();

  return chosen.map(({ contract, effective, current, versionCount }) => {
    const items = effective ? itemDocs.filter((d) => String(d.versionId) === String(effective._id)).map(plainItem) : [];
    let rows: PortfolioEntry["rows"] = [];
    let card: RenewalCard | null = null;
    if (effective) {
      const ref: ContractRef = {
        contractId: String(contract._id),
        contractName: contract.name,
        versionId: String(effective._id),
        versionNumber: effective.versionNumber,
      };
      const r = computeAllRows(items as unknown as PlainItem[], ref, today, cfg);
      card = r.card;
      rows = r.rows.map((row) => ({ ...row, status: displayStatus(row) }));
    }
    return {
      contract,
      currentVersion: current,
      effectiveVersion: effective,
      pendingNewVersion: !!(current && effective && String(current._id) !== String(effective._id)),
      versionCount,
      items,
      rows,
      card,
    };
  });
}
