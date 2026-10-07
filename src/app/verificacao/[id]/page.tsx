"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  RefreshCw,
  Trash2,
  Eye,
  FileText,
  DollarSign,
  Calendar,
  Building2,
  Hash,
  ChevronDown,
  ChevronUp,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { formatCurrencyDisplay } from "@/lib/utils/currency";

export default function DetalhesVerificacaoPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [receipt, setReceipt] = useState<any>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadDetails = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/receipts/${id}`);
      if (res.ok) {
        const data = await res.json();
        setReceipt(data.receipt);
        setSignedUrl(data.signedUrl);
        setMatches(data.matches || []);
      } else {
        setMessage({ type: "error", text: "Comprovante não encontrado." });
      }
    } catch {
      setMessage({ type: "error", text: "Erro ao carregar detalhes." });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) loadDetails();
  }, [id]);

  const handleReprocess = async () => {
    if (!confirm("Deseja realmente reprocessar este comprovante no Mercado Pago?")) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/receipts/${id}/reprocess`, { method: "POST" });
      if (res.ok) {
        setMessage({ type: "success", text: "Reprocessamento agendado! Redirecionando..." });
        setTimeout(() => router.push("/"), 1500);
      } else {
        setMessage({ type: "error", text: "Falha ao agendar reprocessamento." });
      }
    } catch {
      setMessage({ type: "error", text: "Erro de conexão." });
    } finally {
      setActionLoading(false);
    }
  };

  const handleManualReview = async () => {
    const note = prompt("Insira uma observação para a revisão manual:", "Revisado manualmente pelo operador");
    if (note === null) return;

    setActionLoading(true);
    try {
      const res = await fetch(`/api/receipts/${id}/manual-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      if (res.ok) {
        setMessage({ type: "success", text: "Comprovante marcado para revisão manual." });
        loadDetails();
      } else {
        setMessage({ type: "error", text: "Erro ao atualizar status." });
      }
    } catch {
      setMessage({ type: "error", text: "Erro de conexão." });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("ATENÇÃO: Deseja realmente excluir este comprovante e todos os seus registros? Esta ação não pode ser desfeita.")) {
      return;
    }

    setActionLoading(true);
    try {
      const res = await fetch(`/api/receipts/${id}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/historico");
      } else {
        setMessage({ type: "error", text: "Erro ao excluir comprovante." });
      }
    } catch {
      setMessage({ type: "error", text: "Erro de conexão." });
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-slate-400 gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
        <span>Carregando dados da verificação...</span>
      </div>
    );
  }

  if (!receipt) {
    return (
      <div className="p-8 text-center space-y-4">
        <p className="text-slate-400">Comprovante não encontrado.</p>
        <Link href="/historico" className="text-sky-400 text-sm hover:underline">
          Voltar ao histórico
        </Link>
      </div>
    );
  }

  const latestMatch = matches[0];
  const tx = latestMatch?.mercadopago_transactions;

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Barra superior de navegação */}
      <div className="flex items-center justify-between">
        <Link
          href="/historico"
          className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Voltar ao Histórico</span>
        </Link>

        {/* Botões de Ação */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleReprocess}
            disabled={actionLoading}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reprocessar</span>
          </button>

          <button
            onClick={handleManualReview}
            disabled={actionLoading}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-amber-950/40 hover:bg-amber-900/40 text-amber-300 border border-amber-800/60 flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Marcar para Revisão</span>
          </button>

          <button
            onClick={handleDelete}
            disabled={actionLoading}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-rose-950/40 hover:bg-rose-900/40 text-rose-300 border border-rose-800/60 flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Excluir</span>
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`p-4 rounded-xl text-sm flex items-center gap-2 ${
            message.type === "success"
              ? "bg-emerald-950/50 text-emerald-300 border border-emerald-800"
              : "bg-rose-950/50 text-rose-300 border border-rose-800"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Grid Principal: Comprovante e Detalhes */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Coluna da Esquerda: Imagem / PDF do Comprovante (5 colunas) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <FileText className="w-4 h-4 text-sky-400" />
                Comprovante Original
              </h3>
              {signedUrl && (
                <a
                  href={signedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Abrir arquivo
                </a>
              )}
            </div>

            {signedUrl ? (
              receipt.mime_type?.includes("pdf") ? (
                <div className="h-96 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col items-center justify-center p-6 text-center space-y-3">
                  <FileText className="w-16 h-16 text-sky-400" />
                  <p className="text-sm font-semibold text-white">{receipt.original_filename}</p>
                  <a
                    href={signedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
                  >
                    Visualizar PDF Completo
                  </a>
                </div>
              ) : (
                <div className="rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 max-h-[500px] flex items-center justify-center">
                  <img
                    src={signedUrl}
                    alt="Comprovante"
                    className="max-h-[500px] w-auto object-contain"
                  />
                </div>
              )
            ) : (
              <div className="h-64 rounded-2xl bg-slate-950 flex items-center justify-center text-slate-500 text-xs">
                Arquivo indisponível para pré-visualização.
              </div>
            )}

            <div className="text-xs text-slate-400 space-y-1 pt-2">
              <p>Arquivo: <span className="text-white font-mono">{receipt.original_filename}</span></p>
              <p>Hash SHA-256: <span className="text-slate-300 font-mono text-[10px] break-all">{receipt.sha256}</span></p>
              <p>Enviado em: <span className="text-slate-300">{new Date(receipt.created_at).toLocaleString("pt-BR")}</span></p>
            </div>
          </div>
        </div>

        {/* Coluna da Direita: Dados e Match (7 colunas) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Card de Status da Conciliação */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 space-y-5 shadow-xl">
            <h3 className="text-base font-bold text-white">Status da Verificação</h3>

            {latestMatch?.status === "verified" && tx && (
              <div className="p-5 rounded-2xl bg-emerald-950/40 border border-emerald-500/60 space-y-4">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-7 h-7 text-emerald-400" />
                  <div>
                    <h4 className="font-bold text-emerald-300 text-lg">✅ TRANSFERÊNCIA ENCONTRADA</h4>
                    <p className="text-xs text-emerald-200/80">Transação confirmada no relatório Mercado Pago.</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs pt-2 border-t border-emerald-900/40">
                  <div>
                    <span className="text-emerald-400 block font-semibold">SOURCE_ID</span>
                    <span className="text-white font-mono font-bold text-sm">{tx.source_id}</span>
                  </div>
                  <div>
                    <span className="text-emerald-400 block font-semibold">PAY_BANK_TRANSFER_ID</span>
                    <span className="text-white font-mono font-bold text-sm">{tx.pay_bank_transfer_id || "N/A"}</span>
                  </div>
                  <div>
                    <span className="text-emerald-400 block font-semibold">Horário Comprovante</span>
                    <span className="text-white font-bold">{receipt.transaction_time || "N/D"}</span>
                  </div>
                  <div>
                    <span className="text-emerald-400 block font-semibold">Horário Mercado Pago</span>
                    <span className="text-white font-bold">
                      {new Date(tx.transaction_date).toLocaleTimeString("pt-BR", { timeZone: "America/Argentina/Buenos_Aires" })}
                    </span>
                  </div>
                  <div>
                    <span className="text-emerald-400 block font-semibold">Diferença</span>
                    <span className="text-emerald-300 font-bold">
                      {latestMatch.time_difference_seconds !== null ? `${latestMatch.time_difference_seconds}s` : "N/D"}
                    </span>
                  </div>
                  <div>
                    <span className="text-emerald-400 block font-semibold">Score Confiabilidade</span>
                    <span className="text-emerald-300 font-bold">{latestMatch.confidence_score}%</span>
                  </div>
                </div>
              </div>
            )}

            {latestMatch?.status === "ambiguous" && (
              <div className="p-5 rounded-2xl bg-amber-950/40 border border-amber-500/60 space-y-2">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-7 h-7 text-amber-400" />
                  <div>
                    <h4 className="font-bold text-amber-300 text-lg">⚠️ MAIS DE UMA TRANSFERÊNCIA POSSÍVEL</h4>
                    <p className="text-xs text-amber-200/80">
                      Múltiplas transferências com o mesmo valor e data foram identificadas.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {latestMatch?.status === "not_found" && (
              <div className="p-5 rounded-2xl bg-rose-950/40 border border-rose-500/60 space-y-2">
                <div className="flex items-center gap-3">
                  <XCircle className="w-7 h-7 text-rose-400" />
                  <div>
                    <h4 className="font-bold text-rose-300 text-lg">❌ TRANSFERÊNCIA NÃO ENCONTRADA</h4>
                    <p className="text-xs text-rose-200/80">
                      Nenhuma movimentação correspondente no Mercado Pago foi localizada.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {(!latestMatch || latestMatch.status === "manual_review") && (
              <div className="p-5 rounded-2xl bg-orange-950/40 border border-orange-500/60 space-y-2">
                <div className="flex items-center gap-3">
                  <Clock className="w-7 h-7 text-orange-400" />
                  <div>
                    <h4 className="font-bold text-orange-300 text-lg">⚠️ REVISÃO MANUAL</h4>
                    <p className="text-xs text-orange-200/80">
                      Este registro aguarda conferência de um operador.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Dados Comparados (OCR vs Dados Confirmados) */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-xl">
            <h3 className="text-base font-bold text-white">Dados do Comprovante</h3>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-850">
                <span className="text-slate-500 block mb-1">Valor Registrado</span>
                <span className="text-sm font-bold text-white">
                  {receipt.amount_display ? formatCurrencyDisplay(receipt.amount_display, receipt.currency) : "—"}
                </span>
              </div>

              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-850">
                <span className="text-slate-500 block mb-1">Data</span>
                <span className="text-sm font-bold text-white">{receipt.transaction_date || "—"}</span>
              </div>

              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-850">
                <span className="text-slate-500 block mb-1">Hora</span>
                <span className="text-sm font-bold text-white">{receipt.transaction_time || "—"}</span>
              </div>

              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-850">
                <span className="text-slate-500 block mb-1">Banco</span>
                <span className="text-sm font-bold text-white">{receipt.bank_name || "—"}</span>
              </div>

              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-850">
                <span className="text-slate-500 block mb-1">Destinatário / Titular</span>
                <span className="text-sm font-bold text-white">{receipt.recipient_name || "—"}</span>
              </div>

              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-850">
                <span className="text-slate-500 block mb-1">Referência / Op</span>
                <span className="text-sm font-mono font-bold text-white">{receipt.transaction_reference || "—"}</span>
              </div>
            </div>
          </div>

          {/* Seção Avançada / Metadados Raw */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 shadow-xl">
            <button
              onClick={() => setShowRaw(!showRaw)}
              className="w-full flex items-center justify-between text-xs font-semibold text-slate-400 hover:text-white transition-colors"
            >
              <span>Metadados Avançados e Texto OCR Bruto</span>
              {showRaw ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showRaw && (
              <div className="mt-4 pt-4 border-t border-slate-800 space-y-4 text-xs font-mono">
                <div>
                  <span className="text-slate-400 block font-semibold mb-1">Texto Bruto Extraído pelo OCR:</span>
                  <pre className="bg-slate-950 p-4 rounded-xl border border-slate-850 text-slate-300 max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px]">
                    {receipt.ocr_raw_text || "Nenhum texto bruto disponível."}
                  </pre>
                </div>

                {latestMatch?.match_reasons && (
                  <div>
                    <span className="text-slate-400 block font-semibold mb-1">Critérios de Matching (match_reasons JSON):</span>
                    <pre className="bg-slate-950 p-4 rounded-xl border border-slate-850 text-sky-300 max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px]">
                      {JSON.stringify(latestMatch.match_reasons, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
