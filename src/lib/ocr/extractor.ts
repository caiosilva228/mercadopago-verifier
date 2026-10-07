import { createWorker } from "tesseract.js";
import pdfParse from "pdf-parse";
import { ReceiptExtraction, ReceiptExtractionSchema } from "@/types";
import { preprocessImageForOcr } from "./preprocess";
import { parseOcrAmount } from "@/lib/utils/currency";
import { logger } from "@/lib/utils/logger";

export interface ReceiptTextExtractor {
  extractFromBuffer(buffer: Buffer, mimeType: string): Promise<ReceiptExtraction>;
}

export class DefaultReceiptTextExtractor implements ReceiptTextExtractor {
  async extractFromBuffer(buffer: Buffer, mimeType: string): Promise<ReceiptExtraction> {
    let rawText = "";
    let confidence = 0;
    const isPdf = mimeType === "application/pdf" || mimeType.includes("pdf");

    // 1. Se for PDF, tenta extrair o texto embutido nativo
    if (isPdf) {
      try {
        const pdfData = await pdfParse(buffer);
        const extractedText = (pdfData.text || "").trim();

        // Se o PDF tiver texto digital estruturado suficiente (> 30 caracteres relevantes)
        if (extractedText.length >= 30) {
          rawText = extractedText;
          confidence = 92; // Alta confiança para texto nativo digital
          logger.info("Texto extraído nativamente do PDF", { length: rawText.length });
        }
      } catch (pdfErr) {
        logger.warn("Falha na extração de texto digital do PDF, caindo para OCR", {
          error: pdfErr instanceof Error ? pdfErr.message : String(pdfErr),
        });
      }
    }

    // 2. Se não for PDF ou o PDF for escaneado / sem texto, executa OCR
    if (!rawText || rawText.length < 30) {
      try {
        logger.info("Iniciando pipeline OCR via Tesseract");
        const processedImageBuffer = await preprocessImageForOcr(buffer);

        // Inicializa worker Tesseract com idiomas espanhol e inglês
        const worker = await createWorker(["spa", "eng"]);
        const result = await worker.recognize(processedImageBuffer);
        await worker.terminate();

        rawText = result.data.text || "";
        confidence = Math.round(result.data.confidence || 70);
        logger.info("OCR concluído", { confidence, textLength: rawText.length });
      } catch (ocrErr) {
        logger.error("Erro durante execução do OCR", ocrErr);
        rawText = rawText || "";
        confidence = 0;
      }
    }

    // 3. Parser de heurísticas em cima do texto bruto
    const parsed = this.parseReceiptText(rawText, confidence);
    return ReceiptExtractionSchema.parse(parsed);
  }

  private parseReceiptText(text: string, baseConfidence: number): ReceiptExtraction {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const fullText = text.replace(/\r/g, " ");

    let amount: number | null = null;
    let currency: "ARS" | "BRL" | "USD" | null = "ARS"; // Padrão Argentina
    let transactionDate: string | null = null;
    let transactionTime: string | null = null;
    let bankName: string | null = null;
    let senderName: string | null = null;
    let recipientName: string | null = null;
    let destinationAlias: string | null = null;
    let transactionReference: string | null = null;
    let operationNumber: string | null = null;
    let transactionNumber: string | null = null;

    // --- IDENTIFICAÇÃO DE BANCO ---
    const lowerText = fullText.toLowerCase();
    if (lowerText.includes("cuenta dni") || lowerText.includes("banco provincia")) {
      bankName = "Cuenta DNI";
    } else if (lowerText.includes("nación") || lowerText.includes("nacion") || lowerText.includes("bna")) {
      bankName = "Banco Nación";
    } else if (lowerText.includes("mercado pago")) {
      bankName = "Mercado Pago";
    } else if (lowerText.includes("santander")) {
      bankName = "Banco Santander";
    } else if (lowerText.includes("galicia")) {
      bankName = "Banco Galicia";
    } else if (lowerText.includes("bbva") || lowerText.includes("francés")) {
      bankName = "BBVA";
    } else if (lowerText.includes("macro")) {
      bankName = "Banco Macro";
    } else if (lowerText.includes("brubank")) {
      bankName = "Brubank";
    } else if (lowerText.includes("ualá") || lowerText.includes("uala")) {
      bankName = "Ualá";
    } else if (lowerText.includes("naranja x")) {
      bankName = "Naranja X";
    } else if (lowerText.includes("credicoop")) {
      bankName = "Banco Credicoop";
    }

    // --- IDENTIFICAÇÃO DE MOEDA ---
    if (/\busd\b|\bu\$s\b|\bdólares\b|\bdolares\b/i.test(fullText)) {
      currency = "USD";
    } else if (/\bbrl\b|\br\$\b|\breais\b/i.test(fullText)) {
      currency = "BRL";
    } else {
      currency = "ARS";
    }

    // --- IDENTIFICAÇÃO DE VALOR / MONTO ---
    // Procura linhas com padrões de valor: "$ 19.900,00", "Importe: $ 19.900", "Total $19.900"
    const amountRegexes = [
      /(?:importe|monto|total|transferiste|enviaste|pagaste|recibiste|valor)[\s:]*[$A-Z\s]*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})?|[0-9]+(?:,[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/i,
      /\$\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})?|[0-9]+(?:,[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/,
      /([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})?|[0-9]+(?:,[0-9]{2})?)\s*(?:ars|pesos)/i,
    ];

    for (const regex of amountRegexes) {
      const match = fullText.match(regex);
      if (match && match[1]) {
        const parsedAmt = parseOcrAmount(match[1]);
        if (parsedAmt !== null && parsedAmt > 0) {
          amount = parsedAmt;
          break;
        }
      }
    }

    // Fallback: se ainda não encontrou, busca em linhas isoladas que começam com $
    if (amount === null) {
      for (const line of lines) {
        if (line.includes("$")) {
          const match = line.match(/\$\s*([0-9.,]+)/);
          if (match && match[1]) {
            const parsedAmt = parseOcrAmount(match[1]);
            if (parsedAmt !== null && parsedAmt > 0) {
              amount = parsedAmt;
              break;
            }
          }
        }
      }
    }

    // --- IDENTIFICAÇÃO DE DATA ---
    // Padrão DD/MM/YYYY ou DD-MM-YYYY
    const dateMatch = fullText.match(/\b([0-3]?[0-9])[\/\-\.]([0-1]?[0-9])[\/\-\.](202[0-9])\b/);
    if (dateMatch) {
      const day = dateMatch[1].padStart(2, "0");
      const month = dateMatch[2].padStart(2, "0");
      const year = dateMatch[3];
      transactionDate = `${year}-${month}-${day}`;
    } else {
      // Padrão textual: "05 de octubre de 2026"
      const textDateMatch = fullText.match(/\b([0-3]?[0-9])\s+de\s+([a-zA-Z]+)\s+de\s+(202[0-9])\b/i);
      if (textDateMatch) {
        const monthsEs: Record<string, string> = {
          enero: "01", febrero: "02", marzo: "03", abril: "04",
          mayo: "05", junio: "06", julio: "07", agosto: "08",
          septiembre: "09", octubre: "10", noviembre: "11", diciembre: "12",
        };
        const monthKey = textDateMatch[2].toLowerCase();
        if (monthsEs[monthKey]) {
          const day = textDateMatch[1].padStart(2, "0");
          transactionDate = `${textDateMatch[3]}-${monthsEs[monthKey]}-${day}`;
        }
      }
    }

    // --- IDENTIFICAÇÃO DE HORÁRIO ---
    // Padrão HH:mm:ss ou HH:mm (ex: "15:17:45" ou "15:17 hs")
    const timeMatch = fullText.match(/\b([0-2]?[0-9]):([0-5][0-9])(?::([0-5][0-9]))?\b/);
    if (timeMatch) {
      const hour = timeMatch[1].padStart(2, "0");
      const minute = timeMatch[2];
      const second = timeMatch[3] ? timeMatch[3] : "00";
      transactionTime = `${hour}:${minute}:${second}`;
    }

    // --- IDENTIFICAÇÃO DE CÓDIGOS E OPERAÇÃO ---
    const opMatch = fullText.match(/(?:operaci[oó]n|transacci[oó]n|n[uú]mero|nro|id|c[oó]digo|comprobante)[\s:N°º#]*([0-9A-Za-z\-_]{6,30})/i);
    if (opMatch && opMatch[1]) {
      operationNumber = opMatch[1];
      transactionReference = opMatch[1];
      transactionNumber = opMatch[1];
    }

    // --- IDENTIFICAÇÃO DE ALIAS / CVU ---
    const aliasMatch = fullText.match(/(?:alias|cvu|cbu)[\s:]*([a-zA-Z0-9\.\-_]{6,26})/i);
    if (aliasMatch && aliasMatch[1]) {
      destinationAlias = aliasMatch[1];
    }

    // --- IDENTIFICAÇÃO DE NOMES ---
    const destMatch = fullText.match(/(?:para|destinatario|destino|titular)[\s:]+([A-Za-zÁÉÍÓÚáéíóúñÑ\s]{3,35})/i);
    if (destMatch && destMatch[1]) {
      recipientName = destMatch[1].trim();
    }

    const senderMatch = fullText.match(/(?:de|remitente|origen|ordenante)[\s:]+([A-Za-zÁÉÍÓÚáéíóúñÑ\s]{3,35})/i);
    if (senderMatch && senderMatch[1]) {
      senderName = senderMatch[1].trim();
    }

    // Ajuste de confiança baseado na presença de campos críticos
    let computedConfidence = baseConfidence;
    if (amount !== null) computedConfidence += 10;
    if (transactionDate !== null) computedConfidence += 10;
    if (transactionTime !== null) computedConfidence += 5;
    if (bankName !== null) computedConfidence += 5;
    computedConfidence = Math.min(100, Math.max(10, computedConfidence));

    return {
      amount,
      currency,
      transactionDate,
      transactionTime,
      bankName,
      senderName,
      recipientName,
      destinationAlias,
      transactionReference,
      operationNumber,
      transactionNumber,
      rawText: text,
      confidence: computedConfidence,
    };
  }
}
