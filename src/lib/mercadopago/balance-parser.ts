import { parse } from "csv-parse/sync";
import { toMinorUnits, fromMinorUnits, formatCurrencyDisplay } from "@/lib/utils/currency";
import { MercadoPagoBalanceResult } from "@/types";

interface RawCsvRow {
  [key: string]: string;
}

export class MercadoPagoBalanceParser {
  /**
   * Faz o parsing do CSV do Release Report e calcula o saldo disponível com reconciliação matemática
   */
  static parse(
    csvContent: string,
    metadata: {
      taskId?: string | number;
      fileName?: string;
      reportDate?: string;
    } = {}
  ): MercadoPagoBalanceResult {
    const trimmed = (csvContent || "").trim();
    if (!trimmed) {
      throw new Error("Relatório Release Report CSV está vazio.");
    }

    let records: RawCsvRow[];
    try {
      records = parse(trimmed, {
        columns: (header: string[]) =>
          header.map((col) => col.trim().toUpperCase().replace(/[\r\n\t]/g, "")),
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        bom: true,
      });
    } catch (err: any) {
      throw new Error(`Erro ao interpretar formato CSV do Release Report: ${err.message}`);
    }

    if (!records || records.length === 0) {
      throw new Error("Relatório Release Report não contém registros legíveis.");
    }

    const ZERO_MINOR = BigInt(0);
    let initialBalanceMinor: bigint | null = null;
    let totalLineBalanceMinor: bigint | null = null;
    let totalCreditsMinor = ZERO_MINOR;
    let totalDebitsMinor = ZERO_MINOR;
    let totalRowsCount = 0;
    let totalLineOccurrences = 0;
    let hasConflictingTotalLines = false;

    for (const row of records) {
      totalRowsCount++;
      const recordType = (row["RECORD_TYPE"] || row["RECORDTYPE"] || "").trim().toLowerCase();

      // Extrai valores de crédito e débito da linha
      const creditStr = (row["NET_CREDIT_AMOUNT"] || row["NETCREDITAMOUNT"] || row["CREDIT_AMOUNT"] || "").trim();
      const debitStr = (row["NET_DEBIT_AMOUNT"] || row["NETDEBITAMOUNT"] || row["DEBIT_AMOUNT"] || "").trim();
      const grossStr = (row["GROSS_AMOUNT"] || row["GROSSAMOUNT"] || "").trim();

      const parseField = (val: string): bigint => {
        if (!val || val === "-" || val === "0" || val === "0.00") return ZERO_MINOR;
        try {
          return toMinorUnits(val);
        } catch {
          return ZERO_MINOR;
        }
      };

      const creditMinor = parseField(creditStr);
      const debitMinor = parseField(debitStr);
      const grossMinor = parseField(grossStr);

      if (recordType === "initial_available_balance" || recordType === "initial_balance") {
        // O saldo inicial pode estar em NET_CREDIT_AMOUNT ou GROSS_AMOUNT
        initialBalanceMinor = creditMinor !== ZERO_MINOR ? creditMinor : grossMinor !== ZERO_MINOR ? grossMinor : ZERO_MINOR;
      } else if (recordType === "total" || recordType === "total_available_balance" || recordType === "total_balance") {
        totalLineOccurrences++;
        const currentTotal = creditMinor !== ZERO_MINOR ? creditMinor : grossMinor !== ZERO_MINOR ? grossMinor : debitMinor !== ZERO_MINOR ? -debitMinor : ZERO_MINOR;
        if (totalLineBalanceMinor !== null && totalLineBalanceMinor !== currentTotal) {
          hasConflictingTotalLines = true;
        }
        totalLineBalanceMinor = currentTotal;
      } else {
        // Linhas de movimentação regular (créditos / débitos)
        if (creditMinor > ZERO_MINOR) {
          totalCreditsMinor += creditMinor;
        }
        if (debitMinor > ZERO_MINOR) {
          totalDebitsMinor += debitMinor;
        }
      }
    }

    // Cálculo matemático: saldo inicial + créditos - débitos
    const initial = initialBalanceMinor ?? ZERO_MINOR;
    const calculatedBalanceMinor = initial + totalCreditsMinor - totalDebitsMinor;

    let isConsistent = true;
    let status: "reliable" | "manual_review" = "reliable";
    const divergenceNotes: string[] = [];

    // Verificação 1: Linha de total deve existir
    if (totalLineBalanceMinor === null) {
      isConsistent = false;
      status = "manual_review";
      divergenceNotes.push("Linha RECORD_TYPE = 'total' não encontrada no relatório.");
    }

    // Verificação 2: Se houver múltiplas linhas de total com valores divergentes
    if (hasConflictingTotalLines) {
      isConsistent = false;
      status = "manual_review";
      divergenceNotes.push("Foram encontradas múltiplas linhas RECORD_TYPE = 'total' com valores conflitantes.");
    }

    // Verificação 3: Coerência entre cálculo somado e a linha de total
    if (totalLineBalanceMinor !== null) {
      const diff = calculatedBalanceMinor > totalLineBalanceMinor
        ? calculatedBalanceMinor - totalLineBalanceMinor
        : totalLineBalanceMinor - calculatedBalanceMinor;

      // Tolerância zero para centavos
      if (diff !== ZERO_MINOR) {
        isConsistent = false;
        status = "manual_review";
        divergenceNotes.push(
          `Divergência entre o cálculo (${fromMinorUnits(calculatedBalanceMinor)}) e o total do relatório (${fromMinorUnits(totalLineBalanceMinor)}). Diferença: ${fromMinorUnits(diff)}`
        );
      }
    }


    // Saldo final a ser considerado (prioriza linha total se consistente, caso contrário calculado)
    const finalBalanceMinor = totalLineBalanceMinor !== null ? totalLineBalanceMinor : calculatedBalanceMinor;

    return {
      currency: "ARS",
      initialBalanceMinor,
      totalCreditsMinor,
      totalDebitsMinor,
      calculatedBalanceMinor,
      totalBalanceMinor: finalBalanceMinor,
      reportTaskId: String(metadata.taskId || "unknown"),
      reportFileName: metadata.fileName || "unknown.csv",
      reportDate: metadata.reportDate || new Date().toISOString().split("T")[0],
      generatedAt: new Date().toISOString(),
      status,
      isConsistent,
      divergenceReason: divergenceNotes.length > 0 ? divergenceNotes.join(" | ") : undefined,
      rawSummary: {
        totalRows: totalRowsCount,
        hasInitialBalance: initialBalanceMinor !== null,
        hasTotalRow: totalLineBalanceMinor !== null,
        initialBalanceFormatted: initialBalanceMinor !== null ? formatCurrencyDisplay(fromMinorUnits(initialBalanceMinor), "ARS") : null,
        creditsFormatted: formatCurrencyDisplay(fromMinorUnits(totalCreditsMinor), "ARS"),
        debitsFormatted: formatCurrencyDisplay(fromMinorUnits(totalDebitsMinor), "ARS"),
        calculatedFormatted: formatCurrencyDisplay(fromMinorUnits(calculatedBalanceMinor), "ARS"),
        totalFormatted: formatCurrencyDisplay(fromMinorUnits(finalBalanceMinor), "ARS"),
        totalLineOccurrences,
      },
    };
  }
}
