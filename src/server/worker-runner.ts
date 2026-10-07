import { VerificationWorker } from "./worker";
import { logger } from "@/lib/utils/logger";

const worker = new VerificationWorker();

logger.info("Iniciando runner independente do VerificationWorker...");

process.on("SIGINT", () => {
  logger.info("Encerrando worker (SIGINT)...");
  worker.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger.info("Encerrando worker (SIGTERM)...");
  worker.stop();
  process.exit(0);
});

worker.startPollingLoop(4000).catch((err) => {
  logger.error("Falha fatal no worker runner", err);
  process.exit(1);
});
