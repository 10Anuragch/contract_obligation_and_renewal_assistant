import mongoose, { Schema, type InferSchemaType, type Types } from "mongoose";

const opts = { timestamps: true, minimize: false } as const;

// ---------------------------------------------------------------- Contract
const contractSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    originalFilename: { type: String, required: true },
    sourceType: { type: String, enum: ["pdf", "docx", "text"], required: true },
    currentVersionId: { type: Schema.Types.ObjectId, ref: "ContractVersion", default: null },
  },
  opts,
);
export const Contract = mongoose.models.Contract || mongoose.model("Contract", contractSchema);

// ---------------------------------------------------------------- ContractVersion
const sectionSchema = new Schema(
  {
    sectionId: String,
    sectionNumber: String,
    heading: String,
    text: String,
    startIndex: Number,
    endIndex: Number,
  },
  { _id: false },
);

const versionSchema = new Schema(
  {
    contractId: { type: Schema.Types.ObjectId, ref: "Contract", required: true, index: true },
    versionNumber: { type: Number, required: true },
    filename: { type: String, required: true },
    sourceType: { type: String, enum: ["pdf", "docx", "text"], required: true },
    fileSize: { type: Number, default: 0 },
    uploadedAt: { type: Date, default: Date.now },
    documentText: { type: String, required: true },
    sections: { type: [sectionSchema], default: [] },
    // Optional internal policy (never treated as a legal authority)
    organizationPolicyText: { type: String, default: "" },
    policyFilename: { type: String, default: "" },
    policySections: { type: [sectionSchema], default: [] },
    // Extraction lifecycle
    extractionStatus: {
      type: String,
      enum: ["uploaded", "analyzing", "saving", "complete", "failed"],
      default: "uploaded",
    },
    extractionError: { type: new Schema({ code: String, message: String }, { _id: false }), default: null },
    analysisStartedAt: Date,
    analyzedAt: Date,
    aiProvider: { type: String, default: "" },
    /** Validated raw AI output, kept verbatim for auditability. */
    extractionResult: { type: Schema.Types.Mixed, default: null },
    policyResult: { type: Schema.Types.Mixed, default: null },
    /** Result of comparing with the previous analysed version. */
    comparison: { type: Schema.Types.Mixed, default: null },
  },
  opts,
);
versionSchema.index({ contractId: 1, versionNumber: 1 }, { unique: true });
export const ContractVersion = mongoose.models.ContractVersion || mongoose.model("ContractVersion", versionSchema);

// ---------------------------------------------------------------- ExtractedItem (includes obligations)
const sourceSchema = new Schema(
  {
    sectionNumber: { type: String, default: "" },
    sectionTitle: { type: String, default: "" },
    exactText: { type: String, default: "" },
    startIndex: { type: Number, default: null },
    endIndex: { type: Number, default: null },
    verified: { type: Boolean, default: false },
    matchType: { type: String, default: "none" },
    note: { type: String, default: "" },
    /** Which document the citation points into (contract vs policy). */
    document: { type: String, enum: ["contract", "policy"], default: "contract" },
    /** Version whose text this citation refers to (differs from the item's version for "disappeared" items). */
    versionId: { type: Schema.Types.ObjectId, default: null },
    versionNumber: { type: Number, default: null },
  },
  { _id: false, minimize: false },
);

export const ITEM_CATEGORIES = [
  "party",
  "effectiveDate",
  "expiry",
  "renewal",
  "termination",
  "notice",
  "obligation",
  "ambiguity",
  "conflict",
  "policyNote",
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const REVIEW_STATUSES = ["pending", "approved", "edited", "rejected", "stale"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

const itemSchema = new Schema(
  {
    contractId: { type: Schema.Types.ObjectId, ref: "Contract", required: true, index: true },
    versionId: { type: Schema.Types.ObjectId, ref: "ContractVersion", required: true, index: true },
    versionNumber: { type: Number, required: true },
    category: { type: String, enum: ITEM_CATEGORIES, required: true },
    order: { type: Number, default: 0 },
    label: { type: String, default: "" },
    /** Current effective value (AI value, or the user's correction). */
    data: { type: Schema.Types.Mixed, required: true },
    /** The original AI extraction — never overwritten. */
    original: { type: Schema.Types.Mixed, required: true },
    /** The user's latest correction (null when never edited). */
    userCorrection: { type: Schema.Types.Mixed, default: null },
    source: { type: sourceSchema, required: true },
    /** Additional citations: conflicting passages, or the policy passage for policy notes. */
    extraSources: { type: [sourceSchema], default: [] },
    confidence: { type: String, enum: ["confirmed", "uncertain"], required: true },
    reviewStatus: { type: String, enum: REVIEW_STATUSES, default: "pending", index: true },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: String, default: null },
    reviewNote: { type: String, default: "" },
    stale: {
      type: new Schema(
        {
          previousApprovedValue: Schema.Types.Mixed,
          newValue: Schema.Types.Mixed,
          reason: String,
          changes: [String],
          disappeared: { type: Boolean, default: false },
          detectedAt: Date,
          previousItemId: Schema.Types.ObjectId,
          previousVersionNumber: Number,
        },
        { _id: false, minimize: false },
      ),
      default: null,
    },
    /** Set when an earlier decision was inherited because the source text did not change. */
    carriedFromItemId: { type: Schema.Types.ObjectId, default: null },
    carriedFromVersionNumber: { type: Number, default: null },
  },
  opts,
);
itemSchema.index({ versionId: 1, category: 1, order: 1 });
export const ExtractedItem = mongoose.models.ExtractedItem || mongoose.model("ExtractedItem", itemSchema);

// ---------------------------------------------------------------- AuditEvent
export const AUDIT_ACTIONS = [
  "contract_uploaded",
  "version_uploaded",
  "analysis_started",
  "analysis_completed",
  "analysis_failed",
  "item_edited",
  "item_approved",
  "item_rejected",
  "item_marked_stale",
  "item_carried_forward",
  "version_comparison_failed",
  "summary_generated",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

const auditSchema = new Schema(
  {
    contractId: { type: Schema.Types.ObjectId, required: true, index: true },
    versionId: { type: Schema.Types.ObjectId, default: null },
    versionNumber: { type: Number, default: null },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    itemId: { type: Schema.Types.ObjectId, default: null, index: true },
    itemLabel: { type: String, default: "" },
    message: { type: String, default: "" },
    previousValue: { type: Schema.Types.Mixed, default: null },
    newValue: { type: Schema.Types.Mixed, default: null },
    actor: { type: String, default: "user" },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { minimize: false },
);
export const AuditEvent = mongoose.models.AuditEvent || mongoose.model("AuditEvent", auditSchema);

export type ID = Types.ObjectId | string;
export type ContractDoc = InferSchemaType<typeof contractSchema> & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };
