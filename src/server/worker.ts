import { createAdminClient } from "@/lib/supabase/admin";
import { MercadoPagoProvider } from "@/lib/mercadopago/provider";
import { PaymentMatcher } from "@/lib/mercadopago/matcher";
import { getArgentinaDayUtcRange } from "@/lib/utils/timezone";
import { logger } from "@/lib/utils/logger";
import { DateTime } from "luxon";
import { MercadoPagoTransaction } from "@/types";

export class VerificationWorker {
  private readonly mpProvider: MercadoPagoProvider;
  private isRunning: boolean = false;

  constructor() {
    this.mpProvider = new MercadoPagoProvider();
  }

  /**
   * Processa um job de verificação específico de ponta a ponta
   */
  async processJob(jobId: string): Promise<void> {
    const supabase = createAdminClient();

    // 1. Busca o job e os dados do comprovante
    const { data: job, error: jobErr } = await supabase
      .from("verification_jobs")
      .select("*, receipts(*)")
      .eq("id", jobId)
      .single();

    if (jobErr || !job || !job.receipts) {
      logger.error("Job de verificação não encontrado", jobErr, { jobId });
      return;
    }

    const receipt = job.receipts;
    const targetDateStr: string = receipt.transaction_date;

    if (!targetDateStr) {
      await this.updateJobStatus(jobId, "error", {
        errorCode: "MISSING_DATE",
        errorMessage: "Data do comprovante não informada.",
      });
      return;
    }

    try {
      // 2. Garante a configuração de colunas do relatório no Mercado Pago
      await this.updateJobStatus(jobId, "checking_report");
      await this.mpProvider.ensureConfiguration();

      // 3. Verifica Cache de Relatórios para a data em questão
      let reportId: string | null = null;
      let csvContent: string | null = null;

      // Busca se já existe um relatório salvo no banco para a data
      const { data: existingReport } = await supabase
        .from("mercadopago_reports")
        .select("*")
        .eq("report_date", targetDateStr)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const isToday = DateTime.now().setZone("America/Argentina/Buenos_Aires").toFormat("yyyy-MM-dd") === targetDateStr;

      // Se existir relatório 'available' e não for o dia de hoje (ou gerado recentemente)
      if (existingReport && existingReport.status === "available" && existingReport.file_name_csv) {
        const canReuse = !isToday || (existingReport.downloaded_at && (Date.now() - new Date(existingReport.downloaded_at).getTime()) < 10 * 60 * 1000);
        
        if (canReuse) {
          logger.info("Reutilizando relatório existente do cache", {
            reportId: existingReport.id,
            date: targetDateStr,
          });
          reportId = existingReport.id;
        }
      }

      // Se precisar gerar ou aguardar novo relatório
      if (!reportId) {
        let taskId: string;

        // Verifica se há um relatório que já está em status 'pending' para essa data
        if (existingReport && existingReport.status === "pending" && existingReport.mercadopago_task_id) {
          taskId = existingReport.mercadopago_task_id;
          reportId = existingReport.id;
          logger.info("Continuando monitoramento de tarefa pendente existente", { taskId });
        } else {
          // Solicita novo relatório para o dia local
          await this.updateJobStatus(jobId, "generating_report");
          const dateRangeUtc = getArgentinaDayUtcRange(targetDateStr);
          const task = await this.mpProvider.requestDailyReport(dateRangeUtc);
          taskId = String(task.id);

          // Registra na tabela mercadopago_reports
          const { data: newReport, error: repInsertErr } = await supabase
            .from("mercadopago_reports")
            .insert({
              report_date: targetDateStr,
              mercadopago_task_id: taskId,
              status: "pending",
              currency: receipt.currency || "ARS",
              raw_metadata: task,
            })
            .select()
            .single();

          if (repInsertErr || !newReport) {
            throw new Error(`Falha ao registrar relatório no banco: ${repInsertErr?.message}`);
          }

          reportId = newReport.id;
        }

        // 4. Polling do relatório no Mercado Pago com timeout de 10 minutos
        await this.updateJobStatus(jobId, "waiting_report");
        const startTime = Date.now();
        const maxWaitMs = 10 * 60 * 1000; // 10 minutos
        let isAvailable = false;
        let csvFileName: string | null = null;

        while (Date.now() - startTime < maxWaitMs) {
          await new Promise((resolve) => setTimeout(resolve, 15000)); // Aguarda 15s

          const taskStatus = await this.mpProvider.getReportStatus(taskId);
          logger.info("Consulta de status do relatório Mercado Pago", {
            taskId,
            status: taskStatus.status,
            files: taskStatus.files?.length,
          });

          if (taskStatus.status === "available") {
            const csvFile = taskStatus.files?.find((f) => f.type === "csv" || f.name.endsWith(".csv"));
            if (csvFile) {
              csvFileName = csvFile.name;
              isAvailable = true;
              break;
            }
          } else if (taskStatus.status === "failed" || taskStatus.status === "error") {
            throw new Error(`O Mercado Pago falhou ao gerar o relatório: status ${taskStatus.status}`);
          }
        }

        if (!isAvailable || !csvFileName) {
          throw new Error("O Mercado Pago demorou mais que o esperado para gerar o relatório. Tente novamente.");
        }

        // 5. Download do relatório
        await this.updateJobStatus(jobId, "downloading_report");
        csvContent = await this.mpProvider.downloadReport(csvFileName);

        // Atualiza status do relatório no banco
        await supabase
          .from("mercadopago_reports")
          .update({
            status: "available",
            file_name_csv: csvFileName,
            available_at: new Date().toISOString(),
            downloaded_at: new Date().toISOString(),
          })
          .eq("id", reportId);

        // 6. Faz o parse do CSV e salva as transações no banco
        const parsedTxs = await this.mpProvider.parseSettlementCsv(csvContent);
        logger.info("Parsing do CSV concluído", { totalRows: parsedTxs.length });

        for (const tx of parsedTxs) {
          await supabase.from("mercadopago_transactions").upsert(
            {
              report_id: reportId,
              source_id: tx.source_id,
              pay_bank_transfer_id: tx.pay_bank_transfer_id,
              external_reference: tx.external_reference,
              transaction_type: tx.transaction_type,
              transaction_amount_minor: Number(tx.transaction_amount_minor),
              transaction_currency: tx.transaction_currency,
              payment_method_type: tx.payment_method_type,
              payment_method: tx.payment_method,
              transaction_date: tx.transaction_date,
              settlement_date: tx.settlement_date,
              settlement_net_amount_minor: tx.settlement_net_amount_minor ? Number(tx.settlement_net_amount_minor) : null,
              description: tx.description,
              raw_row: tx.raw_row,
            },
            { onConflict: "source_id" }
          );
        }
      }

      // 7. Carrega as transações disponíveis para a data
      await this.updateJobStatus(jobId, "matching");

      const { data: dbTransactions, error: txErr } = await supabase
        .from("mercadopago_transactions")
        .select("*")
        .eq("report_id", reportId);

      if (txErr) {
        throw new Error(`Falha ao ler transações do banco: ${txErr.message}`);
      }

      const formattedTxs: MercadoPagoTransaction[] = (dbTransactions || []).map((t) => ({
        id: t.id,
        report_id: t.report_id,
        source_id: t.source_id,
        pay_bank_transfer_id: t.pay_bank_transfer_id,
        external_reference: t.external_reference,
        transaction_type: t.transaction_type,
        transaction_amount_minor: BigInt(t.transaction_amount_minor),
        transaction_amount_display: Number(t.transaction_amount_minor) / 100,
        transaction_currency: t.transaction_currency,
        payment_method_type: t.payment_method_type,
        payment_method: t.payment_method,
        transaction_date: t.transaction_date,
        settlement_date: t.settlement_date,
        settlement_net_amount_minor: t.settlement_net_amount_minor ? BigInt(t.settlement_net_amount_minor) : null,
        description: t.description,
        raw_row: t.raw_row,
      }));

      // 8. Busca SOURCE_IDs que já foram confirmados em outros comprovantes
      const { data: verifiedMatches } = await supabase
        .from("verification_matches")
        .select("transaction_id, mercadopago_transactions(source_id)")
        .eq("status", "verified");

      const usedSourceIds = new Set<string>();
      if (verifiedMatches) {
        for (const m of verifiedMatches) {
          const txObj = m.mercadopago_transactions as unknown as { source_id: string } | null;
          if (txObj?.source_id) {
            usedSourceIds.add(txObj.source_id);
          }
        }
      }

      // 9. Executa o algoritmo de matching rigoroso
      const matchResult = PaymentMatcher.match(
        {
          amount: Number(receipt.amount_display),
          currency: (receipt.currency || "ARS") as "ARS" | "BRL" | "USD",
          transactionDate: receipt.transaction_date,
          transactionTime: receipt.transaction_time,
          operationNumber: receipt.operation_number,
          transactionReference: receipt.transaction_reference,
          alreadyUsedSourceIds: usedSourceIds,
        },
        formattedTxs
      );

      // 10. Salva o resultado do match no banco
      const matchedTxId = matchResult.matchedTransaction?.id || null;

      await supabase.from("verification_matches").insert({
        receipt_id: receipt.id,
        transaction_id: matchedTxId,
        status: matchResult.status,
        confidence_score: matchResult.confidenceScore,
        time_difference_seconds: matchResult.timeDifferenceSeconds,
        match_reasons: matchResult.matchReasons,
      });

      // Registra log de auditoria
      await supabase.from("audit_logs").insert({
        user_id: receipt.user_id,
        event_type: "receipt_verification_completed",
        entity_type: "receipt",
        entity_id: receipt.id,
        metadata: {
          jobId,
          status: matchResult.status,
          confidenceScore: matchResult.confidenceScore,
          matchedSourceId: matchResult.matchedTransaction?.source_id,
          message: matchResult.message,
        },
      });

      // 11. Finaliza o job com o status de verificação alcançado
      await this.updateJobStatus(jobId, matchResult.status, {
        finishedAt: new Date().toISOString(),
      });

      logger.info("Processamento do job concluído com sucesso", {
        jobId,
        status: matchResult.status,
        score: matchResult.confidenceScore,
      });
    } catch (err) {
      logger.error("Erro durante execução do worker para o job", err, { jobId });
      await this.updateJobStatus(jobId, "error", {
        errorCode: "PROCESSING_FAILED",
        errorMessage: err instanceof Error ? err.message : String(err),
        finishedAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Atualiza o status de um job de forma atômica
   */
  private async updateJobStatus(
    jobId: string,
    status: string,
    extra: { errorCode?: string; errorMessage?: string; finishedAt?: string } = {}
  ): Promise<void> {
    const supabase = createAdminClient();
    const updatePayload: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (extra.errorCode !== undefined) updatePayload.error_code = extra.errorCode;
    if (extra.errorMessage !== undefined) updatePayload.error_message = extra.errorMessage;
    if (extra.finishedAt !== undefined) updatePayload.finished_at = extra.finishedAt;

    await supabase.from("verification_jobs").update(updatePayload).eq("id", jobId);
  }

  /**
   * Loop contínuo do worker para execução independente em background
   */
  async startPollingLoop(intervalMs: number = 5000): Promise<void> {
    this.isRunning = true;
    logger.info("Iniciando loop do VerificationWorker em background", { intervalMs });

    while (this.isRunning) {
      try {
        const supabase = createAdminClient();

        // Busca próximo job na fila com status 'queued' de forma atômica
        const { data: pendingJobs, error } = await supabase
          .from("verification_jobs")
          .select("id")
          .eq("status", "queued")
          .order("created_at", { ascending: true })
          .limit(1);

        if (!error && pendingJobs && pendingJobs.length > 0) {
          const nextJob = pendingJobs[0];
          logger.info("Encontrado novo job para processar", { jobId: nextJob.id });
          await this.processJob(nextJob.id);
        }
      } catch (loopErr) {
        logger.error("Erro no loop do worker", loopErr);
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  stop(): void {
    this.isRunning = false;
  }
}
