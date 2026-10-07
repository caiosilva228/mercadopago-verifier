import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ReceiptVerificationInputSchema } from "@/types";
import { enqueueVerificationJob } from "@/server/jobs";
import { toMinorUnits } from "@/lib/utils/currency";
import { logger } from "@/lib/utils/logger";

export async function POST(req: NextRequest) {
  try {
    const supabaseUser = await createServerSupabaseClient();
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = await req.json();
    const parsedInput = ReceiptVerificationInputSchema.safeParse(body);

    if (!parsedInput.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: parsedInput.error.format() },
        { status: 400 }
      );
    }

    const {
      receiptId,
      amount,
      currency,
      transactionDate,
      transactionTime,
      bankName,
      transactionReference,
    } = parsedInput.data;

    const adminSupabase = createAdminClient();

    // 1. Atualiza o comprovante com os dados conferidos/corrigidos pelo usuário
    const amountMinor = toMinorUnits(amount);

    const { error: updateError } = await adminSupabase
      .from("receipts")
      .update({
        amount_minor: Number(amountMinor),
        amount_display: amount,
        currency,
        transaction_date: transactionDate,
        transaction_time: transactionTime || null,
        bank_name: bankName || null,
        transaction_reference: transactionReference || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", receiptId);

    if (updateError) {
      logger.error("Erro ao atualizar dados conferidos do comprovante", updateError);
      return NextResponse.json(
        { error: "Falha ao salvar dados de verificação do comprovante." },
        { status: 500 }
      );
    }

    // 2. Enfileira e dispara o job de verificação assíncrono
    const jobId = await enqueueVerificationJob(receiptId);

    logger.info("Job de verificação enfileirado com sucesso", { receiptId, jobId });

    return NextResponse.json(
      {
        jobId,
        status: "queued",
        message: "Verificação iniciada com sucesso.",
      },
      { status: 202 }
    );
  } catch (err) {
    logger.error("Erro na rota de verificação", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro interno ao iniciar verificação" },
      { status: 500 }
    );
  }
}
