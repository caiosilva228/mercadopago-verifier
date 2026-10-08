import { DateTime } from "luxon";
import {
  MercadoPagoTransaction,
  VerificationResult,
  MatchReasons,
  Currency,
} from "@/types";
import { toMinorUnits } from "@/lib/utils/currency";
import {
  ARGENTINA_TIMEZONE,
  parseArgentinaDateTimeToUtc,
  getTimeDifferenceInSeconds,
} from "@/lib/utils/timezone";

export interface MatcherInput {
  amount: number;
  currency: Currency;
  transactionDate: string; // YYYY-MM-DD
  transactionTime?: string | null; // HH:mm ou HH:mm:ss
  operationNumber?: string | null;
  transactionReference?: string | null;
  alreadyUsedSourceIds?: Set<string>; // Conjunto de SOURCE_IDs já verificados no sistema
}

export class PaymentMatcher {
  /**
   * Avalia uma lista de transações do relatório do Mercado Pago contra os dados do comprovante.
   */
  static match(
    input: MatcherInput,
    transactions: MercadoPagoTransaction[]
  ): VerificationResult {
    const targetAmountMinor = toMinorUnits(input.amount);
    const targetCurrency = input.currency.toUpperCase();
    const usedSourceIds = input.alreadyUsedSourceIds || new Set<string>();

    const notes: string[] = [];

    // 0. VERIFICAÇÃO PRIORITÁRIA POR NÚMERO DE OPERAÇÃO / REFERÊNCIA
    const cleanOp = (input.operationNumber || input.transactionReference)?.replace(/\D/g, "");
    if (cleanOp && cleanOp.length >= 6) {
      const exactOpMatch = transactions.find((tx) => {
        const sId = (tx.source_id || "").replace(/\D/g, "");
        const bId = (tx.pay_bank_transfer_id || "").replace(/\D/g, "");
        const eRef = (tx.external_reference || "").replace(/\D/g, "");
        return sId === cleanOp || bId === cleanOp || eRef === cleanOp;
      });

      if (exactOpMatch) {
        const isAmtMatch = exactOpMatch.transaction_amount_minor === targetAmountMinor;
        const isCurrMatch = exactOpMatch.transaction_currency.toUpperCase() === targetCurrency;
        const isDuplicate = usedSourceIds.has(exactOpMatch.source_id);

        let diffSeconds: number | null = null;
        if (input.transactionTime) {
          const receiptDateTimeUtc = parseArgentinaDateTimeToUtc(
            input.transactionDate,
            input.transactionTime
          );
          const txDateTimeUtc = DateTime.fromISO(exactOpMatch.transaction_date);
          diffSeconds = getTimeDifferenceInSeconds(receiptDateTimeUtc, txDateTimeUtc);
        }

        if (isAmtMatch && isCurrMatch) {
          if (isDuplicate) {
            return {
              status: "manual_review",
              confidenceScore: 40,
              matchedTransaction: exactOpMatch,
              candidateTransactions: [exactOpMatch],
              timeDifferenceSeconds: diffSeconds,
              matchReasons: {
                amountExact: true,
                currencyExact: true,
                transactionTypeCorrect: true,
                paymentMethodCorrect: true,
                sameLocalDate: true,
                timeDifferenceSeconds: diffSeconds,
                timeProximityScore: 30,
                candidateCount: 1,
                uniqueCandidate: true,
                isDuplicateSourceId: true,
                notes: [
                  `ALERTA: O número de operação (${cleanOp}) já foi associado a outro comprovante anteriormente.`,
                ],
              },
              message: "Esta operação já foi associada a outro comprovante anteriormente. Verificação suspensa para análise manual.",
            };
          }

          return {
            status: "verified",
            confidenceScore: 100,
            matchedTransaction: exactOpMatch,
            candidateTransactions: [exactOpMatch],
            timeDifferenceSeconds: diffSeconds,
            matchReasons: {
              amountExact: true,
              currencyExact: true,
              transactionTypeCorrect: true,
              paymentMethodCorrect: true,
              sameLocalDate: true,
              timeDifferenceSeconds: diffSeconds,
              timeProximityScore: 30,
              candidateCount: 1,
              uniqueCandidate: true,
              isDuplicateSourceId: false,
              notes: [
                `Correspondência EXATA confirmada pelo Número de Operação do Mercado Pago (${exactOpMatch.source_id}).`,
              ],
            },
            message: `Transferência confirmada com sucesso pelo número de operação ${exactOpMatch.source_id}.`,
          };
        }
      }
    }

    // 1. Filtragem obrigatória estrita
    const eligibleTransactions = transactions.filter((tx) => {
      // Regra 1: Tipo de transação deve ser SETTLEMENT
      if (tx.transaction_type.toUpperCase() !== "SETTLEMENT") return false;

      // Regra 2 & 3: Transferências recebidas via CVU/banco tradicional ou entre contas Mercado Pago (available_money / account_money)
      const pmt = (tx.payment_method_type || "").toLowerCase();
      const pm = (tx.payment_method || "").toLowerCase();
      const isTransfer =
        (pmt === "bank_transfer" && (pm === "cvu" || pm === "bank_transfer")) ||
        (pmt === "available_money" && pm === "available_money") ||
        (pmt === "account_money" && pm === "account_money") ||
        pm === "cvu" ||
        pmt === "available_money" ||
        pmt === "account_money";

      if (!isTransfer) return false;

      // Regra 4: Moeda exatamente igual
      if (tx.transaction_currency.toUpperCase() !== targetCurrency) return false;

      // Regra 5: Valor exatamente igual em centavos
      if (tx.transaction_amount_minor !== targetAmountMinor) return false;

      // Regra 6: Mesmo dia local na Argentina
      const txDateTimeLocal = DateTime.fromISO(tx.transaction_date).setZone(ARGENTINA_TIMEZONE);
      const txDateStr = txDateTimeLocal.toFormat("yyyy-MM-dd");
      if (txDateStr !== input.transactionDate) return false;

      return true;
    });

    // Caso não encontre nenhuma movimentação com os critérios estritos
    if (eligibleTransactions.length === 0) {
      const matchReasons: MatchReasons = {
        amountExact: false,
        currencyExact: true,
        transactionTypeCorrect: false,
        paymentMethodCorrect: false,
        sameLocalDate: true,
        timeDifferenceSeconds: null,
        timeProximityScore: 0,
        candidateCount: 0,
        uniqueCandidate: false,
        isDuplicateSourceId: false,
        notes: [
          cleanOp
            ? `Nenhuma movimentação com valor correspondente ou com a operação ${cleanOp} foi localizada na data.`
            : "Nenhuma movimentação com valor e método correspondentes foi localizada para a data.",
        ],
      };

      return {
        status: "not_found",
        confidenceScore: 0,
        matchedTransaction: null,
        candidateTransactions: [],
        timeDifferenceSeconds: null,
        matchReasons,
        message: "Nenhuma entrada correspondente foi encontrada no Mercado Pago para os dados do comprovante.",
      };
    }

    // Se o comprovante não tiver horário especificado, não podemos confirmar automaticamente com segurança
    if (!input.transactionTime) {
      const matchReasons: MatchReasons = {
        amountExact: true,
        currencyExact: true,
        transactionTypeCorrect: true,
        paymentMethodCorrect: true,
        sameLocalDate: true,
        timeDifferenceSeconds: null,
        timeProximityScore: 0,
        candidateCount: eligibleTransactions.length,
        uniqueCandidate: eligibleTransactions.length === 1,
        isDuplicateSourceId: false,
        notes: ["Comprovante não contém horário especificado. Requer conferência manual."],
      };

      return {
        status: "manual_review",
        confidenceScore: 50,
        matchedTransaction: eligibleTransactions[0] || null,
        candidateTransactions: eligibleTransactions,
        timeDifferenceSeconds: null,
        matchReasons,
        message: "O comprovante não apresenta horário claro. Por segurança, revise manualmente.",
      };
    }

    // Calcula a data e hora do comprovante em UTC
    const receiptDateTimeUtc = parseArgentinaDateTimeToUtc(
      input.transactionDate,
      input.transactionTime
    );

    // Mapeia e calcula a proximidade temporal para cada transação elegível
    interface ScoredCandidate {
      tx: MercadoPagoTransaction;
      diffSeconds: number;
      proximityScore: number;
      isDuplicate: boolean;
    }

    const scoredCandidates: ScoredCandidate[] = eligibleTransactions.map((tx) => {
      const txDateTimeUtc = DateTime.fromISO(tx.transaction_date);
      const diffSeconds = getTimeDifferenceInSeconds(receiptDateTimeUtc, txDateTimeUtc);

      let proximityScore = 0;
      if (diffSeconds <= 120) {
        // 0 a 2 minutos: fortíssima correspondência
        proximityScore = 30;
      } else if (diffSeconds <= 600) {
        // 2 a 10 minutos: alta correspondência
        proximityScore = 20;
      } else if (diffSeconds <= 1800) {
        // 10 a 30 minutos: possível correspondência
        proximityScore = 10;
      } else {
        // Mais de 30 minutos: não qualifica para auto-confirmação
        proximityScore = 0;
      }

      const isDuplicate = usedSourceIds.has(tx.source_id);

      return {
        tx,
        diffSeconds,
        proximityScore,
        isDuplicate,
      };
    });

    // Filtra candidatas dentro do limiar temporal aceitável (máximo 30 minutos)
    const timeAcceptableCandidates = scoredCandidates.filter((c) => c.diffSeconds <= 1800);

    if (timeAcceptableCandidates.length === 0) {
      // Movimentações no mesmo dia, mas com horário muito distante (> 30 min)
      const closest = scoredCandidates.sort((a, b) => a.diffSeconds - b.diffSeconds)[0];
      const matchReasons: MatchReasons = {
        amountExact: true,
        currencyExact: true,
        transactionTypeCorrect: true,
        paymentMethodCorrect: true,
        sameLocalDate: true,
        timeDifferenceSeconds: closest.diffSeconds,
        timeProximityScore: 0,
        candidateCount: scoredCandidates.length,
        uniqueCandidate: false,
        isDuplicateSourceId: closest.isDuplicate,
        notes: [
          cleanOp
            ? `A operação ${cleanOp} ainda não consta no relatório do Mercado Pago. Foi encontrada outra movimentação do mesmo valor com horário distante (${Math.round(closest.diffSeconds / 60)} min).`
            : `Diferença de horário excessiva (${Math.round(closest.diffSeconds / 60)} min). Não confirmado automaticamente.`,
        ],
      };

      return {
        status: "manual_review",
        confidenceScore: 25,
        matchedTransaction: null,
        candidateTransactions: scoredCandidates.map((c) => c.tx),
        timeDifferenceSeconds: closest.diffSeconds,
        matchReasons,
        message: cleanOp
          ? `A operação ${cleanOp} indicada no comprovante ainda não foi localizada no relatório mais recente do Mercado Pago. Aguarde a sincronização ou revise manualmente.`
          : "Encontrada transferência com mesmo valor na data, porém com diferença de horário superior a 30 minutos. Requer conferência manual.",
      };
    }

    // Se houver mais de uma candidata com horário próximo: AMBÍGUO
    if (timeAcceptableCandidates.length > 1) {
      const matchReasons: MatchReasons = {
        amountExact: true,
        currencyExact: true,
        transactionTypeCorrect: true,
        paymentMethodCorrect: true,
        sameLocalDate: true,
        timeDifferenceSeconds: timeAcceptableCandidates[0].diffSeconds,
        timeProximityScore: 20,
        candidateCount: timeAcceptableCandidates.length,
        uniqueCandidate: false,
        isDuplicateSourceId: timeAcceptableCandidates.some((c) => c.isDuplicate),
        notes: [
          `Foram encontradas ${timeAcceptableCandidates.length} transferências com o mesmo valor próximas ao horário.`,
        ],
      };

      return {
        status: "ambiguous",
        confidenceScore: 65,
        matchedTransaction: null,
        candidateTransactions: timeAcceptableCandidates.map((c) => c.tx),
        timeDifferenceSeconds: timeAcceptableCandidates[0].diffSeconds,
        matchReasons,
        message: `Foram encontradas ${timeAcceptableCandidates.length} transferências de ${input.currency} ${input.amount} próximas ao horário informado. Revise manualmente.`,
      };
    }

    // Exatamente UMA candidata com horário próximo!
    const single = timeAcceptableCandidates[0];

    // Verificação de reutilização / duplicidade do SOURCE_ID
    if (single.isDuplicate) {
      const matchReasons: MatchReasons = {
        amountExact: true,
        currencyExact: true,
        transactionTypeCorrect: true,
        paymentMethodCorrect: true,
        sameLocalDate: true,
        timeDifferenceSeconds: single.diffSeconds,
        timeProximityScore: single.proximityScore,
        candidateCount: 1,
        uniqueCandidate: true,
        isDuplicateSourceId: true,
        notes: [
          "ALERTA: Esta movimentação (SOURCE_ID) já foi associada a outro comprovante anteriormente.",
        ],
      };

      return {
        status: "manual_review",
        confidenceScore: 40,
        matchedTransaction: single.tx,
        candidateTransactions: [single.tx],
        timeDifferenceSeconds: single.diffSeconds,
        matchReasons,
        message: "Esta movimentação já foi associada a outro comprovante anteriormente. Verificação suspensa para análise manual.",
      };
    }

    // Cálculo do score final
    // Base: 40 pts (valor + moeda + cvu + settlement) + 30 pts (única candidata) + proximidade de tempo (até 30 pts)
    let score = 40 + 30 + single.proximityScore;
    if (score > 100) score = 100;

    notes.push(
      single.diffSeconds <= 120
        ? "Correspondência de horário fortíssima (diferença inferior a 2 minutos)."
        : single.diffSeconds <= 600
        ? "Alta correspondência temporal (diferença inferior a 10 minutos)."
        : "Possível correspondência temporal (diferença inferior a 30 minutos)."
    );

    const matchReasons: MatchReasons = {
      amountExact: true,
      currencyExact: true,
      transactionTypeCorrect: true,
      paymentMethodCorrect: true,
      sameLocalDate: true,
      timeDifferenceSeconds: single.diffSeconds,
      timeProximityScore: single.proximityScore,
      candidateCount: 1,
      uniqueCandidate: true,
      isDuplicateSourceId: false,
      notes,
    };

    return {
      status: "verified",
      confidenceScore: score,
      matchedTransaction: single.tx,
      candidateTransactions: [single.tx],
      timeDifferenceSeconds: single.diffSeconds,
      matchReasons,
      message: "Foi encontrada uma transação correspondente no Mercado Pago.",
    };
  }
}
