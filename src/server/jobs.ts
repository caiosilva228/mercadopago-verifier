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
      job_type: "verify_receipt",
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

export interface EnqueueBalanceOptions {
  force?: boolean;
  userId?: string;
}

export interface EnqueueBalanceResult {
  cached: boolean;
  jobId?: string;
  snapshot?: any;
}

/**
 * Enfileira a atualização de saldo via Release Report respeitando cache de 2 minutos
 */
export async function enqueueBalanceRefreshJob(
  options: EnqueueBalanceOptions = {}
): Promise<EnqueueBalanceResult> {
  const supabase = createAdminClient();

  // 51. NÃO GERAR RELATÓRIO DEMAIS (Cache de 2 minutos)
  if (!options.force) {
    const { data: latestSnapshot } = await supabase
      .from("mercadopago_balance_snapshots")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestSnapshot) {
      const ageMs = Date.now() - new Date(latestSnapshot.created_at).getTime();
      const twoMinutesMs = 2 * 60 * 1000;
      if (ageMs < twoMinutesMs) {
        logger.info("Retornando saldo do cache (menos de 2 minutos da última consulta)", {
          snapshotId: latestSnapshot.id,
          ageSeconds: Math.round(ageMs / 1000),
        });
        return {
          cached: true,
          snapshot: latestSnapshot,
        };
      }
    }
  }

  // Se não estiver no cache ou forçada, cria o job
  const { data: job, error } = await supabase
    .from("verification_jobs")
    .insert({
      job_type: "refresh_balance",
      status: "queued",
      attempts: 0,
      metadata: { force: !!options.force },
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !job) {
    throw new Error(`Erro ao enfileirar job de saldo: ${error?.message}`);
  }

  // Auditoria: balance_refresh_requested
  await supabase.from("audit_logs").insert({
    user_id: options.userId || null,
    event_type: "balance_refresh_requested",
    entity_type: "balance",
    entity_id: null,
    metadata: {
      jobId: job.id,
      force: !!options.force,
    },
  });

  // Disparo assíncrono não-bloqueante
  const worker = new VerificationWorker();
  setImmediate(async () => {
    try {
      await worker.processJob(job.id);
    } catch (err) {
      logger.error("Falha na execução em background do refresh de saldo", err, { jobId: job.id });
    }
  });

  return {
    cached: false,
    jobId: job.id,
  };
}

