import sharp from "sharp";
import { logger } from "@/lib/utils/logger";

/**
 * Preprocessa um buffer de imagem antes do OCR para maximizar o reconhecimento de texto
 * - Converte para escala de cinza
 * - Aplica auto-orientação (rotação EXIF)
 * - Aumenta resolução/dpi para textos pequenos
 * - Aplica ajuste de contraste / normalização
 */
export async function preprocessImageForOcr(inputBuffer: Buffer): Promise<Buffer> {
  try {
    const image = sharp(inputBuffer);
    const metadata = await image.metadata();

    let pipeline = image.rotate(); // auto-rotate baseado no EXIF

    // Se imagem for muito pequena, faz upscale 2x para ajudar no OCR de caracteres pequenos
    if (metadata.width && metadata.width < 1500) {
      pipeline = pipeline.resize({
        width: Math.min(2500, metadata.width * 2),
        withoutEnlargement: false,
      });
    }

    // Grayscale e normalização de níveis de cinza
    const processed = await pipeline
      .grayscale()
      .normalize()
      .sharpen()
      .png()
      .toBuffer();

    return processed;
  } catch (error) {
    logger.warn("Falha no preprocessamento avançado da imagem, utilizando buffer original", {
      error: error instanceof Error ? error.message : String(error),
    });
    return inputBuffer;
  }
}
