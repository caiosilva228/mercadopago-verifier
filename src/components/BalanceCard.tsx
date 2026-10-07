"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Wallet,
  RefreshCw,
  Clock,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  ArrowUpRight,
  ArrowDownLeft,
} from "lucide-react";
import { DateTime } from "luxon";

interface BalanceData {
  id: string;
  currency: "ARS";
  amountMinor: number;
  amountDisplay: number;
  formatted: string;
  initialBalanceDisplay: number | null;
  initialBalanceFormatted: string | null;
  creditsDisplay: number;
  creditsFormatted: string;
  debitsDisplay: number;
  debitsFormatted: string;
  status: "reliable" | "manual_review";
  reportDate: string;
  reportFileName: string;
  createdAt: string;
  generatedAt: string;
  cacheValid: boolean;
  ageSeconds: number;
}

interface BalanceCardProps {
  allowForce?: boolean;
  showDetails?: boolean;
  onRefreshComplete?: () => void;
}

export function BalanceCard({
  allowForce = false,
  showDetails = false,
  onRefreshComplete,
}: BalanceCardProps) {
  const [balance, setBalance] = useState<BalanceData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [refreshStep, setRefreshStep] = useState<string>("Iniciando...");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [relativeTime, setRelativeTime] = useState<string>("");
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Calcula string de tempo relativo no fuso de Buenos Aires
  const updateRelativeTime = useCallback((isoString?: string) => {
    if (!isoString) {
      setRelativeTime("");
      return;
    }

    try {
      const dt = DateTime.fromISO(isoString, { zone: "America/Argentina/Buenos_Aires" });
      const now = DateTime.now().setZone("America/Argentina/Buenos_Aires");
      const diffMinutes = Math.floor(now.diff(dt, "minutes").minutes);
      const timeStr = dt.toFormat("HH:mm");

      if (diffMinutes < 1) {
        setRelativeTime(`há poucos instantes (${timeStr})`);
      } else if (diffMinutes === 1) {
        setRelativeTime(`há 1 minuto (${timeStr})`);
      } else if (diffMinutes < 60) {
        setRelativeTime(`há ${diffMinutes} minutos (${timeStr})`);
      } else {
        const diffHours = Math.floor(diffMinutes / 60);
        setRelativeTime(`há ${diffHours}h (${timeStr})`);
      }
    } catch {
      setRelativeTime("");
    }
  }, []);

  // Busca saldo atual na inicialização
  const fetchCurrentBalance = useCallback(async () => {
    try {
      const res = await fetch("/api/balance");
      const data = await res.json();
      if (res.ok && data.hasBalance && data.balance) {
        setBalance(data.balance);
        updateRelativeTime(data.balance.createdAt);
      }
    } catch (err) {
      console.error("Erro ao carregar saldo:", err);
    } finally {
      setIsLoading(false);
    }
  }, [updateRelativeTime]);

  useEffect(() => {
    fetchCurrentBalance();

    // Atualiza o tempo relativo a cada 30 segundos
    const timer = setInterval(() => {
      if (balance?.createdAt) {
        updateRelativeTime(balance.createdAt);
      }
    }, 30000);

    return () => {
      clearInterval(timer);
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [fetchCurrentBalance, balance?.createdAt, updateRelativeTime]);

  // Inicia atualização de saldo
  const handleRefreshBalance = async (force: boolean = false) => {
    if (isRefreshing) return;

    setIsRefreshing(true);
    setErrorMsg(null);
    setRefreshStep("Consultando Mercado Pago...");

    try {
      const res = await fetch("/api/balance/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Falha ao iniciar atualização de saldo.");
      }

      // Se retornou do cache de 2 minutos
      if (data.cached && data.balance) {
        setBalance(data.balance);
        updateRelativeTime(data.balance.generatedAt);
        setIsRefreshing(false);
        if (onRefreshComplete) onRefreshComplete();
        return;
      }

      const jobId = data.jobId;
      if (!jobId) {
        throw new Error("Job de atualização não retornado.");
      }

      // Polling do status do job (a cada 3s)
      pollingRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch(`/api/balance/refresh/${jobId}`);
          const pollData = await pollRes.json();

          if (!pollRes.ok) {
            throw new Error(pollData.error || "Erro ao consultar status do job.");
          }

          if (pollData.status === "completed") {
            if (pollingRef.current) clearInterval(pollingRef.current);
            // Busca o snapshot final
            await fetchCurrentBalance();
            setIsRefreshing(false);
            if (onRefreshComplete) onRefreshComplete();
          } else if (pollData.status === "error") {
            if (pollingRef.current) clearInterval(pollingRef.current);
            setErrorMsg(pollData.error || "Erro ao processar relatório no Mercado Pago.");
            setIsRefreshing(false);
          } else {
            // Mapeia mensagens de progresso
            if (pollData.status === "queued" || pollData.status === "checking_config") {
              setRefreshStep("Consultando Mercado Pago...");
            } else if (pollData.status === "requesting_report" || pollData.status === "waiting_report") {
              setRefreshStep("Gerando relatório de saldo...");
            } else if (pollData.status === "downloading" || pollData.status === "parsing") {
              setRefreshStep("Processando e reconciliando saldo...");
            }
          }
        } catch (pollErr: any) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setErrorMsg(pollErr.message || "Erro no acompanhamento da consulta.");
          setIsRefreshing(false);
        }
      }, 3000);
    } catch (err: any) {
      setErrorMsg(err.message || "Falha na comunicação com o servidor.");
      setIsRefreshing(false);
    }
  };

  return (
    <div className="bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-slate-800/80 border border-slate-750 rounded-2xl p-6 shadow-xl backdrop-blur-xl relative overflow-hidden transition-all">
      {/* Glow de fundo verde/esmeralda para identidade financeira */}
      <div className="absolute -top-16 -right-16 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-16 -left-16 w-48 h-48 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative">
        {/* Cabeçalho e Título do Card */}
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20 text-white shrink-0">
            <Wallet className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                Saldo Mercado Pago
              </span>
              {balance?.status === "manual_review" && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-300 border border-amber-500/30">
                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                  Revisão Manual
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 font-medium">
              Saldo disponível no último relatório
            </p>
          </div>
        </div>

        {/* Botão de Atualização */}
        <div className="flex items-center gap-2 self-end sm:self-auto">
          {allowForce && (
            <button
              onClick={() => handleRefreshBalance(true)}
              disabled={isRefreshing}
              className="text-xs text-slate-400 hover:text-slate-200 underline underline-offset-4 disabled:opacity-50 px-2 py-1.5 transition-colors"
              title="Forçar nova geração ignorando o cache de 2 minutos"
            >
              Forçar Atualização
            </button>
          )}

          <button
            onClick={() => handleRefreshBalance(false)}
            disabled={isRefreshing}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-white transition-all shadow-md ${
              isRefreshing
                ? "bg-slate-800 text-slate-300 border border-slate-700 cursor-not-allowed"
                : "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-emerald-600/20 active:scale-95"
            }`}
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-emerald-400" : ""}`}
            />
            <span>{isRefreshing ? refreshStep : "Atualizar Saldo"}</span>
          </button>
        </div>
      </div>

      {/* Exibição do Valor */}
      <div className="mt-5 pt-4 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
        <div>
          {isLoading ? (
            <div className="h-9 w-48 bg-slate-800 animate-pulse rounded-lg" />
          ) : balance ? (
            <div className="flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-black tracking-tight text-white font-mono">
                {balance.formatted}
              </span>
              <span className="text-xs font-semibold text-slate-400">ARS</span>
            </div>
          ) : (
            <span className="text-lg font-medium text-slate-400 italic">
              Nenhum relatório consultado ainda
            </span>
          )}
        </div>

        {/* Status de Horário da Última Atualização */}
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <Clock className="w-3.5 h-3.5 text-slate-500" />
          <span>
            {relativeTime ? `Última atualização: ${relativeTime}` : "Aguardando primeira consulta"}
          </span>
        </div>
      </div>

      {/* Erro eventual */}
      {errorMsg && (
        <div className="mt-4 p-3 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Detalhes adicionais se solicitado (ex: na página /saldo) */}
      {showDetails && balance && (
        <div className="mt-5 pt-4 border-t border-slate-800/60 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          {balance.initialBalanceFormatted && (
            <div className="bg-slate-950/40 p-3 rounded-xl border border-slate-800/60">
              <span className="text-slate-400 block mb-1">Saldo Inicial</span>
              <span className="font-semibold text-white font-mono">
                {balance.initialBalanceFormatted}
              </span>
            </div>
          )}
          <div className="bg-slate-950/40 p-3 rounded-xl border border-slate-800/60">
            <span className="text-slate-400 flex items-center gap-1 mb-1">
              <ArrowUpRight className="w-3 h-3 text-emerald-400" />
              Créditos no Período
            </span>
            <span className="font-semibold text-emerald-400 font-mono">
              + {balance.creditsFormatted}
            </span>
          </div>
          <div className="bg-slate-950/40 p-3 rounded-xl border border-slate-800/60">
            <span className="text-slate-400 flex items-center gap-1 mb-1">
              <ArrowDownLeft className="w-3 h-3 text-rose-400" />
              Débitos no Período
            </span>
            <span className="font-semibold text-rose-400 font-mono">
              - {balance.debitsFormatted}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
