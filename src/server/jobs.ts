import { createAdminClient } from "@/lib/supabase/admin";
import { VerificationWorker } from "./worker";
import { logger } from "@/lib/utils/logger";

export async function enqueueVerificationJob(receiptId: string): Promise<string> {
  const supabase = createAdminClient();

  // Cria o registro do job com status 'queued'
  const { data: job, error } = await supabase
    .from("verification_jobs")
    .insert({
      receipt_id: receiptId,
      status: "queued",
      attempts: 0,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !job) {
    throw new Error(`Erro ao enfileirar job de verificação: ${error?.message}`);
  }

  // Dispara processamento em background de forma desatrelada da requisição HTTP (não bloqueante)
  const worker = new VerificationWorker();
  setImmediate(async () => {
    try {
      await worker.processJob(job.id);
    } catch (err) {
      logger.error("Falha na execução em background do job", err, { jobId: job.id });
    }
  });

  return job.id;
}
