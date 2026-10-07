import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "E-mail e senha são obrigatórios." },
        { status: 400 }
      );
    }

    const defaultUrl = "https://nnqlnbgfbixckrxmxdzt.supabase.co";
    const defaultAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ucWxuYmdmYml4Y2tyeG14ZHp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzNjg0NjUsImV4cCI6MjEwNTk0NDQ2NX0.RpB0oV1d6h0TMS_oP13thE9nZCPfmRr2TclM3AOuE6U";

    let supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || defaultUrl;
    if (supabaseUrl.includes("placeholder")) supabaseUrl = defaultUrl;

    let supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || defaultAnonKey;
    if (supabaseAnonKey.includes("placeholder") || supabaseAnonKey.length < 20) supabaseAnonKey = defaultAnonKey;

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: "Configuração do Supabase não encontrada no servidor." },
        { status: 500 }
      );
    }

    let response = NextResponse.json({ success: true });

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    });

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      const message =
        error.message === "Invalid login credentials"
          ? "E-mail ou senha incorretos."
          : error.message;

      return NextResponse.json({ error: message }, { status: 401 });
    }

    return response;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro interno no login." },
      { status: 500 }
    );
  }
}
