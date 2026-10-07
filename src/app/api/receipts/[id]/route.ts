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

    const receiptId = params.id;
    const adminSupabase = createAdminClient();

    const { data: receipt, error: recErr } = await adminSupabase
      .from("receipts")
      .select("*, verification_jobs(*)")
      .eq("id", receiptId)
      .single();

    if (recErr || !receipt) {
      return NextResponse.json({ error: "Comprovante não encontrado" }, { status: 404 });
    }

    // Gera Signed URL temporária de 1 hora para o arquivo no Supabase Storage
    let signedUrl: string | null = null;
    if (receipt.storage_path) {
      const { data: signData } = await adminSupabase.storage
        .from("payment-receipts")
        .createSignedUrl(receipt.storage_path, 3600); // 1 hora de validade

      signedUrl = signData?.signedUrl || null;
    }

    // Busca os matches e transações associadas
    const { data: matches } = await adminSupabase
      .from("verification_matches")
      .select("*, mercadopago_transactions(*)")
      .eq("receipt_id", receiptId)
      .order("created_at", { ascending: false });

    return NextResponse.json({
      receipt,
      signedUrl,
      matches: matches || [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro ao carregar detalhes do comprovante" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabaseUser = await createServerSupabaseClient();
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const receiptId = params.id;
    const adminSupabase = createAdminClient();

    // Busca o storage_path para remover o arquivo do Supabase Storage
    const { data: receipt } = await adminSupabase
      .from("receipts")
      .select("storage_path")
      .eq("id", receiptId)
      .single();

    if (receipt?.storage_path) {
      await adminSupabase.storage
        .from("payment-receipts")
        .remove([receipt.storage_path]);
    }

    // Remove do banco (cascateia para jobs e matches)
    const { error: delErr } = await adminSupabase
      .from("receipts")
      .delete()
      .eq("id", receiptId);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "Comprovante excluído com sucesso." });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro ao excluir comprovante" },
      { status: 500 }
    );
  }
}
