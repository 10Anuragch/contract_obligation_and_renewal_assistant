import { Router, type Request } from "express";
import { z } from "zod";
import { Contract, ContractVersion, ExtractedItem, AuditEvent } from "../models/index.js";
import { uploadFields } from "../middleware/upload.js";
import { wrap } from "../middleware/errors.js";
import { AppError, Errors } from "../utils/errors.js";
import { assertObjectId, plainItem, plainVersion, idStr } from "../utils/serialize.js";
import {
  parsePastedText,
  parseUploadedFile,
  sanitizeFilename,
  type ParsedDocument,
} from "../services/documentParser.js";
import { splitSections } from "../services/sections.js";
import { logEvent, plainEvent } from "../services/audit.js";
import { claimForAnalysis, startAnalysis } from "../services/analysis.js";
import { getExtractor } from "../ai/provider.js";
import { loadPortfolio, pickEffectiveVersion, deadlineConfig } from "../services/portfolio.js";
import { computeAllRows, displayStatus, type ContractRef, type PlainItem } from "../services/deadlines.js";
import { buildSummary, summaryToMarkdown } from "../services/summary.js";
import { todayISO, getTimeStatus } from "../services/dates.js";

export const contractsRouter = Router();

const bodySchema = z.object({
  name: z.string().trim().max(200).optional(),
  contractText: z.string().optional(),
  policyText: z.string().optional(),
});

interface Intake {
  doc: ParsedDocument;
  fileSize: number;
  policy: ParsedDocument | null;
  name?: string;
}

/** Parse + validate whatever the user supplied (file or pasted text, plus optional policy). */
async function readIntake(req: Request): Promise<Intake> {
  const body = bodySchema.parse(req.body ?? {});
  const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  const contractFile = files.contractFile?.[0];
  const policyFile = files.policyFile?.[0];
  const hasText = !!body.contractText?.trim();

  if (contractFile && hasText) throw Errors.badRequest("Provide either a contract file or pasted text — not both.");
  if (!contractFile && !hasText) throw Errors.badRequest("Upload a PDF/DOCX contract or paste the contract text.");
  if (policyFile && body.policyText?.trim()) throw Errors.badRequest("Provide the organization policy as a file or pasted text — not both.");

  const doc = contractFile
    ? await parseUploadedFile(contractFile.buffer, contractFile.originalname, contractFile.mimetype)
    : parsePastedText(body.contractText!, "Pasted text");
  const fileSize = contractFile ? contractFile.size : Buffer.byteLength(body.contractText!, "utf8");

  let policy: ParsedDocument | null = null;
  if (policyFile) policy = await parseUploadedFile(policyFile.buffer, policyFile.originalname, policyFile.mimetype);
  else if (body.policyText?.trim()) policy = parsePastedText(body.policyText, "Pasted policy");

  return { doc, fileSize, policy, name: body.name };
}

function defaultName(intake: Intake): string {
  if (intake.name) return intake.name;
  if (intake.doc.sourceType !== "text") return sanitizeFilename(intake.doc.filename).replace(/\.(pdf|docx)$/i, "");
  const first = intake.doc.text.split("\n").find((l) => l.trim().length > 3) ?? "Pasted contract";
  return first.trim().slice(0, 80);
}

async function createVersion(contractId: unknown, intake: Intake) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const last: any = await ContractVersion.findOne({ contractId }).sort({ versionNumber: -1 }).select("versionNumber").lean();
    const versionNumber = (last?.versionNumber ?? 0) + 1;
    try {
      return await ContractVersion.create({
        contractId,
        versionNumber,
        filename: intake.doc.filename,
        sourceType: intake.doc.sourceType,
        fileSize: intake.fileSize,
        uploadedAt: new Date(),
        documentText: intake.doc.text,
        sections: splitSections(intake.doc.text),
        organizationPolicyText: intake.policy?.text ?? "",
        policyFilename: intake.policy?.filename ?? "",
        policySections: intake.policy ? splitSections(intake.policy.text) : [],
        extractionStatus: "uploaded",
      });
    } catch (err: any) {
      if (err?.code === 11000) continue; // concurrent upload took the number — retry
      throw err;
    }
  }
  throw Errors.conflict("Another upload for this contract is in progress. Please try again.");
}

async function getContractOr404(id: string) {
  assertObjectId(id, "Contract");
  const c: any = await Contract.findById(id).lean();
  if (!c) throw Errors.notFound("Contract");
  return c;
}

const countStatuses = (items: { reviewStatus: string }[]) => {
  const c = { total: items.length, pending: 0, approved: 0, edited: 0, rejected: 0, stale: 0 };
  for (const i of items) (c as any)[i.reviewStatus]++;
  return c;
};

// ------------------------------------------------------------------ create contract (+ version 1)
contractsRouter.post(
  "/",
  uploadFields,
  wrap(async (req, res) => {
    const intake = await readIntake(req);
    const contract: any = await Contract.create({
      name: defaultName(intake),
      originalFilename: intake.doc.filename,
      sourceType: intake.doc.sourceType,
    });
    let version: any;
    try {
      version = await createVersion(contract._id, intake);
    } catch (err) {
      await Contract.deleteOne({ _id: contract._id }); // do not leave an empty contract behind
      throw err;
    }
    await Contract.updateOne({ _id: contract._id }, { $set: { currentVersionId: version._id } });
    await logEvent({
      contractId: contract._id,
      versionId: version._id,
      versionNumber: 1,
      action: "contract_uploaded",
      message: `Contract "${contract.name}" uploaded (${intake.doc.filename}); version 1 created`,
    });
    res.status(201).json({
      contract: { id: String(contract._id), name: contract.name, sourceType: contract.sourceType, originalFilename: contract.originalFilename },
      version: plainVersion(version.toObject()),
    });
  }),
);

// ------------------------------------------------------------------ list
contractsRouter.get(
  "/",
  wrap(async (_req, res) => {
    const today = todayISO();
    const entries = await loadPortfolio(today);
    const out = entries.map((e) => {
      const dated = e.rows.filter((r) => r.dueDate && r.reviewStatus !== "rejected").sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1));
      const next = dated.find((r) => r.dueDate! >= today) ?? dated[0] ?? null;
      const itemCounts = countStatuses(e.items);
      return {
        id: String(e.contract._id),
        name: e.contract.name,
        originalFilename: e.contract.originalFilename,
        sourceType: e.contract.sourceType,
        createdAt: e.contract.createdAt,
        updatedAt: e.contract.updatedAt,
        versionCount: e.versionCount,
        currentVersion: e.currentVersion
          ? { id: String(e.currentVersion._id), versionNumber: e.currentVersion.versionNumber, extractionStatus: e.currentVersion.extractionStatus }
          : null,
        pendingNewVersion: e.pendingNewVersion,
        counts: itemCounts,
        needsReview: itemCounts.pending + itemCounts.stale > 0,
        nextDeadline: next ? { title: next.title, dueDate: next.dueDate, status: next.status } : null,
      };
    });
    res.json({ contracts: out });
  }),
);

// ------------------------------------------------------------------ detail
contractsRouter.get(
  "/:id",
  wrap(async (req, res) => {
    const contract = await getContractOr404(req.params.id);
    const versions: any[] = await ContractVersion.find({ contractId: contract._id }, "-documentText -sections -policySections -organizationPolicyText -extractionResult -policyResult")
      .sort({ versionNumber: -1 })
      .lean();
    const { effective, current } = pickEffectiveVersion(idStr(contract.currentVersionId), [...versions]);
    const items: any[] = await ExtractedItem.find({ contractId: contract._id }, "versionId reviewStatus").lean();
    res.json({
      contract: {
        id: String(contract._id),
        name: contract.name,
        originalFilename: contract.originalFilename,
        sourceType: contract.sourceType,
        createdAt: contract.createdAt,
        updatedAt: contract.updatedAt,
        currentVersionId: idStr(contract.currentVersionId),
        effectiveVersionId: effective ? String(effective._id) : null,
        currentVersionNumber: current?.versionNumber ?? null,
      },
      versions: versions.map((v) =>
        plainVersion({ ...v, documentText: "", sections: [] }, {
          counts: countStatuses(items.filter((i) => String(i.versionId) === String(v._id))),
          isCurrent: current ? String(current._id) === String(v._id) : false,
        }),
      ),
    });
  }),
);

contractsRouter.patch(
  "/:id",
  wrap(async (req, res) => {
    const contract = await getContractOr404(req.params.id);
    const { name } = z.object({ name: z.string().trim().min(1).max(200) }).parse(req.body);
    await Contract.updateOne({ _id: contract._id }, { $set: { name } });
    res.json({ id: String(contract._id), name });
  }),
);

// ------------------------------------------------------------------ versions
contractsRouter.post(
  "/:id/versions",
  uploadFields,
  wrap(async (req, res) => {
    const contract = await getContractOr404(req.params.id);
    const intake = await readIntake(req);
    const version = await createVersion(contract._id, intake);
    await Contract.updateOne({ _id: contract._id }, { $set: { currentVersionId: version._id } });
    await logEvent({
      contractId: contract._id,
      versionId: version._id,
      versionNumber: version.versionNumber,
      action: "version_uploaded",
      message: `Version ${version.versionNumber} uploaded (${intake.doc.filename})`,
    });
    res.status(201).json({ version: plainVersion(version.toObject()) });
  }),
);

contractsRouter.get(
  "/:id/versions",
  wrap(async (req, res) => {
    const contract = await getContractOr404(req.params.id);
    const versions: any[] = await ContractVersion.find({ contractId: contract._id }, "-documentText -sections -policySections -organizationPolicyText -extractionResult -policyResult")
      .sort({ versionNumber: -1 })
      .lean();
    res.json({
      versions: versions.map((v) => plainVersion({ ...v, documentText: "", sections: [] }, { isCurrent: idStr(contract.currentVersionId) === String(v._id) })),
    });
  }),
);

async function getVersionOr404(contractId: string, versionId: string) {
  assertObjectId(versionId, "Version");
  const v: any = await ContractVersion.findOne({ _id: versionId, contractId }).lean();
  if (!v) throw Errors.notFound("Version");
  return v;
}

contractsRouter.get(
  "/:id/versions/:versionId",
  wrap(async (req, res) => {
    const contract = await getContractOr404(req.params.id);
    const v = await getVersionOr404(String(contract._id), req.params.versionId);
    res.json({ version: plainVersion(v, { isCurrent: idStr(contract.currentVersionId) === String(v._id) }) });
  }),
);

/** Full parsed text + sections (used by the document viewer). */
contractsRouter.get(
  "/:id/versions/:versionId/document",
  wrap(async (req, res) => {
    const contract = await getContractOr404(req.params.id);
    const v = await getVersionOr404(String(contract._id), req.params.versionId);
    res.json({ versionNumber: v.versionNumber, filename: v.filename, text: v.documentText, sections: v.sections });
  }),
);

contractsRouter.post(
  "/:id/versions/:versionId/analyze",
  wrap(async (req, res) => {
    const contract = await getContractOr404(req.params.id);
    const v = await getVersionOr404(String(contract._id), req.params.versionId);
    getExtractor(); // fail fast with a clear message when no AI provider is configured
    const claimed = await claimForAnalysis(String(v._id));
    if (!claimed) {
      throw Errors.conflict(
        v.extractionStatus === "complete"
          ? "This version has already been analyzed. Upload a new version to analyze changed text."
          : "This version is already being analyzed.",
      );
    }
    startAnalysis(claimed);
    res.status(202).json({ version: plainVersion(claimed), message: "Analysis started" });
  }),
);

// ------------------------------------------------------------------ items for a version (+ computed dates)
async function resolveVersionForRead(contract: any, versionIdParam?: string) {
  if (versionIdParam) return getVersionOr404(String(contract._id), versionIdParam);
  const versions: any[] = await ContractVersion.find({ contractId: contract._id }, "versionNumber extractionStatus").lean();
  const { effective, current } = pickEffectiveVersion(idStr(contract.currentVersionId), versions);
  const target = effective ?? current;
  if (!target) throw Errors.notFound("Version");
  return ContractVersion.findById(target._id, "-documentText -sections -policySections -organizationPolicyText").lean() as Promise<any>;
}

contractsRouter.get(
  "/:id/items",
  wrap(async (req, res) => {
    const contract = await getContractOr404(req.params.id);
    const version = await resolveVersionForRead(contract, typeof req.query.versionId === "string" ? req.query.versionId : undefined);
    const docs: any[] = await ExtractedItem.find({ versionId: version._id }).sort({ order: 1 }).lean();
    const items = docs.map(plainItem);
    const ref: ContractRef = { contractId: String(contract._id), contractName: contract.name, versionId: String(version._id), versionNumber: version.versionNumber };
    const today = todayISO();
    const { rows, card } = computeAllRows(items as unknown as PlainItem[], ref, today, deadlineConfig());
    const byItem = new Map(rows.filter((r) => r.kind === "obligation" && r.itemId).map((r) => [r.itemId!, r]));

    const withComputed = items.map((it) => {
      let computed: Record<string, unknown> | null = null;
      if (it.category === "obligation") {
        const r = byItem.get(it.id);
        if (r) computed = { dueDate: r.dueDate, reminderDate: r.reminderDate, timeStatus: r.timeStatus, status: displayStatus(r), basis: r.basis, cannotCalculateReason: r.cannotCalculateReason };
      } else if (it.category === "notice" && card?.notice?.itemIds.includes(it.id) && it.data.type === "renewal") {
        computed = { noticeDeadline: card.noticeDeadline, reminderDate: card.reminderDate, timeStatus: card.timeStatus, cannotCalculateReason: card.cannotCalculateReason, termEnd: card.currentTermEnd };
      } else if (it.category === "expiry" && card?.expiry.itemId === it.id) {
        computed = { date: card.currentTermEnd, derived: card.expiry.derived, explanation: card.expiry.explanation, reason: card.expiry.reason, timeStatus: getTimeStatus(card.currentTermEnd, today, deadlineConfig().dueSoonDays) };
      }
      return { ...it, computed };
    });

    res.json({
      version: plainVersion(version, { isCurrent: idStr(contract.currentVersionId) === String(version._id) }),
      items: withComputed,
      renewalCard: card ? { ...card, status: card.timeStatus } : null,
      counts: countStatuses(items),
      today,
    });
  }),
);

// ------------------------------------------------------------------ summary
contractsRouter.get(
  "/:id/summary",
  wrap(async (req, res) => {
    const contract = await getContractOr404(req.params.id);
    const versions: any[] = await ContractVersion.find({ contractId: contract._id }, "versionNumber extractionStatus filename uploadedAt").lean();
    const { effective } = pickEffectiveVersion(idStr(contract.currentVersionId), versions);
    if (!effective) throw new AppError(409, "NOT_ANALYZED", "A summary is available once a contract version has been analyzed.");

    const docs: any[] = await ExtractedItem.find({ versionId: effective._id }).sort({ order: 1 }).lean();
    const items = docs.map(plainItem);
    const ref: ContractRef = { contractId: String(contract._id), contractName: contract.name, versionId: String(effective._id), versionNumber: effective.versionNumber };
    const { rows, card } = computeAllRows(items as unknown as PlainItem[], ref, todayISO(), deadlineConfig());
    const summary = buildSummary({
      contractName: contract.name,
      filename: effective.filename,
      versionNumber: effective.versionNumber,
      uploadedAt: effective.uploadedAt,
      items: items as any,
      rows,
      card,
      statusOf: displayStatus,
    });

    if (req.query.log === "true") {
      await logEvent({
        contractId: contract._id,
        versionId: effective._id,
        versionNumber: effective.versionNumber,
        action: "summary_generated",
        message: `Reviewed summary generated for version ${effective.versionNumber} (${summary.reviewStatusLine})`,
      });
    }
    if (req.query.format === "markdown") {
      res.type("text/markdown").send(summaryToMarkdown(summary));
      return;
    }
    res.json({ summary, markdown: summaryToMarkdown(summary) });
  }),
);

// ------------------------------------------------------------------ audit history
contractsRouter.get(
  "/:id/audit-history",
  wrap(async (req, res) => {
    const contract = await getContractOr404(req.params.id);
    const filter: Record<string, unknown> = { contractId: contract._id };
    if (typeof req.query.itemId === "string") filter.itemId = assertObjectId(req.query.itemId, "Item");
    const events: any[] = await AuditEvent.find(filter).sort({ timestamp: -1, _id: -1 }).limit(500).lean();
    res.json({ events: events.map(plainEvent) });
  }),
);
