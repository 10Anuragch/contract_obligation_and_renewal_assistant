import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config.js";
import { contractsRouter } from "./routes/contracts.js";
import { itemsRouter } from "./routes/items.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: [config.clientOrigin, /^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] }));
  app.use(express.json({ limit: "5mb" }));

  app.use("/api/contracts", contractsRouter);
  app.use("/api/items", itemsRouter);
  app.use("/api", dashboardRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
