import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const defaultUrl = "https://nnqlnbgfbixckrxmxdzt.supabase.co";
  const defaultAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ucWxuYmdmYml4Y2tyeG14ZHp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzNjg0NjUsImV4cCI6MjEwNTk0NDQ2NX0.RpB0oV1d6h0TMS_oP13thE9nZCPfmRr2TclM3AOuE6U";

  let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || defaultUrl;
  if (supabaseUrl.includes("placeholder")) supabaseUrl = defaultUrl;

  let supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || defaultAnonKey;
  if (supabaseAnonKey.includes("placeholder") || supabaseAnonKey.length < 20) supabaseAnonKey = defaultAnonKey;

  // Se não estiver configurado, segue em frente (evita crash em build time)
  if (!supabaseUrl || !supabaseAnonKey) {
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Rotas públicas liberadas
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/auth/callback") ||
    pathname === "/api/health" ||
    pathname.startsWith("/_next") ||
    pathname.includes(".")
  ) {
    // Se já estiver logado e tentar acessar /login, manda para o dashboard
    if (pathname === "/login" && user) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return response;
  }

  // Se não houver usuário autenticado, bloqueia e redireciona para login
  if (!user) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
