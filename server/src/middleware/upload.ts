import multer from "multer";
import path from "node:path";
import { config } from "../config.js";
import { Errors } from "../utils/errors.js";

const ALLOWED_EXT = new Set([".pdf", ".docx"]);

/**
 * One contract file and one optional policy file, held in memory (never written to disk).
 * Size is limited; type is checked here by extension and again by magic bytes in the parser.
 */
export const uploadFields = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 2, fields: 10, fieldSize: config.maxDocumentChars * 2 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      return cb(Errors.unsupportedFile(`"${path.basename(file.originalname || "file")}" is not supported. Only PDF and DOCX files are accepted.`));
    }
    cb(null, true);
  },
}).fields([
  { name: "contractFile", maxCount: 1 },
  { name: "policyFile", maxCount: 1 },
]);
