import { parse } from "csv-parse/sync";
import {
  PaymentVerificationProvider,
  MercadoPagoReportTask,
  MercadoPagoReportTaskSchema,
  MercadoPagoTransaction,
} from "@/types";
import { toMinorUnits, fromMinorUnits } from "@/lib/utils/currency";
import { parseMercadoPagoReportDate } from "@/lib/utils/timezone";
import { logger } from "@/lib/utils/logger";

export class MercadoPagoProvider implements PaymentVerificationProvider {
  private readonly baseUrl = "https://api.mercadopago.com";


  private getAccessToken(): string {
    const defaultToken = "APP_USR-4308265369156919-092314-f52d97870fcd108be2b28ddf8b9e66aa-238746614";
    let token = process.env.MERCADOPAGO_ACCESS_TOKEN || defaultToken;
    if (token.includes("CONFIGURAR") || token.length < 20) {
      token = defaultToken;
    }
    return token;
  }


  private async fetchWithRetry(
    url: string,
    options: RequestInit = {},
    maxRetries: number = 3
  ): Promise<Response> {
    const token = this.getAccessToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    };

    let attempt = 0;
    let delay = 1000;

    while (attempt < maxRetries) {
      attempt++;
      try {
        const response = await fetch(url, { ...options, headers });

        if (response.status === 429 || (response.status >= 500 && response.status <= 504)) {
          if (attempt < maxRetries) {
            logger.warn(`Mercado Pago retornou status temporário ${response.status}. Tentando novamente em ${delay}ms...`, {
              attempt,
              url,
            });
            await new Promise((resolve) => setTimeout(resolve, delay));
            delay *= 2;
            continue;
          }
        }

        return response;
      } catch (networkError) {
        if (attempt < maxRetries) {
          logger.warn(`Erro de rede ao conectar com Mercado Pago: ${networkError}. Nova tentativa em ${delay}ms...`, {
            attempt,
            url,
          });
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2;
          continue;
        }
        throw networkError;
      }
    }

    throw new Error(`Excedido número máximo de tentativas (${maxRetries}) para Mercado Pago: ${url}`);
  }

  /**
   * Garante que a configuração de colunas do Settlement Report exista no Mercado Pago.
   * Não recria desnecessariamente se já existir.
   */
  async ensureConfiguration(): Promise<void> {
    const url = `${this.baseUrl}/v1/account/settlement_report/config`;
    logger.info("Verificando configuração de settlement_report no Mercado Pago");

    const getRes = await this.fetchWithRetry(url, { method: "GET" });

    if (getRes.status === 200) {
      logger.info("Configuração de relatório já existe e está ativa no Mercado Pago");
      return;
    }

    // Se retornar 404 (config_not_found_for_user), cria a configuração
    if (getRes.status === 404) {
      logger.info("Configuração não encontrada no Mercado Pago. Criando nova configuração...");

      const configBody = {
        file_name_prefix: "cantame-report",
        display_timezone: "GMT-03",
        header_language: "es",
        frequency: {
          hour: 0,
          type: "monthly",
          value: 1,
        },
        columns: [
          { key: "TRANSACTION_DATE" },
          { key: "SOURCE_ID" },
          { key: "EXTERNAL_REFERENCE" },
          { key: "TRANSACTION_TYPE" },
          { key: "TRANSACTION_AMOUNT" },
          { key: "TRANSACTION_CURRENCY" },
          { key: "PAYMENT_METHOD_TYPE" },
          { key: "PAYMENT_METHOD" },
          { key: "SETTLEMENT_DATE" },
          { key: "SETTLEMENT_NET_AMOUNT" },
          { key: "PAY_BANK_TRANSFER_ID" },
          { key: "DESCRIPTION" },
        ],
      };

      const postRes = await this.fetchWithRetry(url, {
        method: "POST",
        body: JSON.stringify(configBody),
      });

      if (!postRes.ok) {
        const errorText = await postRes.text();
        throw new Error(`Falha ao criar configuração de relatório no Mercado Pago: ${postRes.status} - ${errorText}`);
      }

      logger.info("Configuração de settlement_report criada com sucesso no Mercado Pago");
      return;
    }

    const err = await getRes.text();
    throw new Error(`Erro inesperado ao consultar config de settlement_report: ${getRes.status} - ${err}`);
  }

  /**
   * Solicita a geração do relatório diário do Mercado Pago para o intervalo UTC especificado.
   */
  async requestDailyReport(dateUtc: { beginDate: string; endDate: string }): Promise<MercadoPagoReportTask> {
    const url = `${this.baseUrl}/v1/account/settlement_report`;
    logger.info("Solicitando geração de settlement_report no Mercado Pago", {
      beginDate: dateUtc.beginDate,
      endDate: dateUtc.endDate,
    });

    const res = await this.fetchWithRetry(url, {
      method: "POST",
      body: JSON.stringify({
        begin_date: dateUtc.beginDate,
        end_date: dateUtc.endDate,
      }),
    });

    if (res.status !== 202 && res.status !== 200 && res.status !== 201) {
      const errBody = await res.text();
      throw new Error(`Erro ao solicitar relatório no Mercado Pago (${res.status}): ${errBody}`);
    }

    const data = await res.json();
    return MercadoPagoReportTaskSchema.parse(data);
  }

  /**
   * Consulta o status de processamento da tarefa no Mercado Pago.
   */
  async getReportStatus(taskId: string): Promise<MercadoPagoReportTask> {
    const url = `${this.baseUrl}/v1/account/settlement_report/task/${taskId}`;
    const res = await this.fetchWithRetry(url, { method: "GET" });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Erro ao consultar status da task ${taskId} (${res.status}): ${err}`);
    }

    const data = await res.json();
    return MercadoPagoReportTaskSchema.parse(data);
  }

  /**
   * Faz o download do arquivo CSV do relatório gerado.
   */
  async downloadReport(fileName: string): Promise<string> {
    const url = `${this.baseUrl}/v1/account/settlement_report/${fileName}`;
    logger.info("Baixando arquivo CSV do Mercado Pago", { fileName });

    const res = await this.fetchWithRetry(url, { method: "GET" });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Erro ao baixar relatório ${fileName} (${res.status}): ${err}`);
    }

    return await res.text();
  }

  /**
   * Faz parsing seguro do CSV retornado pelo Mercado Pago com conversão rigorosa para centavos (minor units).
   */
  async parseSettlementCsv(csvContent: string): Promise<Omit<MercadoPagoTransaction, "id" | "report_id">[]> {
    if (!csvContent || csvContent.trim().length === 0) {
      return [];
    }

    // Identifica delimitador (vírgula ou ponto e vírgula)
    const firstLine = csvContent.split("\n")[0] || "";
    const delimiter = firstLine.includes(";") ? ";" : ",";

    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      delimiter,
    }) as Record<string, string>[];

    const transactions: Omit<MercadoPagoTransaction, "id" | "report_id">[] = [];

    for (const row of records) {
      // Normaliza as chaves do cabeçalho caso venham em minúsculas ou com espaços
      const normalizedRow: Record<string, string> = {};
      for (const [k, v] of Object.entries(row)) {
        normalizedRow[k.trim().toUpperCase().replace(/[\s-]+/g, "_")] = v;
      }

      const sourceId = normalizedRow["SOURCE_ID"] || normalizedRow["ID"] || "";
      if (!sourceId) continue;

      const rawAmount = normalizedRow["TRANSACTION_AMOUNT"] || "0";
      const rawNetAmount = normalizedRow["SETTLEMENT_NET_AMOUNT"] || null;
      const rawDate = normalizedRow["TRANSACTION_DATE"] || "";

      let txDateIso: string;
      try {
        txDateIso = parseMercadoPagoReportDate(rawDate).toISO() || new Date().toISOString();
      } catch {
        txDateIso = new Date().toISOString();
      }

      let settlementDateIso: string | null = null;
      if (normalizedRow["SETTLEMENT_DATE"]) {
        try {
          settlementDateIso = parseMercadoPagoReportDate(normalizedRow["SETTLEMENT_DATE"]).toISO();
        } catch {
          settlementDateIso = null;
        }
      }

      const amountMinor = toMinorUnits(rawAmount);
      const amountDisplay = fromMinorUnits(amountMinor);
      const netAmountMinor = rawNetAmount ? toMinorUnits(rawNetAmount) : null;

      transactions.push({
        source_id: String(sourceId),
        pay_bank_transfer_id: normalizedRow["PAY_BANK_TRANSFER_ID"] ? String(normalizedRow["PAY_BANK_TRANSFER_ID"]) : null,
        external_reference: normalizedRow["EXTERNAL_REFERENCE"] || null,
        transaction_type: normalizedRow["TRANSACTION_TYPE"] || "",
        transaction_amount_minor: amountMinor,
        transaction_amount_display: amountDisplay,
        transaction_currency: (normalizedRow["TRANSACTION_CURRENCY"] || "ARS").toUpperCase(),
        payment_method_type: normalizedRow["PAYMENT_METHOD_TYPE"] || "",
        payment_method: normalizedRow["PAYMENT_METHOD"] || "",
        transaction_date: txDateIso,
        settlement_date: settlementDateIso,
        settlement_net_amount_minor: netAmountMinor,
        description: normalizedRow["DESCRIPTION"] || null,
        raw_row: row,
      });
    }

    return transactions;
  }

  /**
   * Faz parsing das transações contidas no CSV do Release Report (liberações e pagamentos).
   * Converte entradas com crédito positivo (ex: transferências via available_money, cvu, etc.)
   * para o formato uniforme de MercadoPagoTransaction.
   */
  async parseReleaseReportCsv(csvContent: string): Promise<Omit<MercadoPagoTransaction, "id" | "report_id">[]> {
    if (!csvContent || csvContent.trim().length === 0) {
      return [];
    }

    const firstLine = csvContent.split("\n")[0] || "";
    const delimiter = firstLine.includes(";") ? ";" : ",";

    const records = parse(csvContent, {
      columns: (header: string[]) =>
        header.map((col) => col.trim().toUpperCase().replace(/[\r\n\t]/g, "")),
      skip_empty_lines: true,
      trim: true,
      delimiter,
      relax_column_count: true,
      bom: true,
    }) as Record<string, string>[];

    const transactions: Omit<MercadoPagoTransaction, "id" | "report_id">[] = [];

    for (const row of records) {
      const recordType = (row["RECORD_TYPE"] || row["RECORDTYPE"] || "").trim().toLowerCase();
      // Ignora linhas de saldo inicial ou totalizador
      if (
        recordType === "initial_available_balance" ||
        recordType === "initial_balance" ||
        recordType === "total" ||
        recordType === "total_available_balance" ||
        recordType === "total_balance"
      ) {
        continue;
      }

      const sourceId = (row["SOURCE_ID"] || row["ID"] || "").trim();
      if (!sourceId) continue;

      const creditStr = (row["NET_CREDIT_AMOUNT"] || row["NETCREDITAMOUNT"] || row["GROSS_AMOUNT"] || "").trim();
      if (!creditStr || creditStr === "0" || creditStr === "0.00" || creditStr === "-") {
        continue;
      }

      const rawDate = row["DATE"] || row["TRANSACTION_DATE"] || "";
      let txDateIso: string;
      try {
        txDateIso = parseMercadoPagoReportDate(rawDate).toISO() || new Date().toISOString();
      } catch {
        txDateIso = new Date().toISOString();
      }

      const amountMinor = toMinorUnits(creditStr);
      const amountDisplay = fromMinorUnits(amountMinor);
      const pm = (row["PAYMENT_METHOD"] || row["PAYMENTMETHOD"] || "available_money").toLowerCase();
      const pmt = pm === "cvu" ? "bank_transfer" : "available_money";

      transactions.push({
        source_id: sourceId,
        pay_bank_transfer_id: null,
        external_reference: row["EXTERNAL_REFERENCE"] || null,
        transaction_type: "SETTLEMENT",
        transaction_amount_minor: amountMinor,
        transaction_amount_display: amountDisplay,
        transaction_currency: "ARS",
        payment_method_type: pmt,
        payment_method: pm,
        transaction_date: txDateIso,
        settlement_date: txDateIso,
        settlement_net_amount_minor: amountMinor,
        description: row["DESCRIPTION"] || recordType || null,
        raw_row: row,
      });
    }

    return transactions;
  }
}

export const MercadoPagoAccountMoneyService = MercadoPagoProvider;
