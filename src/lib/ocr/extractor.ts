import { createWorker } from "tesseract.js";
import pdfParse from "pdf-parse";
import { ReceiptExtraction, ReceiptExtractionSchema } from "@/types";
import { preprocessImageForOcr } from "./preprocess";
import { parseOcrAmount } from "@/lib/utils/currency";
import { logger } from "@/lib/utils/logger";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";

const execFileAsync = promisify(execFile);

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
        logger.info("Iniciando pipeline OCR para comprovante");
        const processedImageBuffer = await preprocessImageForOcr(buffer);

        // Tentativa 1: Native Tesseract CLI (instalado no container Linux via apt-get - ultra-rápido, sem download de rede)
        let ocrResult: { text: string; confidence: number } | null = null;
        try {
          const tempFile = path.join(os.tmpdir(), `ocr-${randomUUID()}.png`);
          await fs.writeFile(tempFile, processedImageBuffer);
          try {
            const { stdout } = await execFileAsync("tesseract", [tempFile, "stdout", "-l", "spa+eng"], {
              timeout: 10000,
              maxBuffer: 5 * 1024 * 1024,
            });
            const text = stdout ? stdout.trim() : "";
            if (text.length > 5) {
              ocrResult = { text, confidence: 85 };
              logger.info("OCR nativo via tesseract CLI concluído com sucesso", { textLength: text.length });
            }
          } finally {
            await fs.unlink(tempFile).catch(() => {});
          }
        } catch (nativeErr: any) {
          logger.warn("Tesseract CLI nativo indisponível ou falhou, tentando fallback tesseract.js", {
            msg: nativeErr.message,
          });
        }

        // Tentativa 2: Fallback tesseract.js com timeout estrito de 12 segundos e cache em os.tmpdir()
        if (!ocrResult) {
          const tesseractJsPromise = (async () => {
            const worker = await createWorker(["spa", "eng"], 1, {
              cachePath: os.tmpdir(),
            });
            try {
              const result = await worker.recognize(processedImageBuffer);
              return {
                text: result.data.text || "",
                confidence: Math.round(result.data.confidence || 70),
              };
            } finally {
              await worker.terminate().catch(() => {});
            }
          })();

          const timeoutPromise = new Promise<{ text: string; confidence: number }>((_, reject) =>
            setTimeout(() => reject(new Error("Timeout no Tesseract.js (12 segundos)")), 12000)
          );

          ocrResult = await Promise.race([tesseractJsPromise, timeoutPromise]);
          logger.info("OCR via tesseract.js concluído", {
            confidence: ocrResult.confidence,
            textLength: ocrResult.text.length,
          });
        }

        if (ocrResult) {
          rawText = ocrResult.text;
          confidence = ocrResult.confidence;
        }
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
    if (/cuenta[\s\S]{0,15}dni|banco\s*provincia/i.test(fullText)) {
      bankName = "Cuenta DNI";
    } else if (/banco\s*naci[oó]n|\bnaci[oó]n\b|\bbna\b/i.test(fullText)) {
      bankName = "Banco Nación";
    } else if (/mercado\s*pago/i.test(fullText)) {
      bankName = "Mercado Pago";
    } else if (/santander/i.test(fullText)) {
      bankName = "Banco Santander";
    } else if (/galicia/i.test(fullText)) {
      bankName = "Banco Galicia";
    } else if (/bbva|franc[eé]s/i.test(fullText)) {
      bankName = "BBVA";
    } else if (/macro/i.test(fullText)) {
      bankName = "Banco Macro";
    } else if (/brubank/i.test(fullText)) {
      bankName = "Brubank";
    } else if (/ual[aá]/i.test(fullText)) {
      bankName = "Ualá";
    } else if (/naranja\s*x/i.test(fullText)) {
      bankName = "Naranja X";
    } else if (/credicoop/i.test(fullText)) {
      bankName = "Banco Credicoop";
    } else if (/personal\s*pay/i.test(fullText)) {
      bankName = "Personal Pay";
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
    const dateMatch = fullText.match(/\b([0-3]?[0-9])[\/\-\.]([0-1]?[0-9])[\/\-\.](202[0-9])\b/);
    if (dateMatch) {
      const day = dateMatch[1].padStart(2, "0");
      const month = dateMatch[2].padStart(2, "0");
      const year = dateMatch[3];
      transactionDate = `${year}-${month}-${day}`;
    } else {
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
    const timeMatch = fullText.match(/\b([0-2]?[0-9]):([0-5][0-9])(?::([0-5][0-9]))?\b/);
    if (timeMatch) {
      const hour = timeMatch[1].padStart(2, "0");
      const minute = timeMatch[2];
      const second = timeMatch[3] ? timeMatch[3] : "00";
      transactionTime = `${hour}:${minute}:${second}`;
    }

    // --- IDENTIFICAÇÃO DE CÓDIGOS E OPERAÇÃO ESPECÍFICOS (COELSA, TRANSACCIÓN, MERCADO PAGO) ---
    const mpOpMatch = fullText.match(/(?:N[.°º#\s]*de\s+operaci[oó]n(?:\s+de\s+Mercado\s*Pago)?|operaci[oó]n\s+de\s+Mercado\s*Pago)[\s:N°º#\n\r]*([0-9]{8,25})/i);
    const coelsaMatch = fullText.match(/COELSA\s+ID[\s:\n\r]+([0-9A-Za-z]{6,35})/i);
    const txCodeMatch = fullText.match(/C[oó]digo\s+de\s+transacci[oó]n[\s:\n\r]+([0-9a-fA-F\-]{10,40})/i);
    if (mpOpMatch && mpOpMatch[1]) {
      operationNumber = mpOpMatch[1].trim();
      transactionReference = mpOpMatch[1].trim();
      transactionNumber = mpOpMatch[1].trim();
    } else if (coelsaMatch && coelsaMatch[1]) {
      operationNumber = coelsaMatch[1].trim();
      transactionReference = coelsaMatch[1].trim();
      transactionNumber = coelsaMatch[1].trim();
    } else if (txCodeMatch && txCodeMatch[1]) {
      operationNumber = txCodeMatch[1].trim();
      transactionReference = txCodeMatch[1].trim();
      transactionNumber = txCodeMatch[1].trim();
    } else {
      const opRegexes = [
        /(?:N[.°º#\s]*de\s+operaci[oó]n|c[oó]digo\s+de\s+referencia|c[oó]digo\s+de\s+transferencia|referencia\s+bancaria|n[uú]mero\s+de\s+transacci[oó]n|n[uú]mero\s+de\s+operaci[oó]n)[\s\S]{0,30}?([0-9A-Za-z\-_]{8,35})/i,
        /(?:operaci[oó]n|transacci[oó]n|n[uú]mero|nro|id|c[oó]digo|comprobante)[\s:N°º#\n\r]*([0-9A-Za-z\-_]{6,35})/i,
      ];
      for (const r of opRegexes) {
        const match = fullText.match(r);
        if (match && match[1]) {
          const val = match[1].trim();
          if (!/^(de|para|con|por|transferencia|comprobante|varios|coelsa|bancaria)$/i.test(val)) {
            operationNumber = val;
            transactionReference = val;
            transactionNumber = val;
            break;
          }
        }
      }
    }

    // --- REMOÇÃO DE RODAPÉ PUBLICITÁRIO DO MERCADO PAGO ---
    // Remove seções promocionais que possam contaminar a extração (ex: "Transferí $ 3,00 para Alejandra +")
    const cleanFullText = fullText
      .replace(/(?:Hac[eé]\s+pagos|Descarg[aá]\s+la\s+app|Transfer[ií]\s+\$)[\s\S]*/i, "")
      .trim();

    // --- IDENTIFICAÇÃO DE ESTRUTURA "Cuenta origen" / "Cuenta destino" (NARANJA X E AFINS) ---
    const cuentaOrigenMatch = cleanFullText.match(/Cuenta\s+origen([\s\S]*?)Cuenta\s+destino/i);
    const cuentaDestinoMatch = cleanFullText.match(/Cuenta\s+destino([\s\S]*?)(?:Informaci[oó]n\s+de\s+la\s+operaci[oó]n|Naranja\s+Digital|$)/i);

    if (cuentaDestinoMatch) {
      const destSection = cuentaDestinoMatch[1];
      const destCvuMatch = destSection.match(/(?:CVU|CBU)[\s:\n\r]+([0-9]{15,26})/i);
      if (destCvuMatch) {
        destinationAlias = destCvuMatch[1];
      }

      const destLines = destSection.split("\n").map((l) => l.trim()).filter(Boolean);
      for (const l of destLines) {
        const cleaned = l.replace(/^(?:ae\.|\*|\-|\•|wy|[0-9\s])+/, "").trim();
        if (
          cleaned.length >= 3 &&
          !/^(Mercado\s*Pago|Naranja\s*X|CVU|CBU|CUIT|CUIL|Cuenta|Destino)/i.test(cleaned) &&
          !/^[0-9\-\.\/\s]+$/.test(cleaned)
        ) {
          recipientName = cleaned;
          break;
        }
      }
    }

    if (cuentaOrigenMatch && !senderName) {
      const origSection = cuentaOrigenMatch[1];
      const origLines = origSection.split("\n").map((l) => l.trim()).filter(Boolean);
      for (const l of origLines) {
        const cleaned = l.replace(/^(?:NX\s+|\*|\-|\•|[0-9\s])+/, "").trim();
        if (
          cleaned.length >= 3 &&
          !/^(Naranja\s*X|Mercado\s*Pago|CBU|CVU|CUIT|CUIL|Cuenta|Origen)/i.test(cleaned) &&
          !/^[0-9\-\.\/\s]+$/.test(cleaned)
        ) {
          senderName = cleaned;
          break;
        }
      }
    }

    // --- IDENTIFICAÇÃO DE ALIAS / CVU & NOMES ESTRUTURADOS (MERCADO PAGO) ---
    // Em comprovantes do Mercado Pago ("Origen y destino"):
    // A primeira pessoa é a origem (remitente) e a segunda é o destino (destinatário).
    const origenDestinoMatch = cleanFullText.match(/Origen\s+y\s+destino([\s\S]*?)(?:N[.°\s]*de\s+operaci[oó]n|Motivo|Hac[eé]|$)/i);
    if (origenDestinoMatch) {
      const section = origenDestinoMatch[1];
      const cvus: string[] = [];
      const cvuRegex = /(?:CVU|CBU):\s*([0-9]{15,26})/gi;
      let cMatch;
      while ((cMatch = cvuRegex.exec(section)) !== null) {
        cvus.push(cMatch[1]);
      }

      const rawLines = section.split("\n").map((l) => l.trim()).filter(Boolean);
      const extractedPeople: string[] = [];
      for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        // Remove artefatos de bullets/ícones OCR como &, =, ©, <, >, *, -, •, ~, |, @, #, dígitos isolados, etc.
        let cleaned = line.replace(/^[&=©<>*•\-~|@#º°\^—_+/\\()[\]\d\s]+/, "").trim();
        cleaned = cleaned.replace(/^[&=<>*•\-~|@#]\s+/, "").trim();
        if (
          cleaned.length >= 3 &&
          !/^(Mercado\s*Pago|CVU|CBU|CUIT|CUIL|Origen|Destino|Varios|Motivo)/i.test(cleaned) &&
          !/^[0-9\-\.\/\s]+$/.test(cleaned)
        ) {
          const nextLine = rawLines[i + 1] || "";
          if (/^(Mercado\s*Pago|CVU|CBU|CUIT|CUIL|Banco)/i.test(nextLine) || cvus.length > 0) {
            extractedPeople.push(cleaned);
          }
        }
      }

      if (extractedPeople.length >= 2) {
        senderName = extractedPeople[0];
        recipientName = extractedPeople[1];
      } else if (extractedPeople.length === 1) {
        recipientName = extractedPeople[0];
      }

      if (cvus.length >= 2) {
        destinationAlias = cvus[1]; // Segundo CVU é o destinatário
      } else if (cvus.length === 1 && !destinationAlias) {
        destinationAlias = cvus[0];
      }
    }

    // --- IDENTIFICAÇÃO DE ALIAS / CVU (Fallback para outros bancos) ---
    if (!destinationAlias) {
      const aliasMatch = cleanFullText.match(/(?:alias|cvu|cbu)[\s:]*([a-zA-Z0-9\.\-_]{6,26})/i);
      if (aliasMatch && aliasMatch[1]) {
        destinationAlias = aliasMatch[1];
      }
    }

    // --- IDENTIFICAÇÃO DE NOMES (Fallback para outros bancos) ---
    if (!recipientName) {
      const destMatch = cleanFullText.match(/(?:para|destinatario|destino|titular|beneficiario)[\s:\n\r]+([A-Za-zÁÉÍÓÚáéíóúñÑ\s]{3,35})/i);
      if (destMatch && destMatch[1]) {
        const val = destMatch[1].trim().replace(/\s+(alias|cbu|cvu|cuil|cuit)[\s\S]*/i, "").trim();
        if (!/^Alejandra$/i.test(val) && val.length >= 3) {
          recipientName = val;
        }
      }
    }

    if (!senderName) {
      // Ignora "Origen y destino" para não capturar "y destino"
      const senderMatch = cleanFullText.match(/(?:remitente|ordenante|de\s*:)[\s:\n\r]+([A-Za-zÁÉÍÓÚáéíóúñÑ\s]{3,35})/i);
      if (senderMatch && senderMatch[1]) {
        const val = senderMatch[1].trim().replace(/\s+(cbu|cvu|cuil|cuit)[\s\S]*/i, "").trim();
        if (!/^y\s+destino/i.test(val) && val.length >= 3) {
          senderName = val;
        }
      }
    }

    // Limpeza de segurança final para evitar falsos positivos e artefatos de OCR
    if (senderName) {
      senderName = senderName.replace(/^[&=©<>*•\-~|@#º°\^—_+/\\()[\]\s]+/, "").trim();
      if (/^y\s+destino/i.test(senderName)) {
        senderName = null;
      }
    }
    if (recipientName) {
      recipientName = recipientName.replace(/^[&=©<>*•\-~|@#º°\^—_+/\\()[\]\s]+/, "").trim();
      if (/^Alejandra$/i.test(recipientName) && !cleanFullText.includes("Alejandra")) {
        recipientName = null;
      }
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
