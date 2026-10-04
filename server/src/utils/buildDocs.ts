/**
 * Builds real PDF / DOCX binaries from plain text. Dev-only: used by the sample-file generator and the tests so the
 * parsers are exercised against genuine files. (Not imported by the running application.)
 */
import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, TextRun } from "docx";

export function buildPdf(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.font("Helvetica").fontSize(10.5);
    for (const para of text.split(/\n{2,}/)) {
      for (const line of para.split("\n")) {
        const isTitle = line === line.toUpperCase() && line.trim().length > 6 && !/\d/.test(line);
        doc.font(isTitle ? "Helvetica-Bold" : "Helvetica").text(line, { paragraphGap: 2 });
      }
      doc.moveDown(0.6);
    }
    doc.end();
  });
}

export async function buildDocx(text: string): Promise<Buffer> {
  const paragraphs: Paragraph[] = [];
  for (const para of text.split(/\n{2,}/)) {
    for (const line of para.split("\n")) {
      const isTitle = line === line.toUpperCase() && line.trim().length > 6 && !/\d/.test(line);
      paragraphs.push(new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: line, bold: isTitle })] }));
    }
    paragraphs.push(new Paragraph({ children: [] }));
  }
  const doc = new Document({ sections: [{ children: paragraphs }] });
  return Buffer.from(await Packer.toBuffer(doc));
}
