/** Generates PDF and DOCX versions of the sample fixtures: `npm run sample` */
import fs from "node:fs/promises";
import path from "node:path";
import { buildDocx, buildPdf } from "./buildDocs.js";

const dir = path.resolve(process.cwd(), "../fixtures");
const names = ["sample-vendor-agreement", "sample-vendor-agreement-v2", "sample-organization-policy"];

for (const n of names) {
  const text = await fs.readFile(path.join(dir, `${n}.txt`), "utf8");
  await fs.writeFile(path.join(dir, `${n}.pdf`), await buildPdf(text));
  await fs.writeFile(path.join(dir, `${n}.docx`), await buildDocx(text));
  console.log(`wrote ${n}.pdf and ${n}.docx`);
}
