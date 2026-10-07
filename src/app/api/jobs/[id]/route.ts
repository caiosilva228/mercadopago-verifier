import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabaseUser = await createServerSupabaseClient();
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const jobId = params.id;
    const adminSupabase = createAdminClient();

    const { data: job, error: jobErr } = await adminSupabase
      .from("verification_jobs")
      .select("*, receipts(*)")
      .eq("id", jobId)
      .single();

    if (jobErr || !job) {
      return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
    }

    // Busca o resultado do match se já existir
    const { data: match } = await adminSupabase
      .from("verification_matches")
      .select("*, mercadopago_transactions(*)")
      .eq("receipt_id", job.receipt_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({
      job,
      receipt: job.receipts,
      match: match || null,
      transaction: match?.mercadopago_transactions || null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro ao consultar job" },
      { status: 500 }
    );
  }
}
