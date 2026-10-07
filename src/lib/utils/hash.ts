import crypto from "crypto";

export function computeSha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function sanitizeFilename(filename: string): string {
  // Remove caracteres perigosos, path traversal, e limita tamanho
  const basename = filename.split(/[/\\]/).pop() || "receipt";
  const cleaned = basename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned.substring(0, 100);
}
