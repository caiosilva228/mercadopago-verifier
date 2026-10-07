import { createAdminClient } from "@/lib/supabase/admin";
import { MercadoPagoProvider } from "@/lib/mercadopago/provider";
import { MercadoPagoReleaseReportService } from "@/lib/mercadopago/release-report";
import { MercadoPagoBalanceParser } from "@/lib/mercadopago/balance-parser";
import { PaymentMatcher } from "@/lib/mercadopago/matcher";
import { getArgentinaDayUtcRange } from "@/lib/utils/timezone";
import { logger } from "@/lib/utils/logger";
import { DateTime } from "luxon";
import { MercadoPagoTransaction } from "@/types";

export class VerificationWorker {
  private readonly mpProvider: MercadoPagoProvider;
  private readonly releaseReportService: MercadoPagoReleaseReportService;
  private isRunning: boolean = false;

  constructor() {
    this.mpProvider = new MercadoPagoProvider();
    this.releaseReportService = new MercadoPagoReleaseReportService();
  }


  /**
   * Processa um job de verificação ou atualização de saldo de acordo com o job_type
   */
  async processJob(jobId: string): Promise<void> {
    const supabase = createAdminClient();

    const { data: job, error: jobErr } = await supabase
      .from("verification_jobs")
      .select("*, receipts(*)")
      .eq("id", jobId)
      .single();

    if (jobErr || !job) {
      logger.error("Job não encontrado no banco de dados", jobErr, { jobId });
      return;
    }

    if (job.job_type === "refresh_balance") {
      return await this.processBalanceJob(jobId, job);
    }

    return await this.processVerificationJob(jobId, job);
  }

  /**
   * Processa um job de verificação específico de ponta a ponta
   */
  async processVerificationJob(jobId: string, job: any): Promise<void> {
    const supabase = createAdminClient();

    if (!job || !job.receipts) {
      logger.error("Job de verificação não possui comprovante associado", null, { jobId });
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

          if (taskStatus.status === "available" || taskStatus.status === "processed") {
            const csvFile = taskStatus.files?.find((f) => f.type === "csv" || f.name.endsWith(".csv"));
            if (csvFile) {
              csvFileName = csvFile.name;
              isAvailable = true;
              break;
            } else if (taskStatus.file_name) {
              csvFileName = taskStatus.file_name;
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
   * 55. WORKER DE SALDO
   * Processa atualização de saldo via Release Report:
   * queued -> checking_config -> requesting_report -> waiting_report -> downloading -> parsing -> completed (ou error)
   */
  async processBalanceJob(jobId: string, job: any): Promise<void> {
    const supabase = createAdminClient();

    try {
      // 1. checking_config
      await this.updateJobStatus(jobId, "checking_config");
      await this.releaseReportService.ensureMercadoPagoReleaseReportConfiguration();

      // 2. requesting_report
      await this.updateJobStatus(jobId, "requesting_report");
      const reportTask = await this.releaseReportService.createReleaseReport();
      const taskId = String(reportTask.id);

      // Auditoria: balance_report_created
      await supabase.from("audit_logs").insert({
        event_type: "balance_report_created",
        entity_type: "balance",
        entity_id: null,
        metadata: { jobId, taskId },
      });

      // 3. waiting_report - Polling assíncrono (a cada 15s, timeout de 10 minutos)
      await this.updateJobStatus(jobId, "waiting_report");

      const maxAttempts = 40; // 40 * 15s = 600s = 10 minutos
      const intervalMs = 15000;
      let fileName: string | null = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        logger.info(`Consultando status do Release Report task ${taskId} (tentativa ${attempt}/${maxAttempts})...`);
        const taskStatus = await this.releaseReportService.getReleaseReportTask(taskId);

        if (taskStatus.status === "processed" && taskStatus.file_name) {
          fileName = taskStatus.file_name;
          logger.info("Release Report processado com sucesso pelo Mercado Pago!", { taskId, fileName });
          break;
        }

        if (taskStatus.status === "error" || taskStatus.status === "failed") {
          throw new Error(`Falha no processamento do relatório pelo Mercado Pago (status=${taskStatus.status})`);
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }

      if (!fileName) {
        throw new Error("Timeout ao aguardar processamento do Release Report no Mercado Pago (10 minutos excedidos).");
      }

      // Auditoria: balance_report_processed
      await supabase.from("audit_logs").insert({
        event_type: "balance_report_processed",
        entity_type: "balance",
        entity_id: null,
        metadata: { jobId, taskId, fileName },
      });

      // 4. downloading
      await this.updateJobStatus(jobId, "downloading");
      const csvContent = await this.releaseReportService.downloadReleaseReportCsv(fileName);

      // 5. parsing
      await this.updateJobStatus(jobId, "parsing");
      const balanceResult = MercadoPagoBalanceParser.parse(csvContent, {
        taskId,
        fileName,
      });

      // 6. Salva snapshot no banco (52. BANCO DE DADOS PARA SALDO)
      const { data: snapshot, error: snapErr } = await supabase
        .from("mercadopago_balance_snapshots")
        .insert({
          currency: balanceResult.currency,
          initial_balance_minor: balanceResult.initialBalanceMinor,
          credits_minor: balanceResult.totalCreditsMinor,
          debits_minor: balanceResult.totalDebitsMinor,
          balance_minor: balanceResult.totalBalanceMinor,
          mercadopago_task_id: taskId,
          report_file_name: fileName,
          report_date: balanceResult.reportDate,
          status: balanceResult.status,
          raw_summary: balanceResult.rawSummary,
        })
        .select("*")
        .single();

      if (snapErr) {
        logger.error("Erro ao salvar snapshot de saldo no banco", snapErr);
      }

      // Auditoria: balance_updated
      await supabase.from("audit_logs").insert({
        event_type: "balance_updated",
        entity_type: "balance",
        entity_id: snapshot ? snapshot.id : null,
        metadata: {
          currency: balanceResult.currency,
          balanceMinor: Number(balanceResult.totalBalanceMinor),
          status: balanceResult.status,
          isConsistent: balanceResult.isConsistent,
          divergenceReason: balanceResult.divergenceReason,
        },
      });

      // 7. completed
      await this.updateJobStatus(jobId, "completed", {
        finishedAt: new Date().toISOString(),
      });

      logger.info("Atualização de saldo Mercado Pago concluída com sucesso!", {
        balanceMinor: balanceResult.totalBalanceMinor.toString(),
        status: balanceResult.status,
      });
    } catch (err: any) {
      logger.error("Erro ao executar refresh_balance no worker", err, { jobId });

      // Auditoria: balance_refresh_failed
      await supabase.from("audit_logs").insert({
        event_type: "balance_refresh_failed",
        entity_type: "balance",
        entity_id: null,
        metadata: { jobId, error: err.message },
      });

      await this.updateJobStatus(jobId, "error", {
        errorCode: "BALANCE_REFRESH_ERROR",
        errorMessage: err.message || String(err),
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
