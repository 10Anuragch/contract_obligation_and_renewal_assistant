import mongoose from "mongoose";
import { config } from "./config.js";
import { ContractVersion, ExtractedItem, AuditEvent, Contract } from "./models/index.js";

export async function connectDb(uri = config.mongoUri): Promise<void> {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  await Promise.all([Contract.init(), ContractVersion.init(), ExtractedItem.init(), AuditEvent.init()]);
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

/** Analyses interrupted by a restart would otherwise be stuck in "analyzing" forever. */
export async function recoverInterruptedAnalyses(): Promise<number> {
  const res = await ContractVersion.updateMany(
    { extractionStatus: { $in: ["analyzing", "saving"] } },
    {
      $set: {
        extractionStatus: "failed",
        extractionError: { code: "INTERRUPTED", message: "The analysis was interrupted by a server restart. Please run it again." },
      },
    },
  );
  return res.modifiedCount ?? 0;
}
