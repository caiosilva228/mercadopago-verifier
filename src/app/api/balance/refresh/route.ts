import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { enqueueBalanceRefreshJob } from "@/server/jobs";
import { fromMinorUnits, formatCurrencyDisplay } from "@/lib/utils/currency";

export async function POST(req: NextRequest) {
  try {
    const supabaseUser = await createServerSupabaseClient();
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    let force = false;
    try {
      const body = await req.json();
      force = !!body.force;
    } catch {
      // Body vazio é aceito, default force = false
    }

    const result = await enqueueBalanceRefreshJob({
      force,
      userId: user.id,
    });

    if (result.cached && result.snapshot) {
      const snapshot = result.snapshot;
      const balanceAmount = fromMinorUnits(snapshot.balance_minor);
      return NextResponse.json({
        cached: true,
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
      cached: false,
      status: "queued",
      jobId: result.jobId,
    });
  } catch (err: any) {
    return NextResponse.json({ error: "Erro ao solicitar atualização de saldo: " + err.message }, { status: 500 });
  }
}
