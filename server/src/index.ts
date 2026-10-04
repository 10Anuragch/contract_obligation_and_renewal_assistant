import { createApp } from "./app.js";
import { config } from "./config.js";
import { connectDb, recoverInterruptedAnalyses } from "./db.js";
import { aiStatus } from "./ai/provider.js";

async function main() {
  try {
    await connectDb();
    const recovered = await recoverInterruptedAnalyses();
    if (recovered) console.warn(`[startup] marked ${recovered} interrupted analysis job(s) as failed`);
  } catch (err) {
    console.error(`[startup] Could not connect to MongoDB at ${config.mongoUri.replace(/\/\/[^@]*@/, "//***@")}.`);
    console.error("          Start MongoDB (see README) or set MONGODB_URI in .env, then restart.");
    console.error(`          ${(err as Error).message}`);
    process.exit(1);
  }
  const ai = aiStatus();
  if (!ai.configured) console.warn("[startup] No AI provider configured — set OPENAI_API_KEY (or AI_PROVIDER=demo). Uploads work; analysis will be refused.");
  else console.log(`[startup] AI provider: ${ai.provider}`);

  createApp().listen(config.port, () => console.log(`[startup] API listening on http://localhost:${config.port}`));
}

main();
