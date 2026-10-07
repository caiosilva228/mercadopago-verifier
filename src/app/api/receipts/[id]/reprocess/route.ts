import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { enqueueVerificationJob } from "@/server/jobs";

export async function POST(
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
    const jobId = await enqueueVerificationJob(receiptId);

    return NextResponse.json({
      success: true,
      jobId,
      message: "Reprocessamento agendado com sucesso.",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro ao reprocessar comprovante" },
      { status: 500 }
    );
  }
}
