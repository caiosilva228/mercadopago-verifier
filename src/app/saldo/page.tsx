"use client";

import { useState, useEffect, useCallback } from "react";
import { BalanceCard } from "@/components/BalanceCard";
import {
  Wallet,
  Clock,
  History,
  RefreshCw,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  ArrowUpRight,
  ArrowDownLeft,
} from "lucide-react";
import { DateTime } from "luxon";

interface SnapshotHistoryItem {
  id: string;
  currency: "ARS";
  balanceDisplay: number;
  balanceFormatted: string;
  creditsDisplay: number;
  creditsFormatted: string;
  debitsDisplay: number;
  debitsFormatted: string;
  initialBalanceDisplay: number | null;
  initialBalanceFormatted: string | null;
  status: "reliable" | "manual_review";
  reportDate: string | null;
  reportFileName: string | null;
  createdAt: string;
}

export default function SaldoPage() {
  const [history, setHistory] = useState<SnapshotHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshingTable, setIsRefreshingTable] = useState<boolean>(false);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/balance/history");
      const data = await res.json();
      if (res.ok && data.data) {
        setHistory(data.data);
      }
    } catch (err) {
      console.error("Erro ao carregar histórico de saldo:", err);
    } finally {
      setIsLoading(false);
      setIsRefreshingTable(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleTableRefresh = () => {
    setIsRefreshingTable(true);
    fetchHistory();
  };

  const formatDateDisplay = (isoStr: string) => {
    try {
      const dt = DateTime.fromISO(isoStr, { zone: "America/Argentina/Buenos_Aires" });
      return {
        date: dt.toFormat("dd/MM/yyyy"),
        time: dt.toFormat("HH:mm:ss"),
      };
    } catch {
      return { date: "-", time: "-" };
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Cabeçalho da Página */}
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
          <Wallet className="w-3.5 h-3.5" />
          <span>Release Report • Conciliação Contábil</span>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white">
          Saldo Disponível Mercado Pago
        </h1>
        <p className="text-slate-400 text-sm max-w-2xl">
          Acompanhamento do saldo da conta Mercado Pago Argentina baseado no processamento de relatórios contábeis de liberação (Release Reports).
        </p>
      </div>

      {/* Card de Saldo no Topo com detalhes expandidos */}
      <BalanceCard
        allowForce={true}
        showDetails={true}
        onRefreshComplete={fetchHistory}
      />

      {/* Histórico Recente de Snapshots */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl shadow-xl overflow-hidden backdrop-blur-md">
        <div className="p-5 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <History className="w-5 h-5 text-slate-400" />
            <div>
              <h2 className="text-base font-bold text-white">
                Histórico Recente de Consultas
              </h2>
              <p className="text-xs text-slate-400">
                Registros preservados a cada atualização realizada no sistema
              </p>
            </div>
          </div>

          <button
            onClick={handleTableRefresh}
            disabled={isRefreshingTable}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-750 transition-colors"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isRefreshingTable ? "animate-spin text-emerald-400" : ""}`}
            />
            <span>Atualizar Lista</span>
          </button>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-slate-500">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-500" />
            <span className="text-sm">Carregando histórico de saldo...</span>
          </div>
        ) : history.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <Wallet className="w-8 h-8 mx-auto mb-2 text-slate-600" />
            <p className="text-sm font-medium text-slate-400">
              Nenhuma consulta de saldo registrada até o momento.
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Clique em &quot;Atualizar Saldo&quot; no card acima para gerar a primeira consulta.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-950/60 text-xs uppercase tracking-wider text-slate-400 border-b border-slate-800/80 font-semibold">
                <tr>
                  <th className="px-5 py-3.5">Data e Hora</th>
                  <th className="px-5 py-3.5">Saldo Disponível</th>
                  <th className="px-5 py-3.5">Créditos</th>
                  <th className="px-5 py-3.5">Débitos</th>
                  <th className="px-5 py-3.5">Saldo Inicial</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5">Arquivo do Relatório</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {history.map((item) => {
                  const { date, time } = formatDateDisplay(item.createdAt);
                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <div className="font-medium text-white">{date}</div>
                        <div className="text-xs text-slate-500">{time}</div>
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <span className="font-mono font-bold text-white text-base">
                          {item.balanceFormatted}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap font-mono text-emerald-400 text-xs">
                        + {item.creditsFormatted}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap font-mono text-rose-400 text-xs">
                        - {item.debitsFormatted}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap font-mono text-slate-400 text-xs">
                        {item.initialBalanceFormatted || "-"}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        {item.status === "reliable" ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Confiável
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            Revisão Manual
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap text-xs text-slate-400 font-mono">
                        {item.reportFileName || "-"}
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
