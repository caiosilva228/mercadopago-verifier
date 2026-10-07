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

    const { data: snapshots, error } = await adminSupabase
      .from("mercadopago_balance_snapshots")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json({ error: "Erro ao consultar histórico de saldo: " + error.message }, { status: 500 });
    }

    const formattedList = (snapshots || []).map((s) => {
      const balanceAmount = fromMinorUnits(s.balance_minor);
      const creditsAmount = fromMinorUnits(s.credits_minor);
      const debitsAmount = fromMinorUnits(s.debits_minor);
      const initialAmount = s.initial_balance_minor !== null ? fromMinorUnits(s.initial_balance_minor) : null;

      return {
        id: s.id,
        currency: s.currency,
        balanceDisplay: balanceAmount,
        balanceFormatted: formatCurrencyDisplay(balanceAmount, s.currency),
        creditsDisplay: creditsAmount,
        creditsFormatted: formatCurrencyDisplay(creditsAmount, s.currency),
        debitsDisplay: debitsAmount,
        debitsFormatted: formatCurrencyDisplay(debitsAmount, s.currency),
        initialBalanceDisplay: initialAmount,
        initialBalanceFormatted: initialAmount !== null ? formatCurrencyDisplay(initialAmount, s.currency) : null,
        status: s.status,
        reportDate: s.report_date,
        reportFileName: s.report_file_name,
        createdAt: s.created_at,
      };
    });

    return NextResponse.json({
      data: formattedList,
    });
  } catch (err: any) {
    return NextResponse.json({ error: "Erro interno: " + err.message }, { status: 500 });
  }
}
