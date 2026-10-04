import { AuditEvent, type AuditAction } from "../models/index.js";

export interface AuditInput {
  contractId: unknown;
  versionId?: unknown;
  versionNumber?: number | null;
  action: AuditAction;
  itemId?: unknown;
  itemLabel?: string;
  message?: string;
  previousValue?: unknown;
  newValue?: unknown;
  actor?: string;
}

export async function logEvent(e: AuditInput): Promise<void> {
  await AuditEvent.create({
    contractId: e.contractId,
    versionId: e.versionId ?? null,
    versionNumber: e.versionNumber ?? null,
    action: e.action,
    itemId: e.itemId ?? null,
    itemLabel: e.itemLabel ?? "",
    message: e.message ?? "",
    previousValue: e.previousValue ?? null,
    newValue: e.newValue ?? null,
    actor: e.actor ?? "user",
    timestamp: new Date(),
  });
}

export function plainEvent(e: any) {
  return {
    id: String(e._id),
    contractId: String(e.contractId),
    versionId: e.versionId ? String(e.versionId) : null,
    versionNumber: e.versionNumber ?? null,
    action: e.action,
    itemId: e.itemId ? String(e.itemId) : null,
    itemLabel: e.itemLabel ?? "",
    message: e.message ?? "",
    previousValue: e.previousValue ?? null,
    newValue: e.newValue ?? null,
    actor: e.actor ?? "user",
    timestamp: e.timestamp,
  };
}
