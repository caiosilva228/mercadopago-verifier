import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import { CheckCircle2, History, LogOut, ShieldCheck, Wallet } from "lucide-react";

export const metadata: Metadata = {
  title: "Verificador de Transferências Mercado Pago",
  description: "Sistema privado de conciliação e verificação automática de transferências Mercado Pago Argentina",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="bg-slate-950 text-slate-100 min-h-screen flex flex-col selection:bg-sky-500 selection:text-white">
        {/* Header Superior */}
        <header className="border-b border-slate-800/80 bg-slate-900/70 backdrop-blur-md sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            {/* Logo e Título */}
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 to-blue-600 flex items-center justify-center shadow-lg shadow-sky-500/20 group-hover:scale-105 transition-transform">
                <ShieldCheck className="w-6 h-6 text-white" />
              </div>
              <div>
                <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-sky-400 bg-clip-text text-transparent">
                  Mercado Pago Verifier
                </span>
                <span className="block text-xs text-slate-400 font-medium">Argentina • Privado</span>
              </div>
            </Link>

            {/* Navegação */}
            <nav className="flex items-center gap-2 sm:gap-4">
              <Link
                href="/"
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800/80 transition-colors"
              >
                <CheckCircle2 className="w-4 h-4 text-sky-400" />
                <span>Verificar</span>
              </Link>
              <Link
                href="/saldo"
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800/80 transition-colors"
              >
                <Wallet className="w-4 h-4 text-emerald-400" />
                <span>Saldo</span>
              </Link>
              <Link
                href="/historico"
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800/80 transition-colors"
              >
                <History className="w-4 h-4 text-slate-400" />
                <span>Histórico</span>
              </Link>


              {/* Botão Logout */}
              <form action="/api/auth/signout" method="POST">
                <button
                  type="submit"
                  title="Sair do sistema"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 border border-transparent hover:border-rose-900/50 transition-all ml-2"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Sair</span>
                </button>
              </form>
            </nav>
          </div>
        </header>

        {/* Conteúdo Principal */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>

        {/* Rodapé */}
        <footer className="border-t border-slate-900 bg-slate-950/50 py-6 text-center text-xs text-slate-500">
          <p>Sistema Privado de Conciliação Financeira • Mercado Pago Argentina Settlement API</p>
        </footer>
      </body>
    </html>
  );
}
