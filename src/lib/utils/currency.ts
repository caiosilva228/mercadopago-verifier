/**
 * Utilitários para manuseio estrito de valores monetários
 * Previne erros de arredondamento de float convertendo para 'minor units' (centavos em BigInt)
 */

export function toMinorUnits(amount: number | string): bigint {
  const numStr = typeof amount === "number" ? amount.toFixed(2) : amount.trim();
  // Remove pontos de milhar se houver e normaliza vírgula para ponto
  const cleanStr = numStr.replace(/\s+/g, "").replace(/\./g, "").replace(",", ".");
  
  // Trata números decimais diretos ex: "19900.00"
  const parsed = Number(cleanStr);
  if (isNaN(parsed)) {
    throw new Error(`Valor monetário inválido: ${amount}`);
  }

  // Multiplicação por 100 com Math.round para evitar imprecisões binárias de float
  return BigInt(Math.round(parsed * 100));
}

export function fromMinorUnits(minorUnits: bigint | number): number {
  const val = typeof minorUnits === "bigint" ? Number(minorUnits) : minorUnits;
  return Number((val / 100).toFixed(2));
}

export function formatCurrencyDisplay(amount: number, currency: string = "ARS"): string {
  const symbol = currency === "USD" ? "US$" : currency === "BRL" ? "R$" : "$";
  const formatted = new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

  return `${symbol} ${formatted}`;
}

/**
 * Normaliza valores extraídos por OCR que podem ter formatos variados:
 * Ex: "19.900,00", "$ 19900", "19,900.00", "19900", "19.900"
 */
export function parseOcrAmount(rawAmountStr: string): number | null {
  if (!rawAmountStr) return null;

  // Remove caracteres que não sejam números, pontos ou vírgulas
  let cleaned = rawAmountStr.replace(/[^0-9.,]/g, "").trim();
  if (!cleaned) return null;

  // Se tiver tanto ponto quanto vírgula (ex: 19.900,00 ou 19,900.00)
  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");

  if (lastDot > -1 && lastComma > -1) {
    if (lastComma > lastDot) {
      // Formato argentino/brasileiro: 19.900,00 -> remove pontos, vírgula vira ponto
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      // Formato americano: 19,900.00 -> remove vírgulas
      cleaned = cleaned.replace(/,/g, "");
    }
  } else if (lastComma > -1) {
    // Apenas vírgula: se tiver 2 casas decimais no final, ex: "19900,00"
    const parts = cleaned.split(",");
    if (parts.length === 2 && parts[1].length <= 2) {
      cleaned = `${parts[0]}.${parts[1]}`;
    } else {
      // Vírgula como milhar
      cleaned = cleaned.replace(/,/g, "");
    }
  } else if (lastDot > -1) {
    // Apenas ponto: ex "19.900" (milhar na Argentina) ou "19.90" (decimal)
    const parts = cleaned.split(".");
    if (parts.length === 2 && parts[1].length === 3) {
      // 19.900 -> 19900
      cleaned = cleaned.replace(/\./g, "");
    } else if (parts.length > 2) {
      // 1.900.000 -> 1900000
      cleaned = cleaned.replace(/\./g, "");
    }
  }

  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}
