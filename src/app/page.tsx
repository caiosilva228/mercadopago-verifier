"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  ArrowRight,
  RefreshCw,
  Clock,
  Building2,
  DollarSign,
  Calendar,
  Hash,
  Eye,
  Check,
  AlertCircle,
} from "lucide-react";
import { formatCurrencyDisplay } from "@/lib/utils/currency";

interface ExtractedData {
  amount: number | null;
  currency: "ARS" | "BRL" | "USD" | null;
  transactionDate: string | null;
  transactionTime: string | null;
  bankName: string | null;
  transactionReference: string | null;
  confidence: number;
}

interface MatchResultData {
  status: "verified" | "ambiguous" | "not_found" | "manual_review" | "error";
  confidenceScore: number;
  timeDifferenceSeconds: number | null;
  matchReasons?: {
    notes?: string[];
    isDuplicateSourceId?: boolean;
    candidateCount?: number;
  };
  matchedTransaction?: {
    source_id: string;
    pay_bank_transfer_id: string | null;
    transaction_amount_display: number;
    transaction_currency: string;
    transaction_date: string;
    payment_method: string;
    payment_method_type: string;
  } | null;
  candidateTransactions?: Array<{
    source_id: string;
    pay_bank_transfer_id: string | null;
    transaction_amount_display: number;
    transaction_currency: string;
    transaction_date: string;
    payment_method: string;
  }>;
}

const STEP_LABELS = [
  "Upload recebido",
  "Extraindo informações",
  "Identificando pagamento",
  "Consultando Mercado Pago",
  "Gerando relatório",
  "Comparando movimentações",
  "Resultado",
];

export default function VerificationDashboard() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Estado dos dados extraídos / editáveis
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [showEditForm, setShowEditForm] = useState(false);

  // Formulário editável
  const [editAmount, setEditAmount] = useState<string>("");
  const [editCurrency, setEditCurrency] = useState<"ARS" | "BRL" | "USD">("ARS");
  const [editDate, setEditDate] = useState<string>("");
  const [editTime, setEditTime] = useState<string>("");
  const [editBank, setEditBank] = useState<string>("");
  const [editRef, setEditRef] = useState<string>("");

  // Estado do Job e Resultado
  const [jobId, setJobId] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [result, setResult] = useState<MatchResultData | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Limpa preview ao desmontar
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Polling de status do Job quando jobId estiver ativo
  useEffect(() => {
    if (!jobId || !isVerifying) return;

    let isMounted = true;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) return;

        const data = await res.json();
        if (!isMounted) return;

        const status = data.job?.status;

        // Mapeia status do job para o stepper visual
        if (status === "checking_report") setCurrentStepIndex(3);
        else if (status === "generating_report" || status === "waiting_report") setCurrentStepIndex(4);
        else if (status === "downloading_report" || status === "matching") setCurrentStepIndex(5);
        else if (["verified", "ambiguous", "not_found", "manual_review", "error"].includes(status)) {
          setCurrentStepIndex(6);
          setIsVerifying(false);

          if (data.match) {
            setResult({
              status: data.match.status,
              confidenceScore: data.match.confidence_score,
              timeDifferenceSeconds: data.match.time_difference_seconds,
              matchReasons: data.match.match_reasons,
              matchedTransaction: data.transaction,
            });
          } else if (status === "not_found") {
            setResult({
              status: "not_found",
              confidenceScore: 0,
              timeDifferenceSeconds: null,
            });
          } else if (status === "error") {
            setErrorMsg(data.job?.error_message || "Falha durante processamento no Mercado Pago.");
          }
          clearInterval(interval);
        }
      } catch (err) {
        console.error("Erro no polling do job:", err);
      }
    }, 2500);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [jobId, isVerifying]);

  // Manipulação de Arquivos
  const handleFileSelect = (selectedFile: File) => {
    setErrorMsg(null);
    setDuplicateWarning(null);
    setResult(null);
    setExtractedData(null);
    setShowEditForm(false);
    setJobId(null);
    setCurrentStepIndex(0);

    if (selectedFile.size > 10 * 1024 * 1024) {
      setErrorMsg("O arquivo excede o limite máximo de 10 MB.");
      return;
    }

    setFile(selectedFile);
    if (selectedFile.type.startsWith("image/")) {
      setPreviewUrl(URL.createObjectURL(selectedFile));
    } else {
      setPreviewUrl(null);
    }

    // Inicia upload e OCR automaticamente
    uploadAndExtract(selectedFile);
  };

  const uploadAndExtract = async (fileToUpload: File) => {
    setIsUploading(true);
    setCurrentStepIndex(0);
    setErrorMsg(null);

    const formData = new FormData();
    formData.append("file", fileToUpload);

    try {
      setCurrentStepIndex(1); // Extraindo informações
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Falha ao enviar arquivo.");
      }

      if (data.isDuplicateFile) {
        setDuplicateWarning("Este comprovante já foi enviado anteriormente. Exibindo dados existentes.");
      }

      setReceiptId(data.receipt.id);
      const extraction = data.extraction || data.receipt.extraction_json;
      setExtractedData(extraction);

      // Preenche campos para conferência/edição
      setEditAmount(extraction?.amount ? String(extraction.amount) : "");
      setEditCurrency(extraction?.currency || "ARS");
      setEditDate(extraction?.transactionDate || "");
      setEditTime(extraction?.transactionTime || "");
      setEditBank(extraction?.bankName || "");
      setEditRef(extraction?.transactionReference || "");

      setCurrentStepIndex(2); // Identificando pagamento
      setShowEditForm(true);

      // Se confiança for muito alta (> 90%) e tiver campos essenciais, pode auto-iniciar se desejar
      // Mas oferecemos a conferência visual conforme requisito 7
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro no upload.");
      setCurrentStepIndex(0);
    } finally {
      setIsUploading(false);
    }
  };

  // Iniciar verificação no Mercado Pago
  const startVerification = async () => {
    if (!receiptId || !editAmount || !editDate) {
      setErrorMsg("Valor e Data são campos obrigatórios para a verificação.");
      return;
    }

    setErrorMsg(null);
    setIsVerifying(true);
    setCurrentStepIndex(3); // Consultando Mercado Pago

    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiptId,
          amount: parseFloat(editAmount),
          currency: editCurrency,
          transactionDate: editDate,
          transactionTime: editTime || null,
          bankName: editBank || null,
          transactionReference: editRef || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao iniciar verificação.");
      }

      setJobId(data.jobId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Falha ao conectar com Mercado Pago.");
      setIsVerifying(false);
    }
  };

  const resetAll = () => {
    setFile(null);
    setPreviewUrl(null);
    setReceiptId(null);
    setExtractedData(null);
    setShowEditForm(false);
    setJobId(null);
    setIsVerifying(false);
    setResult(null);
    setErrorMsg(null);
    setDuplicateWarning(null);
    setCurrentStepIndex(0);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Título Principal */}
      <div className="text-center space-y-2">
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
          Verificar Pagamento
        </h1>
        <p className="text-slate-400 text-sm max-w-lg mx-auto">
          Envie o comprovante bancário argentino para identificação via OCR e conciliação direta no Mercado Pago.
        </p>
      </div>

      {/* Avisos de Erro / Duplicidade */}
      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-950/50 border border-rose-800/80 text-rose-300 text-sm flex items-start gap-3 shadow-lg">
          <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold block">Atenção:</span>
            {errorMsg}
          </div>
        </div>
      )}

      {duplicateWarning && (
        <div className="p-4 rounded-xl bg-amber-950/50 border border-amber-800/80 text-amber-300 text-sm flex items-start gap-3 shadow-lg">
          <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>{duplicateWarning}</div>
        </div>
      )}

      {/* 1. ÁREA DE UPLOAD CENTRAL */}
      {!file && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files?.[0]) {
              handleFileSelect(e.dataTransfer.files[0]);
            }
          }}
          className={`border-2 border-dashed rounded-3xl p-10 sm:p-14 text-center transition-all cursor-pointer relative overflow-hidden ${
            isDragging
              ? "border-sky-400 bg-sky-950/20 scale-[1.01]"
              : "border-slate-800 hover:border-slate-700 bg-slate-900/40 hover:bg-slate-900/70"
          }`}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.pdf"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.[0]) handleFileSelect(e.target.files[0]);
            }}
          />

          <div className="max-w-md mx-auto space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-400 mx-auto flex items-center justify-center shadow-lg shadow-sky-500/10">
              <Upload className="w-8 h-8" />
            </div>
            <div>
              <p className="text-lg font-semibold text-white">
                ARRASTE O COMPROVANTE AQUI
              </p>
              <p className="text-xs text-slate-400 mt-1">
                ou clique para selecionar do seu dispositivo
              </p>
            </div>
            <div className="pt-2">
              <span className="inline-block px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs font-medium text-slate-300 hover:bg-slate-750 transition-colors">
                [ SELECIONAR ARQUIVO ]
              </span>
            </div>
            <p className="text-xs text-slate-500 pt-2">
              Formatos aceitos: JPG, JPEG, PNG, WEBP, PDF (Até 10 MB)
            </p>
          </div>
        </div>
      )}

      {/* 2. PREVIEW & STATUS DO PROCESSAMENTO */}
      {file && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl backdrop-blur-md">
          {/* Cabeçalho do arquivo selecionado */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-sky-400">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white truncate max-w-xs sm:max-w-md">
                  {file.name}
                </p>
                <p className="text-xs text-slate-500">
                  {(file.size / (1024 * 1024)).toFixed(2)} MB • {file.type || "Arquivo"}
                </p>
              </div>
            </div>
            <button
              onClick={resetAll}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              Trocar arquivo
            </button>
          </div>

          {/* Preview visual se for imagem */}
          {previewUrl && (
            <div className="max-h-60 overflow-hidden rounded-xl border border-slate-800/80 bg-slate-950 flex items-center justify-center">
              <img
                src={previewUrl}
                alt="Preview do comprovante"
                className="max-h-60 object-contain"
              />
            </div>
          )}

          {/* Stepper Visual de 7 Etapas */}
          <div className="py-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Status da Verificação
              </span>
              <span className="text-xs font-medium text-sky-400">
                Etapa {currentStepIndex + 1} de {STEP_LABELS.length}
              </span>
            </div>

            {/* Linha de progresso */}
            <div className="grid grid-cols-7 gap-1 sm:gap-2">
              {STEP_LABELS.map((label, idx) => {
                const isCompleted = idx < currentStepIndex;
                const isCurrent = idx === currentStepIndex;

                return (
                  <div key={label} className="space-y-1.5">
                    <div
                      className={`h-2 rounded-full transition-all duration-300 ${
                        isCompleted
                          ? "bg-emerald-500"
                          : isCurrent
                          ? "bg-sky-500 animate-pulse"
                          : "bg-slate-800"
                      }`}
                    />
                    <p
                      className={`text-[10px] hidden sm:block truncate ${
                        isCurrent
                          ? "text-sky-400 font-semibold"
                          : isCompleted
                          ? "text-emerald-400"
                          : "text-slate-600"
                      }`}
                    >
                      {label}
                    </p>
                  </div>
                );
              })}
            </div>

            <p className="text-sm font-medium text-slate-300 mt-3 flex items-center gap-2">
              {isUploading || isVerifying ? (
                <>
                  <Loader2 className="w-4 h-4 text-sky-400 animate-spin" />
                  <span>{STEP_LABELS[currentStepIndex]}...</span>
                </>
              ) : result ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Análise concluída</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 text-sky-400" />
                  <span>Informações extraídas com sucesso</span>
                </>
              )}
            </p>
          </div>

          {/* 3. CONFERÊNCIA E CORREÇÃO DOS DADOS DO OCR */}
          {showEditForm && !result && (
            <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-6 space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-white">
                    Conferir dados do comprovante
                  </h3>
                  <p className="text-xs text-slate-400">
                    O OCR extraiu os campos abaixo. Você pode ajustar qualquer valor se necessário antes da verificação.
                  </p>
                </div>
                {extractedData?.confidence && (
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-800 text-sky-300 border border-slate-700">
                    Confiança OCR: {extractedData.confidence}%
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                {/* Valor */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1 flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5 text-sky-400" />
                    Valor:
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={editAmount}
                    onChange={(e) => setEditAmount(e.target.value)}
                    placeholder="19900.00"
                    className="w-full bg-slate-900 border border-slate-750 text-white rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-sky-500 focus:outline-none"
                  />
                </div>

                {/* Moeda */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">
                    Moeda:
                  </label>
                  <select
                    value={editCurrency}
                    onChange={(e) => setEditCurrency(e.target.value as "ARS" | "BRL" | "USD")}
                    className="w-full bg-slate-900 border border-slate-750 text-white rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-sky-500 focus:outline-none"
                  >
                    <option value="ARS">ARS (Pesos Argentinos)</option>
                    <option value="USD">USD (Dólares)</option>
                    <option value="BRL">BRL (Reais)</option>
                  </select>
                </div>

                {/* Data */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-sky-400" />
                    Data:
                  </label>
                  <input
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-750 text-white rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-sky-500 focus:outline-none"
                  />
                </div>

                {/* Hora */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-sky-400" />
                    Hora:
                  </label>
                  <input
                    type="text"
                    value={editTime}
                    onChange={(e) => setEditTime(e.target.value)}
                    placeholder="15:17:45"
                    className="w-full bg-slate-900 border border-slate-750 text-white rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-sky-500 focus:outline-none"
                  />
                </div>

                {/* Banco */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1 flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-sky-400" />
                    Banco:
                  </label>
                  <input
                    type="text"
                    value={editBank}
                    onChange={(e) => setEditBank(e.target.value)}
                    placeholder="Banco Nación / Cuenta DNI"
                    className="w-full bg-slate-900 border border-slate-750 text-white rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-sky-500 focus:outline-none"
                  />
                </div>

                {/* Referência */}
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1 flex items-center gap-1.5">
                    <Hash className="w-3.5 h-3.5 text-sky-400" />
                    Referência / N° Op:
                  </label>
                  <input
                    type="text"
                    value={editRef}
                    onChange={(e) => setEditRef(e.target.value)}
                    placeholder="Opcional"
                    className="w-full bg-slate-900 border border-slate-750 text-white rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-sky-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Botão de ação */}
              <div className="pt-2 flex justify-end">
                <button
                  onClick={startVerification}
                  disabled={isVerifying || !editAmount || !editDate}
                  className="w-full sm:w-auto px-6 py-3.5 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-semibold rounded-xl text-sm shadow-lg shadow-sky-500/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isVerifying ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Verificando no Mercado Pago...</span>
                    </>
                  ) : (
                    <>
                      <span>[ VERIFICAR NO MERCADO PAGO ]</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* 4. RESULTADOS DA VERIFICAÇÃO */}
          {result && (
            <div className="space-y-6 pt-2">
              {/* CASO VERIFIED (CARD VERDE) */}
              {result.status === "verified" && result.matchedTransaction && (
                <div className="bg-emerald-950/40 border-2 border-emerald-500/70 rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl relative overflow-hidden">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/30">
                      <CheckCircle2 className="w-8 h-8" />
                    </div>
                    <div>
                      <h2 className="text-xl sm:text-2xl font-bold text-emerald-300">
                        ✅ TRANSFERÊNCIA ENCONTRADA
                      </h2>
                      <p className="text-sm text-emerald-200/80 mt-0.5">
                        Foi encontrada uma transação correspondente no Mercado Pago.
                      </p>
                    </div>
                  </div>

                  {/* Dados Comparados em Grade */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-emerald-950/60 rounded-xl p-4 border border-emerald-900/50 text-sm">
                    <div>
                      <span className="text-xs text-emerald-400 font-semibold block">Valor</span>
                      <span className="text-base font-bold text-white">
                        {formatCurrencyDisplay(result.matchedTransaction.transaction_amount_display, result.matchedTransaction.transaction_currency)}
                      </span>
                    </div>

                    <div>
                      <span className="text-xs text-emerald-400 font-semibold block">Data</span>
                      <span className="text-base font-bold text-white">
                        {editDate}
                      </span>
                    </div>

                    <div>
                      <span className="text-xs text-emerald-400 font-semibold block">Comprovante</span>
                      <span className="text-base font-bold text-white">
                        {editTime || "Não inf."}
                      </span>
                    </div>

                    <div>
                      <span className="text-xs text-emerald-400 font-semibold block">Mercado Pago</span>
                      <span className="text-base font-bold text-white">
                        {new Date(result.matchedTransaction.transaction_date).toLocaleTimeString("pt-BR", { timeZone: "America/Argentina/Buenos_Aires" })}
                      </span>
                    </div>

                    <div>
                      <span className="text-xs text-emerald-400 font-semibold block">Diferença</span>
                      <span className="text-base font-bold text-emerald-300">
                        {result.timeDifferenceSeconds !== null ? `${result.timeDifferenceSeconds} segundos` : "N/D"}
                      </span>
                    </div>

                    <div>
                      <span className="text-xs text-emerald-400 font-semibold block">SOURCE_ID</span>
                      <span className="text-sm font-mono font-bold text-white">
                        {result.matchedTransaction.source_id}
                      </span>
                    </div>

                    <div>
                      <span className="text-xs text-emerald-400 font-semibold block">PAY_BANK_TRANSFER_ID</span>
                      <span className="text-sm font-mono font-bold text-white">
                        {result.matchedTransaction.pay_bank_transfer_id || "N/A"}
                      </span>
                    </div>

                    <div>
                      <span className="text-xs text-emerald-400 font-semibold block">Tipo</span>
                      <span className="text-sm font-bold text-white">
                        Transferência bancária / CVU
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-emerald-400/80 pt-2 border-t border-emerald-900/40">
                    <span>Score de Confiabilidade: {result.confidenceScore}%</span>
                    <span>Transação única confirmada</span>
                  </div>
                </div>
              )}

              {/* CASO AMBIGUOUS (CARD AMARELO) */}
              {result.status === "ambiguous" && (
                <div className="bg-amber-950/40 border-2 border-amber-500/70 rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 border border-amber-500/30">
                      <AlertTriangle className="w-8 h-8" />
                    </div>
                    <div>
                      <h2 className="text-xl sm:text-2xl font-bold text-amber-300">
                        ⚠️ MAIS DE UMA TRANSFERÊNCIA POSSÍVEL
                      </h2>
                      <p className="text-sm text-amber-200/80 mt-0.5">
                        Foram encontradas {result.candidateTransactions?.length || "múltiplas"} transferências com o mesmo valor próximas ao horário informado. Revise manualmente.
                      </p>
                    </div>
                  </div>

                  {/* Listagem das Candidatas */}
                  {result.candidateTransactions && (
                    <div className="space-y-3">
                      <h4 className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
                        Transferências Candidatas no Mercado Pago:
                      </h4>
                      {result.candidateTransactions.map((tx, i) => (
                        <div key={tx.source_id} className="bg-slate-900/90 border border-amber-900/40 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 text-sm">
                          <div>
                            <span className="text-xs text-slate-400 block">Opção #{i + 1} • SOURCE_ID</span>
                            <span className="font-mono font-bold text-white">{tx.source_id}</span>
                          </div>
                          <div>
                            <span className="text-xs text-slate-400 block">Horário MP</span>
                            <span className="font-bold text-white">
                              {new Date(tx.transaction_date).toLocaleTimeString("pt-BR", { timeZone: "America/Argentina/Buenos_Aires" })}
                            </span>
                          </div>
                          <div>
                            <span className="text-xs text-slate-400 block">Valor</span>
                            <span className="font-bold text-emerald-400">
                              {formatCurrencyDisplay(tx.transaction_amount_display, tx.transaction_currency)}
                            </span>
                          </div>
                          <div>
                            <span className="text-xs text-slate-400 block">Método</span>
                            <span className="text-slate-300 uppercase">{tx.payment_method}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* CASO MANUAL_REVIEW / DUPLICATE (CARD LARANJA) */}
              {result.status === "manual_review" && (
                <div className="bg-orange-950/40 border-2 border-orange-500/70 rounded-2xl p-6 sm:p-8 space-y-4 shadow-2xl">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-orange-500/20 text-orange-400 flex items-center justify-center shrink-0 border border-orange-500/30">
                      <AlertTriangle className="w-8 h-8" />
                    </div>
                    <div>
                      <h2 className="text-xl sm:text-2xl font-bold text-orange-300">
                        {result.matchReasons?.isDuplicateSourceId
                          ? "⚠️ TRANSAÇÃO JÁ UTILIZADA"
                          : "⚠️ REVISÃO MANUAL NECESSÁRIA"}
                      </h2>
                      <p className="text-sm text-orange-200/80 mt-0.5">
                        {result.matchReasons?.isDuplicateSourceId
                          ? "Esta movimentação já foi associada a outro comprovante anteriormente."
                          : "Os dados não puderam ser confirmados de forma unívoca automaticamente."}
                      </p>
                    </div>
                  </div>

                  {result.matchReasons?.notes && (
                    <div className="bg-orange-950/60 rounded-xl p-4 border border-orange-900/40 text-xs text-orange-200 space-y-1">
                      {result.matchReasons.notes.map((n, i) => (
                        <p key={i}>• {n}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* CASO NOT_FOUND (CARD VERMELHO) */}
              {result.status === "not_found" && (
                <div className="bg-rose-950/40 border-2 border-rose-500/70 rounded-2xl p-6 sm:p-8 space-y-4 shadow-2xl">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0 border border-rose-500/30">
                      <XCircle className="w-8 h-8" />
                    </div>
                    <div>
                      <h2 className="text-xl sm:text-2xl font-bold text-rose-300">
                        ❌ TRANSFERÊNCIA NÃO ENCONTRADA
                      </h2>
                      <p className="text-sm text-rose-200/80 mt-0.5">
                        Nenhuma entrada correspondente foi encontrada no Mercado Pago para os dados do comprovante.
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400">
                    Certifique-se de que a transferência realmente foi processada pelo banco e creditada na data informada.
                  </p>
                </div>
              )}

              {/* Botão de nova verificação */}
              <div className="flex justify-center pt-4">
                <button
                  onClick={resetAll}
                  className="px-6 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-sm border border-slate-700 transition-colors flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Verificar outro comprovante</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
