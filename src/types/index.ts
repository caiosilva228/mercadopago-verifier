import { z } from "zod";

// ==========================================
// 1. EXTRAÇÃO DE COMPROVANTES (OCR & PARSER)
// ==========================================

export const CurrencyEnum = z.enum(["ARS", "BRL", "USD"]);
export type Currency = z.infer<typeof CurrencyEnum>;

export const ReceiptExtractionSchema = z.object({
  amount: z.number().nullable(),
  currency: CurrencyEnum.nullable(),
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato deve ser YYYY-MM-DD").nullable(),
  transactionTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Formato deve ser HH:mm ou HH:mm:ss").nullable(),
  bankName: z.string().nullable(),
  senderName: z.string().nullable(),
  recipientName: z.string().nullable(),
  destinationAlias: z.string().nullable(),
  transactionReference: z.string().nullable(),
  operationNumber: z.string().nullable(),
  transactionNumber: z.string().nullable(),
  rawText: z.string(),
  confidence: z.number().min(0).max(100),
});

export type ReceiptExtraction = z.infer<typeof ReceiptExtractionSchema>;

// Dados de entrada para verificação (podem ser corrigidos pelo usuário)
export const ReceiptVerificationInputSchema = z.object({
  receiptId: z.string().uuid(),
  amount: z.number().positive("Valor deve ser maior que zero"),
  currency: CurrencyEnum,
  transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve ser YYYY-MM-DD"),
  transactionTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Hora deve ser HH:mm ou HH:mm:ss").nullable().optional(),
  bankName: z.string().nullable().optional(),
  transactionReference: z.string().nullable().optional(),
});

export type ReceiptVerificationInput = z.infer<typeof ReceiptVerificationInputSchema>;

// ==========================================
// 2. STATUS DE VERIFICAÇÃO & JOBS
// ==========================================

export const VerificationStatusEnum = z.enum([
  "verified",
  "ambiguous",
  "not_found",
  "manual_review",
  "error",
]);

export type VerificationStatus = z.infer<typeof VerificationStatusEnum>;

export const JobStatusEnum = z.enum([
  "uploaded",
  "extracting",
  "extracted",
  "queued",
  "checking_config",
  "requesting_report",
  "checking_report",
  "generating_report",
  "waiting_report",
  "downloading",
  "downloading_report",
  "parsing",
  "matching",
  "verified",
  "ambiguous",
  "not_found",
  "manual_review",
  "completed",
  "error",
]);

export type JobStatus = z.infer<typeof JobStatusEnum>;

export type JobType = "verify_receipt" | "refresh_balance";


// ==========================================
// 3. INTEGRAÇÃO MERCADO PAGO
// ==========================================

export const MercadoPagoReportFileSchema = z.object({
  type: z.enum(["csv", "json"]),
  name: z.string(),
});

export type MercadoPagoReportFile = z.infer<typeof MercadoPagoReportFileSchema>;

export const MercadoPagoReportTaskSchema = z.object({
  id: z.union([z.number(), z.string()]).transform((val) => String(val)),
  status: z.string(),
  format: z.string().optional(),
  currency_id: z.string().optional(),
  file_name: z.string().optional(),
  files: z.array(MercadoPagoReportFileSchema).optional(),
});


export type MercadoPagoReportTask = z.infer<typeof MercadoPagoReportTaskSchema>;

export const MercadoPagoReportConfigSchema = z.object({
  file_name_prefix: z.string().optional(),
  display_timezone: z.string().optional(),
  header_language: z.string().optional(),
  frequency: z.object({
    hour: z.number().optional(),
    type: z.string().optional(),
    value: z.number().optional(),
  }).optional(),
  columns: z.array(z.object({ key: z.string() })).optional(),
});

export type MercadoPagoReportConfig = z.infer<typeof MercadoPagoReportConfigSchema>;

// Transação individual extraída do relatório settlement do Mercado Pago
export const MercadoPagoTransactionSchema = z.object({
  id: z.string().uuid().optional(),
  report_id: z.string().uuid().optional(),
  source_id: z.string(),
  pay_bank_transfer_id: z.string().nullable(),
  external_reference: z.string().nullable(),
  transaction_type: z.string(),
  transaction_amount_minor: z.bigint(),
  transaction_amount_display: z.number(),
  transaction_currency: z.string(),
  payment_method_type: z.string(),
  payment_method: z.string(),
  transaction_date: z.string(), // ISO string UTC
  settlement_date: z.string().nullable(),
  settlement_net_amount_minor: z.bigint().nullable(),
  description: z.string().nullable(),
  raw_row: z.record(z.unknown()).optional(),
});

export type MercadoPagoTransaction = z.infer<typeof MercadoPagoTransactionSchema>;

// ==========================================
// 4. ALGORITMO DE MATCHING & RESULTADOS
// ==========================================

export const MatchReasonsSchema = z.object({
  amountExact: z.boolean(),
  currencyExact: z.boolean(),
  transactionTypeCorrect: z.boolean(),
  paymentMethodCorrect: z.boolean(),
  sameLocalDate: z.boolean(),
  timeDifferenceSeconds: z.number().nullable(),
  timeProximityScore: z.number(),
  candidateCount: z.number(),
  uniqueCandidate: z.boolean(),
  isDuplicateSourceId: z.boolean(),
  notes: z.array(z.string()).default([]),
});

export type MatchReasons = z.infer<typeof MatchReasonsSchema>;

export const VerificationResultSchema = z.object({
  status: VerificationStatusEnum,
  confidenceScore: z.number().min(0).max(100),
  matchedTransaction: MercadoPagoTransactionSchema.nullable(),
  candidateTransactions: z.array(MercadoPagoTransactionSchema).default([]),
  timeDifferenceSeconds: z.number().nullable(),
  matchReasons: MatchReasonsSchema,
  message: z.string(),
});

export type VerificationResult = z.infer<typeof VerificationResultSchema>;

// Interface do Provedor de Verificação (extensível para o futuro)
export interface PaymentVerificationProvider {
  ensureConfiguration(): Promise<void>;
  requestDailyReport(dateUtc: { beginDate: string; endDate: string }): Promise<MercadoPagoReportTask>;
  getReportStatus(taskId: string): Promise<MercadoPagoReportTask>;
  downloadReport(fileName: string): Promise<string>;
  parseSettlementCsv(csvContent: string): Promise<Omit<MercadoPagoTransaction, "id" | "report_id">[]>;
  getPaymentById?(paymentId: string | number): Promise<any | null>;
  searchPayments?(options?: { beginDate?: string; endDate?: string; limit?: number }): Promise<any[]>;
  convertPaymentToTransaction?(payment: any): Omit<MercadoPagoTransaction, "id" | "report_id">;
}

// ==========================================
// 5. SALDO & RELEASE REPORT DO MERCADO PAGO
// ==========================================

export const BalanceStatusEnum = z.enum(["reliable", "manual_review"]);
export type BalanceStatus = z.infer<typeof BalanceStatusEnum>;

export interface MercadoPagoBalanceResult {
  currency: "ARS";
  initialBalanceMinor: bigint | null;
  totalCreditsMinor: bigint;
  totalDebitsMinor: bigint;
  calculatedBalanceMinor: bigint;
  totalBalanceMinor: bigint;
  reportTaskId: string;
  reportFileName: string;
  reportDate: string;
  generatedAt: string;
  status: BalanceStatus;
  isConsistent: boolean;
  divergenceReason?: string;
  rawSummary: Record<string, unknown>;
}

export interface BalanceSnapshot {
  id: string;
  currency: "ARS";
  initial_balance_minor: bigint | null;
  credits_minor: bigint;
  debits_minor: bigint;
  balance_minor: bigint;
  mercadopago_task_id: string | null;
  report_file_name: string | null;
  report_date: string | null;
  status: BalanceStatus;
  raw_summary: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

