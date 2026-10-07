import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fromMinorUnits, formatCurrencyDisplay } from "@/lib/utils/currency";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabaseUser = await createServerSupabaseClient();
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const jobId = params.id;
    if (!jobId) {
      return NextResponse.json({ error: "ID do job é obrigatório" }, { status: 400 });
    }

    const adminSupabase = createAdminClient();

    const { data: job, error } = await adminSupabase
      .from("verification_jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (error || !job) {
      return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
    }

    if (job.status === "completed") {
      // Busca o snapshot gerado mais recentemente
      const { data: snapshot } = await adminSupabase
        .from("mercadopago_balance_snapshots")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (snapshot) {
        const balanceAmount = fromMinorUnits(snapshot.balance_minor);
        return NextResponse.json({
          status: "completed",
          balance: {
            id: snapshot.id,
            currency: snapshot.currency,
            amountMinor: snapshot.balance_minor,
            amountDisplay: balanceAmount,
            formatted: formatCurrencyDisplay(balanceAmount, snapshot.currency),
            status: snapshot.status,
            generatedAt: snapshot.created_at,
          },
        });
      }

      return NextResponse.json({
        status: "completed",
      });
    }

    if (job.status === "error") {
      return NextResponse.json({
        status: "error",
        error: job.error_message || "Falha ao processar saldo.",
        errorCode: job.error_code,
      });
    }

    // Estados em andamento: queued, checking_config, requesting_report, waiting_report, downloading, parsing
    return NextResponse.json({
      status: job.status,
      attempts: job.attempts,
      startedAt: job.started_at,
    });
  } catch (err: any) {
    return NextResponse.json({ error: "Erro interno: " + err.message }, { status: 500 });
  }
}
