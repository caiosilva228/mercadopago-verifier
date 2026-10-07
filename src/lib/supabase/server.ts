import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createServerSupabaseClient() {
  const defaultUrl = "https://nnqlnbgfbixckrxmxdzt.supabase.co";
  const defaultAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ucWxuYmdmYml4Y2tyeG14ZHp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzNjg0NjUsImV4cCI6MjEwNTk0NDQ2NX0.RpB0oV1d6h0TMS_oP13thE9nZCPfmRr2TclM3AOuE6U";

  let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || defaultUrl;
  if (supabaseUrl.includes("placeholder")) supabaseUrl = defaultUrl;

  let supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || defaultAnonKey;
  if (supabaseAnonKey.includes("placeholder") || supabaseAnonKey.length < 20) supabaseAnonKey = defaultAnonKey;

  const cookieStore = cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    db: {
      schema: "mercadopago",
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set({ name, value, ...options })
          );
        } catch {
          // Chamado de Server Components, cookies só podem ser setados em Server Actions ou Route Handlers
        }
      },
    },
  });
}

