const { spawn } = require("child_process");

console.log("[INIT] Iniciando Mercado Pago Verifier em produção...");

// 1. Inicia o servidor Web Next.js
const webProcess = spawn("node", ["server.js"], {
  stdio: "inherit",
  env: { ...process.env, PORT: process.env.PORT || "3000" },
});

webProcess.on("exit", (code) => {
  console.error(`[WEB] Processo Web finalizou com código ${code}`);
  process.exit(code || 1);
});

// 2. Inicia o Worker de Background
const workerProcess = spawn("node", ["dist/worker.js"], {
  stdio: "inherit",
  env: process.env,
});

workerProcess.on("exit", (code) => {
  console.warn(`[WORKER] Processo Worker finalizou com código ${code}`);
});

process.on("SIGTERM", () => {
  console.log("[INIT] Encerrando processos...");
  webProcess.kill("SIGTERM");
  workerProcess.kill("SIGTERM");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("[INIT] Encerrando processos...");
  webProcess.kill("SIGINT");
  workerProcess.kill("SIGINT");
  process.exit(0);
});
