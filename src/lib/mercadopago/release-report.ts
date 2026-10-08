import { DateTime } from "luxon";
import { ARGENTINA_TIMEZONE, getArgentinaDayUtcRange } from "@/lib/utils/timezone";
import { logger } from "@/lib/utils/logger";

export interface ReleaseReportConfig {
  file_name_prefix: string;
  display_timezone: string;
  include_withdrawal_at_end: boolean;
  check_available_balance: boolean;
  compensate_detail: boolean;
  execute_after_withdrawal: boolean;
  frequency: {
    hour: number;
    type: string;
    value: string;
  };
  columns: Array<{ key: string }>;
}

export interface ReleaseReportTaskResponse {
  id: number | string;
  status: "pending" | "processed" | "error" | "failed" | string;
  currency_id?: string;
  report_type?: string;
  sub_type?: string;
  format?: string;
  file_name?: string;
}

export class MercadoPagoReleaseReportService {
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

    throw new Error(`Excedido o número de tentativas para a requisição: ${url}`);
  }

  /**
   * 42. CONFIGURAÇÃO DO RELEASE REPORT
   * Verifica se a configuração existe via GET /v1/account/release_report/config
   * Se retornar 404 (config_not_found_for_user), cria a configuração oficial
   */
  async ensureMercadoPagoReleaseReportConfiguration(): Promise<void> {
    const url = `${this.baseUrl}/v1/account/release_report/config`;
    logger.info("Verificando configuração de Release Report no Mercado Pago...");

    const checkRes = await this.fetchWithRetry(url, { method: "GET" });

    if (checkRes.status === 200) {
      logger.info("Configuração de Release Report já existe e está ativa.");
      return;
    }

    if (checkRes.status === 404) {
      logger.info("Configuração de Release Report não encontrada (404). Criando configuração padrão...");

      const payload: ReleaseReportConfig = {
        file_name_prefix: "cantame-release-report",
        display_timezone: "GMT-03",
        include_withdrawal_at_end: true,
        check_available_balance: true,
        compensate_detail: true,
        execute_after_withdrawal: false,
        frequency: {
          hour: 0,
          type: "daily",
          value: "",
        },
        columns: [
          { key: "DATE" },
          { key: "SOURCE_ID" },
          { key: "EXTERNAL_REFERENCE" },
          { key: "RECORD_TYPE" },
          { key: "DESCRIPTION" },
          { key: "NET_CREDIT_AMOUNT" },
          { key: "NET_DEBIT_AMOUNT" },
          { key: "GROSS_AMOUNT" },
          { key: "PAYMENT_METHOD" },
        ],
      };

      const createRes = await this.fetchWithRetry(url, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (!createRes.ok) {
        const errText = await createRes.text();
        throw new Error(`Falha ao criar configuração de Release Report no Mercado Pago (${createRes.status}): ${errText}`);
      }

      logger.info("Configuração de Release Report criada com sucesso no Mercado Pago.");
      return;
    }

    const errText = await checkRes.text();
    throw new Error(`Erro inesperado ao consultar configuração de Release Report (${checkRes.status}): ${errText}`);
  }

  /**
   * 43. GERAR RELATÓRIO DE SALDO
   * Cria requisição POST /v1/account/release_report para o dia atual em Buenos Aires
   */
  async createReleaseReport(dateStr?: string): Promise<ReleaseReportTaskResponse> {
    const targetDate = dateStr || DateTime.now().setZone(ARGENTINA_TIMEZONE).toISODate()!;
    const { beginDate, endDate } = getArgentinaDayUtcRange(targetDate);

    const url = `${this.baseUrl}/v1/account/release_report`;
    logger.info("Solicitando geração de Release Report para saldo...", { targetDate, beginDate, endDate });

    const response = await this.fetchWithRetry(url, {
      method: "POST",
      body: JSON.stringify({
        begin_date: beginDate,
        end_date: endDate,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Erro ao solicitar Release Report (${response.status}): ${errText}`);
    }

    const data = await response.json();
    return {
      id: data.id,
      status: data.status || "pending",
      currency_id: data.currency_id,
      report_type: data.report_type,
      sub_type: data.sub_type,
      format: data.format,
      file_name: data.file_name,
    };
  }

  /**
   * Lista relatórios gerados via GET /v1/account/release_report/list
   */
  async listReleaseReports(): Promise<any[]> {
    const url = `${this.baseUrl}/v1/account/release_report/list`;
    const response = await this.fetchWithRetry(url, { method: "GET" });
    if (!response.ok) {
      const errText = await response.text();
      logger.warn(`Erro ao listar Release Reports (${response.status}): ${errText}`);
      return [];
    }
    return await response.json();
  }

  /**
   * 44. CONSULTAR STATUS DO RELATÓRIO DE SALDO
   * GET /v1/account/release_report/task/{TASK_ID} com fallback resiliente para /v1/account/release_report/list
   */
  async getReleaseReportTask(taskId: string | number): Promise<ReleaseReportTaskResponse> {
    // 1. Tenta consulta direta da task
    try {
      const url = `${this.baseUrl}/v1/account/release_report/task/${taskId}`;
      const response = await this.fetchWithRetry(url, { method: "GET" });

      if (response.ok) {
        const data = await response.json();
        return {
          id: data.id,
          status: data.status === "enabled" ? "processed" : data.status,
          currency_id: data.currency_id,
          file_name: data.file_name,
        };
      }
      logger.warn(`Endpoint de task ${taskId} retornou status ${response.status}. Consultando lista de relatórios...`);
    } catch (err: any) {
      logger.warn(`Falha na chamada direta da task ${taskId}: ${err.message}. Consultando lista de relatórios...`);
    }

    // 2. Fallback resiliente: consulta /v1/account/release_report/list
    try {
      const list = await this.listReleaseReports();
      if (Array.isArray(list) && list.length > 0) {
        // Busca relatório com ID correspondente
        const match = list.find((item: any) => String(item.id) === String(taskId));
        if (match && match.file_name) {
          return {
            id: match.id,
            status: match.status === "enabled" ? "processed" : match.status,
            currency_id: match.currency_id || "ARS",
            file_name: match.file_name,
          };
        }

        // Se não encontrar pelo ID exato, usa o mais recente que já tenha file_name gerado
        const readyReport = list.find((item: any) => Boolean(item.file_name));
        if (readyReport) {
          return {
            id: readyReport.id,
            status: readyReport.status === "enabled" ? "processed" : readyReport.status,
            currency_id: readyReport.currency_id || "ARS",
            file_name: readyReport.file_name,
          };
        }
      }
    } catch (listErr: any) {
      logger.error(`Erro ao consultar fallback de listReleaseReports: ${listErr.message}`);
    }

    return {
      id: taskId,
      status: "pending",
    };
  }

  /**
   * 45. DOWNLOAD DO RELATÓRIO DE SALDO
   * GET /v1/account/release_report/{FILE_NAME}
   */
  async downloadReleaseReportCsv(fileName: string): Promise<string> {
    const url = `${this.baseUrl}/v1/account/release_report/${fileName}`;
    logger.info(`Baixando CSV do Release Report: ${fileName}`);

    const response = await this.fetchWithRetry(url, {
      method: "GET",
      headers: {
        Accept: "text/csv, text/plain, */*",
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Erro ao baixar CSV do Release Report ${fileName} (${response.status}): ${errText}`);
    }

    return await response.text();
  }
}
