import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Variáveis de ambiente do Supabase não configuradas no cliente.");
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey, {
    db: {
      schema: "mercadopago",
    },
  });
}
