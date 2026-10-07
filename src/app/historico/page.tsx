"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  ArrowRight,
  Loader2,
  FileText,
  Calendar,
} from "lucide-react";
import { formatCurrencyDisplay } from "@/lib/utils/currency";

interface ReceiptItem {
  id: string;
  original_filename: string;
  amount_display: number;
  currency: string;
  transaction_date: string;
  transaction_time: string | null;
  bank_name: string | null;
  created_at: string;
  verification_matches: Array<{
    id: string;
    status: "verified" | "ambiguous" | "not_found" | "manual_review";
    confidence_score: number;
    time_difference_seconds: number | null;
    mercadopago_transactions: {
      source_id: string;
      pay_bank_transfer_id: string | null;
      transaction_type: string;
    } | null;
  }>;
}

export default function HistoricoPage() {
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Filtros
  const [period, setPeriod] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [amountSearch, setAmountSearch] = useState<string>("");
  const [sourceIdSearch, setSourceIdSearch] = useState<string>("");

  const fetchReceipts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (period !== "all") params.set("period", period);
      if (status !== "all") params.set("status", status);
      if (amountSearch) params.set("amount", amountSearch);
      if (sourceIdSearch) params.set("sourceId", sourceIdSearch);

      const res = await fetch(`/api/receipts?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setReceipts(data.receipts || []);
      }
    } catch (err) {
      console.error("Erro ao carregar histórico:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReceipts();
  }, [period, status]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchReceipts();
  };

  const getStatusBadge = (item: ReceiptItem) => {
    const match = item.verification_matches?.[0];
    const s = match?.status;

    if (s === "verified") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Verificado</span>
        </span>
      );
    }
    if (s === "ambiguous") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>Ambíguo</span>
        </span>
      );
    }
    if (s === "manual_review") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-500/15 text-orange-300 border border-orange-500/30">
          <Clock className="w-3.5 h-3.5" />
          <span>Revisão Manual</span>
        </span>
      );
    }
    if (s === "not_found") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/30">
          <XCircle className="w-3.5 h-3.5" />
          <span>Não Encontrado</span>
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
        <span>Pendente</span>
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Histórico de Verificações
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Consulte todos os comprovantes enviados, conciliações e códigos SOURCE_ID vinculados.
          </p>
        </div>
      </div>

      {/* Barra de Filtros */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 backdrop-blur-md space-y-4">
        {/* Filtros Rápidos de Período e Status */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setPeriod("all")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                period === "all" ? "bg-sky-500 text-white shadow-md shadow-sky-500/20" : "text-slate-400 hover:text-white"
              }`}
            >
              Todos
            </button>
            <button
              onClick={() => setPeriod("today")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                period === "today" ? "bg-sky-500 text-white shadow-md shadow-sky-500/20" : "text-slate-400 hover:text-white"
              }`}
            >
              Hoje
            </button>
            <button
              onClick={() => setPeriod("7d")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                period === "7d" ? "bg-sky-500 text-white shadow-md shadow-sky-500/20" : "text-slate-400 hover:text-white"
              }`}
            >
              7 dias
            </button>
            <button
              onClick={() => setPeriod("30d")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                period === "30d" ? "bg-sky-500 text-white shadow-md shadow-sky-500/20" : "text-slate-400 hover:text-white"
              }`}
            >
              30 dias
            </button>
          </div>

          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setStatus("all")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                status === "all" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              Status: Todos
            </button>
            <button
              onClick={() => setStatus("verified")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                status === "verified" ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-emerald-400"
              }`}
            >
              Verified
            </button>
            <button
              onClick={() => setStatus("ambiguous")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                status === "ambiguous" ? "bg-amber-600 text-white" : "text-slate-400 hover:text-amber-400"
              }`}
            >
              Ambiguous
            </button>
            <button
              onClick={() => setStatus("manual_review")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                status === "manual_review" ? "bg-orange-600 text-white" : "text-slate-400 hover:text-orange-400"
              }`}
            >
              Revisão
            </button>
            <button
              onClick={() => setStatus("not_found")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                status === "not_found" ? "bg-rose-600 text-white" : "text-slate-400 hover:text-rose-400"
              }`}
            >
              Not Found
            </button>
          </div>
        </div>

        {/* Busca por Valor e SOURCE_ID */}
        <form onSubmit={handleSearchSubmit} className="flex flex-wrap items-center gap-3 pt-1">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Buscar por SOURCE_ID..."
              value={sourceIdSearch}
              onChange={(e) => setSourceIdSearch(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>

          <div className="relative w-44">
            <input
              type="number"
              step="0.01"
              placeholder="Valor exato..."
              value={amountSearch}
              onChange={(e) => setAmountSearch(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>

          <button
            type="submit"
            className="px-4 py-2 bg-slate-800 hover:bg-slate-750 text-white rounded-xl text-xs font-semibold border border-slate-700 transition-colors"
          >
            Buscar
          </button>
        </form>
      </div>

      {/* Tabela de Resultados */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-xl backdrop-blur-md">
        {loading ? (
          <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
            <span className="text-sm">Carregando histórico...</span>
          </div>
        ) : receipts.length === 0 ? (
          <div className="p-12 text-center text-slate-500 space-y-2">
            <FileText className="w-10 h-10 mx-auto text-slate-600" />
            <p className="text-sm font-medium">Nenhum comprovante encontrado com os filtros selecionados.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-950/80 text-xs font-semibold uppercase text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-5 py-4">Data do envio</th>
                  <th className="px-5 py-4">Valor</th>
                  <th className="px-5 py-4">Data da transferência</th>
                  <th className="px-5 py-4">Banco</th>
                  <th className="px-5 py-4">Status</th>
                  <th className="px-5 py-4">SOURCE_ID</th>
                  <th className="px-5 py-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {receipts.map((r) => {
                  const match = r.verification_matches?.[0];
                  const tx = match?.mercadopago_transactions;

                  return (
                    <tr key={r.id} className="hover:bg-slate-800/40 transition-colors group">
                      <td className="px-5 py-4 whitespace-nowrap text-xs text-slate-400">
                        {new Date(r.created_at).toLocaleString("pt-BR")}
                      </td>

                      <td className="px-5 py-4 whitespace-nowrap font-semibold text-white">
                        {r.amount_display
                          ? formatCurrencyDisplay(r.amount_display, r.currency)
                          : "N/D"}
                      </td>

                      <td className="px-5 py-4 whitespace-nowrap text-xs text-slate-300">
                        {r.transaction_date || "—"} {r.transaction_time ? `• ${r.transaction_time}` : ""}
                      </td>

                      <td className="px-5 py-4 whitespace-nowrap text-xs text-slate-300">
                        {r.bank_name || "—"}
                      </td>

                      <td className="px-5 py-4 whitespace-nowrap">
                        {getStatusBadge(r)}
                      </td>

                      <td className="px-5 py-4 whitespace-nowrap font-mono text-xs text-slate-400">
                        {tx?.source_id ? (
                          <span className="text-sky-400 font-semibold">{tx.source_id}</span>
                        ) : (
                          "—"
                        )}
                      </td>

                      <td className="px-5 py-4 whitespace-nowrap text-right">
                        <Link
                          href={`/verificacao/${r.id}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-sky-600 text-slate-300 hover:text-white transition-all shadow-sm"
                        >
                          <span>Detalhes</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
