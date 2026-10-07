import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DefaultReceiptTextExtractor } from "@/lib/ocr/extractor";
import { computeSha256, sanitizeFilename } from "@/lib/utils/hash";
import { toMinorUnits } from "@/lib/utils/currency";
import { logger } from "@/lib/utils/logger";
import { randomUUID } from "crypto";

export const maxDuration = 60; // Permite tempo para OCR em arquivos complexos

export async function POST(req: NextRequest) {
  try {
    // 1. Validação de autenticação
    const supabaseUser = await createServerSupabaseClient();
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "Nenhum arquivo enviado" }, { status: 400 });
    }

    // 2. Validação de tamanho (máximo 10MB)
    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "Arquivo excede o tamanho máximo permitido de 10 MB" },
        { status: 400 }
      );
    }

    // 3. Validação de tipo MIME
    const allowedMimeTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
    ];

    if (!allowedMimeTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Tipo de arquivo não permitido. Aceitos: JPG, PNG, WEBP, PDF." },
        { status: 400 }
      );
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());

    // 4. Cálculo do SHA-256 e verificação de duplicidade de arquivo
    const fileHash = computeSha256(fileBuffer);
    const adminSupabase = createAdminClient();

    const { data: existingReceipt } = await adminSupabase
      .from("receipts")
      .select("*, verification_jobs(id, status, verification_matches(*))")
      .eq("sha256", fileHash)
      .maybeSingle();

    if (existingReceipt) {
      logger.info("Comprovante com mesmo hash SHA-256 já existente", {
        receiptId: existingReceipt.id,
        hash: fileHash,
      });

      return NextResponse.json({
        isDuplicateFile: true,
        message: "Este comprovante já foi enviado anteriormente.",
        receipt: existingReceipt,
      });
    }

    // 5. Upload seguro para o Supabase Storage (bucket payment-receipts)
    const dateNow = new Date();
    const year = dateNow.getUTCFullYear();
    const month = String(dateNow.getUTCMonth() + 1).padStart(2, "0");
    const sanitizedName = sanitizeFilename(file.name);
    const uniqueReceiptId = randomUUID();
    const storagePath = `${user.id}/${year}/${month}/${uniqueReceiptId}-${sanitizedName}`;

    const { error: uploadError } = await adminSupabase.storage
      .from("payment-receipts")
      .upload(storagePath, fileBuffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      logger.error("Erro no upload para o Supabase Storage", uploadError);
      return NextResponse.json(
        { error: `Falha no armazenamento do arquivo: ${uploadError.message}` },
        { status: 500 }
      );
    }

    // 6. Extração OCR e parsing dos campos do comprovante
    logger.info("Iniciando extração do comprovante", { filename: sanitizedName, size: file.size });
    const extractor = new DefaultReceiptTextExtractor();
    const extraction = await extractor.extractFromBuffer(fileBuffer, file.type);

    const amountMinor = extraction.amount ? toMinorUnits(extraction.amount) : null;

    // 7. Salva o registro em mercadopago.receipts
    const { data: newReceipt, error: insertError } = await adminSupabase
      .from("receipts")
      .insert({
        id: uniqueReceiptId,
        user_id: user.id,
        original_filename: sanitizedName,
        mime_type: file.type,
        file_size: file.size,
        storage_path: storagePath,
        sha256: fileHash,
        ocr_raw_text: extraction.rawText,
        ocr_confidence: extraction.confidence,
        amount_minor: amountMinor ? Number(amountMinor) : null,
        amount_display: extraction.amount,
        currency: extraction.currency || "ARS",
        transaction_date: extraction.transactionDate,
        transaction_time: extraction.transactionTime,
        bank_name: extraction.bankName,
        sender_name: extraction.senderName,
        recipient_name: extraction.recipientName,
        destination_alias: extraction.destinationAlias,
        transaction_reference: extraction.transactionReference,
        operation_number: extraction.operationNumber,
        transaction_number: extraction.transactionNumber,
        extraction_json: extraction,
      })
      .select()
      .single();

    if (insertError || !newReceipt) {
      logger.error("Erro ao registrar comprovante no banco de dados", insertError);
      return NextResponse.json(
        { error: `Falha ao salvar comprovante: ${insertError?.message}` },
        { status: 500 }
      );
    }

    // Registra log de auditoria
    await adminSupabase.from("audit_logs").insert({
      user_id: user.id,
      event_type: "receipt_uploaded",
      entity_type: "receipt",
      entity_id: newReceipt.id,
      metadata: {
        filename: sanitizedName,
        fileSize: file.size,
        extractedAmount: extraction.amount,
        extractedDate: extraction.transactionDate,
        confidence: extraction.confidence,
      },
    });

    return NextResponse.json({
      isDuplicateFile: false,
      receipt: newReceipt,
      extraction,
    });
  } catch (err) {
    logger.error("Erro inesperado na rota de upload", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro interno no processamento do upload" },
      { status: 500 }
    );
  }
}
