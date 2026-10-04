import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { ZodError } from "zod";
import { config } from "../config.js";
import { AppError, Errors } from "../utils/errors.js";

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "That endpoint does not exist." } });
}

const DB_ERROR_NAMES = new Set([
  "MongoNetworkError",
  "MongoServerSelectionError",
  "MongooseServerSelectionError",
  "MongoNetworkTimeoutError",
  "MongoNotConnectedError",
  "MongoTopologyClosedError",
]);

/** Never leaks stack traces or internals to the client; details are logged server-side only. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  let app: AppError;
  if (err instanceof AppError) app = err;
  else if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") app = Errors.fileTooLarge(Math.round(config.maxUploadBytes / 1024 / 1024));
    else if (err.code === "LIMIT_UNEXPECTED_FILE" || err.code === "LIMIT_FILE_COUNT") app = Errors.tooManyFiles();
    else app = Errors.badRequest("The upload could not be processed.");
  } else if (err instanceof ZodError) {
    app = Errors.badRequest(
      "The request was not valid: " + err.issues.slice(0, 4).map((i) => `${i.path.join(".") || "body"} — ${i.message}`).join("; "),
      err.issues,
    );
  } else if (err instanceof SyntaxError && "body" in (err as object)) {
    app = Errors.badRequest("The request body is not valid JSON.");
  } else if (err instanceof Error && DB_ERROR_NAMES.has(err.name)) {
    console.error("[db]", err.message);
    app = Errors.database();
  } else {
    console.error("[error]", err);
    app = new AppError(500, "INTERNAL_ERROR", "Something went wrong on the server. Please try again.");
  }
  res.status(app.status).json({ error: { code: app.code, message: app.message } });
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
export const wrap = (fn: AsyncHandler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res, next).catch(next);
};
