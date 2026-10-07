/**
 * Logger estruturado JSON com sanitização automática de secrets
 * NUNCA expõe tokens, bearer auth, chaves de API nem senhas
 */

const SENSITIVE_PATTERNS = [
  /Bearer\s+[a-zA-Z0-9_\-\.]+/gi,
  /APP_USR-[a-zA-Z0-9_\-]+/gi,
  /eyJh[a-zA-Z0-9_\-\.]+/gi, // JWT tokens
  /sb_publishable_[a-zA-Z0-9_\-]+/gi,
  /"(?:access_token|token|password|secret|authorization)":\s*"[^"]+"/gi,
];

export function maskSecrets(input: unknown): unknown {
  if (typeof input === "string") {
    let sanitized = input;
    for (const pattern of SENSITIVE_PATTERNS) {
      sanitized = sanitized.replace(pattern, "[REDACTED_SECRET]");
    }
    return sanitized;
  }

  if (Array.isArray(input)) {
    return input.map(maskSecrets);
  }

  if (input !== null && typeof input === "object") {
    const copy: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes("token") ||
        lowerKey.includes("secret") ||
        lowerKey.includes("password") ||
        lowerKey.includes("authorization") ||
        lowerKey.includes("apikey") ||
        lowerKey.includes("access_token")
      ) {
        copy[key] = "[REDACTED_SECRET]";
      } else {
        copy[key] = maskSecrets(value);
      }
    }
    return copy;
  }

  return input;
}

export const logger = {
  info(event: string, meta: Record<string, unknown> = {}) {
    const payload = {
      level: "info",
      timestamp: new Date().toISOString(),
      event,
      ...maskSecrets(meta) as Record<string, unknown>,
    };
    console.log(JSON.stringify(payload));
  },

  warn(event: string, meta: Record<string, unknown> = {}) {
    const payload = {
      level: "warn",
      timestamp: new Date().toISOString(),
      event,
      ...maskSecrets(meta) as Record<string, unknown>,
    };
    console.warn(JSON.stringify(payload));
  },

  error(event: string, error?: unknown, meta: Record<string, unknown> = {}) {
    const errMessage = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;
    const payload = {
      level: "error",
      timestamp: new Date().toISOString(),
      event,
      error: maskSecrets(errMessage),
      stack: errStack ? maskSecrets(errStack) : undefined,
      ...maskSecrets(meta) as Record<string, unknown>,
    };
    console.error(JSON.stringify(payload));
  },
};
