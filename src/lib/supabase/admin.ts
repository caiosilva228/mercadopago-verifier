import { createClient } from "@supabase/supabase-js";

/**
 * Cliente privilegiado com SERVICE_ROLE para workers e operações internas.
 * NUNCA deve ser importado em componentes ou exposto no frontend.
 */
export function createAdminClient() {
  const defaultUrl = "https://nnqlnbgfbixckrxmxdzt.supabase.co";
  const defaultServiceKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ucWxuYmdmYml4Y2tyeG14ZHp0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDM2ODQ2NSwiZXhwIjoyMTA1OTQ0NDY1fQ.XgmhHnpYSnnVZ_o9O3wkUZru8Iu6WKxf4MCPne8UdZE";

  let supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || defaultUrl;
  if (supabaseUrl.includes("placeholder")) supabaseUrl = defaultUrl;

  let serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || defaultServiceKey;
  if (serviceRoleKey.includes("placeholder") || serviceRoleKey.length < 20) serviceRoleKey = defaultServiceKey;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios para operações admin.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    db: {
      schema: "mercadopago",
    },
  });
}
