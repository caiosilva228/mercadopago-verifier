import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabaseUser = await createServerSupabaseClient();
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const receiptId = params.id;
    const body = await req.json().catch(() => ({}));
    const note = body.note || "Marcado manualmente pelo operador.";

    const adminSupabase = createAdminClient();

    // Atualiza status do match mais recente para manual_review
    const { data: match } = await adminSupabase
      .from("verification_matches")
      .select("id, match_reasons")
      .eq("receipt_id", receiptId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (match) {
      const reasons = (match.match_reasons || {}) as Record<string, unknown>;
      const existingNotes = (reasons.notes as string[]) || [];
      existingNotes.push(`Revisão Manual: ${note}`);

      await adminSupabase
        .from("verification_matches")
        .update({
          status: "manual_review",
          match_reasons: { ...reasons, notes: existingNotes },
        })
        .eq("id", match.id);
    } else {
      await adminSupabase.from("verification_matches").insert({
        receipt_id: receiptId,
        status: "manual_review",
        confidence_score: 50,
        match_reasons: { notes: [`Revisão Manual: ${note}`] },
      });
    }

    // Registra auditoria
    await adminSupabase.from("audit_logs").insert({
      user_id: user.id,
      event_type: "receipt_marked_manual_review",
      entity_type: "receipt",
      entity_id: receiptId,
      metadata: { note },
    });

    return NextResponse.json({ success: true, message: "Comprovante marcado para revisão manual." });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro ao marcar para revisão manual" },
      { status: 500 }
    );
  }
}
