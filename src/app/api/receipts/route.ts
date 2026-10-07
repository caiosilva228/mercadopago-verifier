import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DateTime } from "luxon";

export async function GET(req: NextRequest) {
  try {
    const supabaseUser = await createServerSupabaseClient();
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const period = searchParams.get("period") || "all";
    const status = searchParams.get("status") || "all";
    const amount = searchParams.get("amount");
    const sourceId = searchParams.get("sourceId");

    const adminSupabase = createAdminClient();

    let query = adminSupabase
      .from("receipts")
      .select(`
        id,
        original_filename,
        amount_display,
        currency,
        transaction_date,
        transaction_time,
        bank_name,
        created_at,
        verification_matches(
          id,
          status,
          confidence_score,
          time_difference_seconds,
          mercadopago_transactions(source_id, pay_bank_transfer_id, transaction_type)
        )
      `)
      .order("created_at", { ascending: false });

    // Filtros de período
    const now = DateTime.now().setZone("America/Argentina/Buenos_Aires");
    if (period === "today") {
      const todayStr = now.toFormat("yyyy-MM-dd");
      query = query.eq("transaction_date", todayStr);
    } else if (period === "7d") {
      const sevenDaysAgo = now.minus({ days: 7 }).toFormat("yyyy-MM-dd");
      query = query.gte("transaction_date", sevenDaysAgo);
    } else if (period === "30d") {
      const thirtyDaysAgo = now.minus({ days: 30 }).toFormat("yyyy-MM-dd");
      query = query.gte("transaction_date", thirtyDaysAgo);
    }

    // Filtro por valor
    if (amount) {
      const parsedAmt = parseFloat(amount);
      if (!isNaN(parsedAmt)) {
        query = query.eq("amount_display", parsedAmt);
      }
    }

    const { data: receipts, error: fetchErr } = await query;

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    // Filtros em memória para status e sourceId (já que pertencem à relação matches/transactions)
    let filtered = receipts || [];

    if (status !== "all") {
      filtered = filtered.filter((r) => {
        const matches = (r.verification_matches as unknown) as Array<{ status?: string }> | null;
        return matches && matches.length > 0 && matches[0]?.status === status;
      });
    }

    if (sourceId) {
      const cleanSourceId = sourceId.trim().toLowerCase();
      filtered = filtered.filter((r) => {
        const matches = (r.verification_matches as unknown) as Array<{
          mercadopago_transactions?: { source_id: string } | Array<{ source_id: string }> | null;
        }> | null;
        if (!matches || matches.length === 0) return false;
        const txRaw = matches[0]?.mercadopago_transactions;
        const txObj = Array.isArray(txRaw) ? txRaw[0] : txRaw;
        return txObj && txObj.source_id && txObj.source_id.toLowerCase().includes(cleanSourceId);
      });
    }

    return NextResponse.json({ receipts: filtered });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro ao listar comprovantes" },
      { status: 500 }
    );
  }
}
