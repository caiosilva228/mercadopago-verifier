import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  let databaseHealthy = false;

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("receipts").select("id").limit(1);
    databaseHealthy = !error;
  } catch {
    databaseHealthy = false;
  }

  return NextResponse.json({
    status: databaseHealthy ? "ok" : "degraded",
    database: databaseHealthy,
    worker: true,
    timestamp: new Date().toISOString(),
  });
}
