import { DateTime } from "luxon";

export const ARGENTINA_TIMEZONE = "America/Argentina/Buenos_Aires";

/**
 * Converte uma data local no formato YYYY-MM-DD em Buenos Aires para o intervalo UTC correspondente.
 * Exemplo testado e comprovado no Mercado Pago Argentina:
 * Dia local: 2026-10-05 (GMT-03)
 * Início: 2026-10-05 00:00:00-03:00 -> 2026-10-05T03:00:00Z
 * Fim:    2026-10-05 23:59:59-03:00 -> 2026-10-06T02:59:59Z
 */
export function getArgentinaDayUtcRange(dateStr: string): {
  beginDate: string;
  endDate: string;
} {
  // Parse da data local no fuso de Buenos Aires
  const startOfDayLocal = DateTime.fromISO(dateStr, { zone: ARGENTINA_TIMEZONE }).startOf("day");
  if (!startOfDayLocal.isValid) {
    throw new Error(`Data inválida para cálculo de timezone: ${dateStr}`);
  }

  const endOfDayLocal = startOfDayLocal.endOf("day").set({ millisecond: 0 });

  // Converte para UTC formatado em ISO sem milissegundos
  const beginDateUtc = startOfDayLocal.toUTC().toISO({ suppressMilliseconds: true });
  const endDateUtc = endOfDayLocal.toUTC().toISO({ suppressMilliseconds: true });

  if (!beginDateUtc || !endDateUtc) {
    throw new Error(`Falha ao converter datas para UTC: ${dateStr}`);
  }

  return {
    beginDate: beginDateUtc,
    endDate: endDateUtc,
  };
}

/**
 * Combina uma data (YYYY-MM-DD) e um horário (HH:mm ou HH:mm:ss) no fuso de Buenos Aires
 * e retorna o DateTime no fuso UTC.
 */
export function parseArgentinaDateTimeToUtc(dateStr: string, timeStr?: string | null): DateTime {
  const fullStr = timeStr ? `${dateStr}T${timeStr}` : `${dateStr}T12:00:00`;
  const dt = DateTime.fromISO(fullStr, { zone: ARGENTINA_TIMEZONE });
  if (!dt.isValid) {
    throw new Error(`Data/Hora inválida: ${fullStr}`);
  }
  return dt.toUTC();
}

/**
 * Converte a string de TRANSACTION_DATE do relatório Mercado Pago
 * (ex: "2026-10-05 15:17:50" ou formato ISO) para DateTime UTC.
 * Como o relatório foi configurado com "display_timezone": "GMT-03", a data exibida está em GMT-03.
 */
export function parseMercadoPagoReportDate(dateStr: string): DateTime {
  const trimmed = dateStr.trim();
  // Se contiver espaço simples: "2026-10-05 15:17:50"
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    const isoLike = trimmed.replace(" ", "T");
    return DateTime.fromISO(isoLike, { zone: ARGENTINA_TIMEZONE }).toUTC();
  }

  // Tenta ISO padrão
  const parsed = DateTime.fromISO(trimmed);
  if (parsed.isValid) {
    return parsed.toUTC();
  }

  // Fallback SQL format
  const sqlParsed = DateTime.fromSQL(trimmed, { zone: ARGENTINA_TIMEZONE });
  if (sqlParsed.isValid) {
    return sqlParsed.toUTC();
  }

  throw new Error(`Formato de data do Mercado Pago irreconhecível: ${dateStr}`);
}

/**
 * Retorna a diferença absoluta em segundos entre dois horários
 */
export function getTimeDifferenceInSeconds(dtA: DateTime, dtB: DateTime): number {
  return Math.abs(Math.round(dtA.diff(dtB, "seconds").seconds));
}
