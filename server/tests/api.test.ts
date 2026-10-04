import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { connectDb, disconnectDb } from "../src/db.js";
import { setExtractor } from "../src/ai/provider.js";
import { DemoExtractor } from "../src/ai/demoExtractor.js";
import { whenIdle } from "../src/services/analysis.js";
import { buildPdf } from "../src/utils/buildDocs.js";

const fx = (n: string) => fs.readFileSync(path.resolve(__dirname, "../../fixtures", n), "utf8");
const V1 = fx("sample-vendor-agreement.txt");
const V2 = fx("sample-vendor-agreement-v2.txt");
const POLICY = fx("sample-organization-policy.txt");
const base = process.env.TEST_MONGODB_URI || "mongodb://127.0.0.1:27017";
const dbName = `contract_assistant_test_${Date.now()}`;

const app = createApp();
let contractId = "";
let v1 = "";
let v2 = "";

async function analyze(cid: string, vid: string) {
  const r = await request(app).post(`/api/contracts/${cid}/versions/${vid}/analyze`);
  expect(r.status).toBe(202);
  await whenIdle();
}
const items = async (cid: string, vid?: string) =>
  (await request(app).get(`/api/contracts/${cid}/items${vid ? `?versionId=${vid}` : ""}`)).body;

beforeAll(async () => {
  await connectDb(`${base}/${dbName}`);
  setExtractor(new DemoExtractor());
});
afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await disconnectDb();
});

describe("upload validation", () => {
  it("rejects missing input, unsupported types, and both file + text", async () => {
    expect((await request(app).post("/api/contracts").field("name", "x")).status).toBe(400);
    const bad = await request(app).post("/api/contracts").attach("contractFile", Buffer.from("hi"), "evil.exe");
    expect(bad.status).toBe(415);
    expect(bad.body.error.code).toBe("UNSUPPORTED_FILE");
    const both = await request(app).post("/api/contracts").field("contractText", V1).attach("contractFile", Buffer.from("x"), "a.pdf");
    expect(both.status).toBe(400);
  });
  it("rejects empty pasted text and corrupt PDFs with friendly messages", async () => {
    const empty = await request(app).post("/api/contracts").field("contractText", "short");
    expect(empty.status).toBe(422);
    expect(empty.body.error.message).not.toMatch(/at \w+\.(ts|js)/);
    const corrupt = await request(app).post("/api/contracts").attach("contractFile", Buffer.from("%PDF-1.4 junk junk junk"), "a.pdf");
    expect(corrupt.status).toBe(422);
    expect(corrupt.body.error.code).toBe("PDF_PARSE_FAILED");
  });
  it("accepts only one contract file", async () => {
    const r = await request(app)
      .post("/api/contracts")
      .attach("contractFile", Buffer.from("x"), "a.pdf")
      .attach("contractFile", Buffer.from("x"), "b.pdf");
    expect(r.status).toBe(400);
  });
});

describe("workflow", () => {
  it("creates a contract + version 1 from a real PDF with an optional policy", async () => {
    const pdf = await buildPdf(V1);
    const r = await request(app)
      .post("/api/contracts")
      .attach("contractFile", pdf, "Vendor Agreement.pdf")
      .field("policyText", POLICY);
    expect(r.status).toBe(201);
    contractId = r.body.contract.id;
    v1 = r.body.version.id;
    expect(r.body.version).toMatchObject({ versionNumber: 1, sourceType: "pdf", extractionStatus: "uploaded", hasPolicy: true });
    expect(r.body.version.fileSize).toBeGreaterThan(1000);
  });

  it("analyzes, and a duplicate analyze request is refused", async () => {
    await analyze(contractId, v1);
    const again = await request(app).post(`/api/contracts/${contractId}/versions/${v1}/analyze`);
    expect(again.status).toBe(409);
    const body = await items(contractId, v1);
    expect(body.version.extractionStatus).toBe("complete");
    expect(body.items.length).toBeGreaterThan(15);
    expect(body.counts.pending).toBe(body.items.length);
    expect(body.items.every((i: any) => i.source.exactText && i.source.verified)).toBe(true);
    // policy kept separate from the contract
    expect(body.items.filter((i: any) => i.category === "policyNote")).toHaveLength(1);
    expect(body.items.find((i: any) => i.category === "policyNote").extraSources[0].document).toBe("policy");
  });

  it("calculates renewal deadlines in code", async () => {
    const body = await items(contractId, v1);
    const card = body.renewalCard;
    expect(card.expiry).toMatchObject({ date: "2028-01-14", derived: true });
    expect(card.noticeDeadline).toBe("2027-11-15"); // 2028-01-14 minus 60 days
    expect(card.notice).toMatchObject({ value: 60, unit: "days" });
    expect(card.policy.internalReviewDate).toBe("2027-10-16"); // 90 days — kept separate from the contract date
  });

  let noticeId = "";
  it("approve is idempotent and audited exactly once", async () => {
    const body = await items(contractId, v1);
    noticeId = body.items.find((i: any) => i.category === "notice" && i.data.type === "renewal").id;
    const [a, b] = await Promise.all([request(app).post(`/api/items/${noticeId}/approve`), request(app).post(`/api/items/${noticeId}/approve`)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.body.changed, b.body.changed].filter(Boolean)).toHaveLength(1);
    const audit = await request(app).get(`/api/contracts/${contractId}/audit-history`);
    expect(audit.body.events.filter((e: any) => e.action === "item_approved" && e.itemId === noticeId)).toHaveLength(1);
  });

  it("edit preserves the original AI extraction and records the correction", async () => {
    const r = await request(app).patch(`/api/items/${noticeId}`).send({ data: { noticePeriodValue: 45 } });
    expect(r.status).toBe(200);
    expect(r.body.item).toMatchObject({ reviewStatus: "edited", data: { noticePeriodValue: 45 }, userCorrection: { noticePeriodValue: 45 } });
    expect(r.body.item.original.noticePeriodValue).toBe(60);
    const bad = await request(app).patch(`/api/items/${noticeId}`).send({ data: { noticePeriodValue: "abc" } });
    expect(bad.status).toBe(400);
    const edit = (await request(app).get(`/api/contracts/${contractId}/audit-history`)).body.events.find((e: any) => e.action === "item_edited");
    expect(edit.previousValue.noticePeriodValue).toBe(60);
    expect(edit.newValue.noticePeriodValue).toBe(45);
    // restore for later steps
    await request(app).patch(`/api/items/${noticeId}`).send({ data: { noticePeriodValue: 60 } });
    await request(app).post(`/api/items/${noticeId}/approve`);
  });

  it("reject works and is idempotent", async () => {
    const body = await items(contractId, v1);
    const ambiguity = body.items.find((i: any) => i.category === "ambiguity" && /promptly/.test(i.data.description));
    const r1 = await request(app).post(`/api/items/${ambiguity.id}/reject`).send({ note: "not relevant" });
    const r2 = await request(app).post(`/api/items/${ambiguity.id}/reject`).send({});
    expect(r1.body).toMatchObject({ changed: true, item: { reviewStatus: "rejected", reviewNote: "not relevant" } });
    expect(r2.body.changed).toBe(false);
  });

  it("approves several more items (including renewal/expiry/obligations) for the stale test", async () => {
    const body = await items(contractId, v1);
    const ids = body.items.filter((i: any) => ["renewal", "expiry", "obligation", "party"].includes(i.category)).map((i: any) => i.id);
    for (const id of ids) await request(app).post(`/api/items/${id}/approve`);
    expect(ids.length).toBeGreaterThan(8);
  });

  it("source viewer returns the section text with a highlight range", async () => {
    const r = await request(app).get(`/api/items/${noticeId}/source`);
    expect(r.status).toBe(200);
    const c = r.body.citations[0];
    expect(c).toMatchObject({ sectionNumber: "2.2", sectionTitle: "Automatic Renewal", verified: true });
    expect(c.sectionText.slice(c.highlight.start, c.highlight.end)).toMatch(/at least sixty \(60\) days before the end/i);
  });

  it("uploads version 2 without destroying version 1, then flags changed approved items as stale", async () => {
    const r = await request(app).post(`/api/contracts/${contractId}/versions`).field("contractText", V2);
    expect(r.status).toBe(201);
    v2 = r.body.version.id;
    expect(r.body.version.versionNumber).toBe(2);
    await analyze(contractId, v2);

    const versions = (await request(app).get(`/api/contracts/${contractId}/versions`)).body.versions;
    expect(versions.map((v: any) => v.versionNumber)).toEqual([2, 1]);
    expect(versions.find((v: any) => v.versionNumber === 2).isCurrent).toBe(true);

    const body2 = await items(contractId, v2);
    expect(body2.version.comparison).toMatchObject({ comparedToVersionNumber: 1, error: null });
    const stale = body2.items.filter((i: any) => i.reviewStatus === "stale");
    const staleNotice = stale.find((i: any) => i.category === "notice" && i.data.type === "renewal");
    expect(staleNotice.stale.previousApprovedValue.noticePeriodValue).toBe(60);
    expect(staleNotice.stale.newValue.noticePeriodValue).toBe(90);
    expect(staleNotice.stale.reason).toMatch(/changed/);
    // the removed "promptly" clause was rejected, so it is not resurrected as stale
    expect(stale.some((i: any) => i.category === "obligation" && /data access/.test(i.data.description))).toBe(false);
    // unchanged approved items keep their decision
    const carried = body2.items.filter((i: any) => i.carriedFromItemId);
    expect(carried.length).toBeGreaterThan(5);
    expect(carried.every((i: any) => ["approved", "edited", "rejected"].includes(i.reviewStatus))).toBe(true);
    // v1 untouched
    const body1 = await items(contractId, v1);
    expect(body1.items.some((i: any) => i.reviewStatus === "stale")).toBe(false);

    const audit = (await request(app).get(`/api/contracts/${contractId}/audit-history`)).body.events;
    expect(audit.some((e: any) => e.action === "item_marked_stale")).toBe(true);
    expect(audit.some((e: any) => e.action === "version_uploaded")).toBe(true);
  });

  it("a clause replaced in place is flagged as changed, showing the previously approved value", async () => {
    const body2 = await items(contractId, v2);
    const replaced = body2.items.find((i: any) => i.reviewStatus === "stale" && i.category === "obligation" && /security incident/.test(i.data.description));
    expect(replaced.stale.previousApprovedValue.description).toMatch(/data access requests/);
    expect(replaced.stale.disappeared).toBe(false);
  });

  it("re-approving a stale item clears the stale flag path (status becomes approved)", async () => {
    const body2 = await items(contractId, v2);
    const s = body2.items.find((i: any) => i.reviewStatus === "stale" && i.category === "notice");
    const r = await request(app).post(`/api/items/${s.id}/approve`);
    expect(r.body.item.reviewStatus).toBe("approved");
  });

  it("generates a reviewed summary for the current version", async () => {
    const r = await request(app).get(`/api/contracts/${contractId}/summary?log=true`);
    expect(r.status).toBe(200);
    const s = r.body.summary;
    expect(s.basedOn).toMatch(/Contract Version 2/);
    expect(s.disclaimer).toMatch(/does not provide legal advice/);
    expect(s.parties.length).toBe(2);
    expect(r.body.markdown).toContain("## 12. Items that remain uncertain");
    const audit = (await request(app).get(`/api/contracts/${contractId}/audit-history`)).body.events;
    expect(audit.some((e: any) => e.action === "summary_generated")).toBe(true);
  });

  it("an approved item whose clause is removed in v3 is re-created as stale and still traceable to the old text", async () => {
    const V3 = V2.replace(/^4\.2 Account Manager\..*\n/m, "");
    expect(V3).not.toBe(V2);
    const r = await request(app).post(`/api/contracts/${contractId}/versions`).field("contractText", V3);
    const v3 = r.body.version.id;
    expect(r.body.version.versionNumber).toBe(3);
    await analyze(contractId, v3);
    const body3 = await items(contractId, v3);
    const gone = body3.items.find((i: any) => i.reviewStatus === "stale" && i.stale.disappeared);
    expect(gone.data.description).toMatch(/account manager/);
    expect(gone.stale.reason).toMatch(/not found in the newer version/);
    expect(gone.source.versionNumber).toBe(2);
    const src = await request(app).get(`/api/items/${gone.id}/source`);
    expect(src.body.citations[0]).toMatchObject({ versionNumber: 2, verified: true });
    expect(src.body.citations[0].sectionText).toMatch(/Account Manager/);
    // earlier decisions in v3 that did not change are still carried (v2 was compared, not v1)
    expect(body3.version.comparison.comparedToVersionNumber).toBe(2);
  });

  it("dashboard, obligations and deadlines reflect deterministic dates", async () => {
    const d = (await request(app).get("/api/dashboard?today=2026-10-03")).body;
    expect(d.cards.contracts).toBe(1);
    expect(d.cards.needsReview).toBe(1);
    expect(d.deadlines.length).toBeGreaterThan(0);
    const ob = (await request(app).get("/api/obligations?today=2026-10-03&status=due_soon")).body;
    expect(ob.rows.every((r: any) => r.timeStatus === "due_soon")).toBe(true);
    const monthly = (await request(app).get("/api/obligations?today=2026-10-03")).body.rows.find((r: any) => /service-usage report/.test(r.title));
    expect(monthly).toMatchObject({ dueDate: "2026-10-05", status: expect.any(String) });
    const dl = (await request(app).get("/api/deadlines?today=2026-10-03")).body.cards[0];
    expect(dl.noticeDeadline).toBe("2027-10-16"); // v2: 90 days before 2028-01-14
    const late = (await request(app).get("/api/dashboard?today=2030-01-01")).body;
    expect(late.deadlines.some((r: any) => r.timeStatus === "overdue")).toBe(true);
  });

  it("returns clean errors for unknown ids", async () => {
    expect((await request(app).get("/api/contracts/not-an-id")).status).toBe(404);
    expect((await request(app).post("/api/items/ffffffffffffffffffffffff/approve")).status).toBe(404);
    const r = await request(app).get("/api/nope");
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("NOT_FOUND");
  });
});

describe("AI failures surface as friendly, recoverable errors", () => {
  it("marks the version failed with a message; retry is allowed", async () => {
    const created = await request(app).post("/api/contracts").field("contractText", V1);
    const cid = created.body.contract.id;
    const vid = created.body.version.id;
    setExtractor({ name: "broken", extractContract: async () => ({ junk: true }), analyzePolicy: async () => ({ policyNotes: [] }) });
    await analyze(cid, vid);
    const failed = (await request(app).get(`/api/contracts/${cid}/versions/${vid}`)).body.version;
    expect(failed.extractionStatus).toBe("failed");
    expect(failed.extractionError.code).toBe("AI_MALFORMED_RESPONSE");
    setExtractor(new DemoExtractor());
    await analyze(cid, vid);
    expect((await items(cid, vid)).version.extractionStatus).toBe("complete");
  });
});
