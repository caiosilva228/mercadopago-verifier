import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fromMinorUnits, formatCurrencyDisplay } from "@/lib/utils/currency";

export async function GET(req: NextRequest) {
  try {
    const supabaseUser = await createServerSupabaseClient();
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const adminSupabase = createAdminClient();

    const { data: snapshot, error } = await adminSupabase
      .from("mercadopago_balance_snapshots")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: "Erro ao consultar saldo: " + error.message }, { status: 500 });
    }

    if (!snapshot) {
      return NextResponse.json({
        hasBalance: false,
        message: "Nenhum relatório de saldo consultado ainda.",
      });
    }

    const balanceAmount = fromMinorUnits(snapshot.balance_minor);
    const initialAmount = snapshot.initial_balance_minor !== null ? fromMinorUnits(snapshot.initial_balance_minor) : null;
    const creditsAmount = fromMinorUnits(snapshot.credits_minor);
    const debitsAmount = fromMinorUnits(snapshot.debits_minor);

    const ageMs = Date.now() - new Date(snapshot.created_at).getTime();
    const cacheValid = ageMs < 2 * 60 * 1000;

    return NextResponse.json({
      hasBalance: true,
      balance: {
        id: snapshot.id,
        currency: snapshot.currency,
        amountMinor: snapshot.balance_minor,
        amountDisplay: balanceAmount,
        formatted: formatCurrencyDisplay(balanceAmount, snapshot.currency),
        initialBalanceDisplay: initialAmount,
        initialBalanceFormatted: initialAmount !== null ? formatCurrencyDisplay(initialAmount, snapshot.currency) : null,
        creditsDisplay: creditsAmount,
        creditsFormatted: formatCurrencyDisplay(creditsAmount, snapshot.currency),
        debitsDisplay: debitsAmount,
        debitsFormatted: formatCurrencyDisplay(debitsAmount, snapshot.currency),
        status: snapshot.status,
        reportDate: snapshot.report_date,
        reportFileName: snapshot.report_file_name,
        createdAt: snapshot.created_at,
        generatedAt: snapshot.created_at,
        cacheValid,
        ageSeconds: Math.round(ageMs / 1000),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: "Erro interno: " + err.message }, { status: 500 });
  }
}
