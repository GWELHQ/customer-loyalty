import { Injectable, Logger } from '@nestjs/common';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';

/** A full Kenyan plate: 3 letters, 3 digits, 1 letter, e.g. "KBW878S". */
const FULL_PLATE = /^[A-Z]{3}[0-9]{3}[A-Z]$/;

/**
 * Pulls a plate out of a whitespace-split word list by trying every run of
 * up to 3 consecutive words concatenated together. Kenyan plates are laid
 * out as 1-3 separate OCR "words" depending on spacing/line breaks (e.g.
 * "KBW" + "878S", or "KBW" + "878" + "S", or a single "KBW878S") — trying
 * short consecutive runs handles all of those without assuming a fixed
 * separator, while still requiring the two groups to be adjacent words (so
 * unrelated text elsewhere in the photo, e.g. a serial number printed
 * along the plate's edge, can't get spliced into the middle of a match).
 */
function findPlateInWords(words: string[]): string | null {
  for (let i = 0; i < words.length; i++) {
    for (let span = 1; span <= 3 && i + span <= words.length; span++) {
      const combined = words.slice(i, i + span).join('');
      if (FULL_PLATE.test(combined)) return combined;
    }
  }
  return null;
}

/**
 * Wraps Cloud Vision's OCR to pull a best-guess license plate out of a
 * photo. This is a heuristic, not a purpose-built ANPR model — good enough
 * for a first version given a mismatch only ever raises a fraud flag for
 * human review, it never blocks a sale.
 *
 * Uses `textDetection` (general "read any text in a scene" mode), not
 * `documentTextDetection` (tuned for dense, flat, document-style print).
 * Tried the latter first on the assumption that a plate's two-line square
 * layout was closer to "structured document" than "signage" — wrong in
 * practice: on a real, sharply-lit plate, `documentTextDetection` ignored
 * the huge embossed plate characters entirely and only picked up
 * incidental fine print (e.g. the small printed NTSA serial number), while
 * `textDetection`'s sparse/signage-oriented mode reads the actual plate
 * text correctly.
 */
@Injectable()
export class VisionOcrService {
  private readonly logger = new Logger('VisionOcrService');
  private client!: ImageAnnotatorClient;

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    this.client = new ImageAnnotatorClient({ projectId: this.config.get('gcpProjectId') });
  }

  /** Returns the best-guess normalized plate text, or null if nothing plausible was found (including on API failure — never throws). */
  async detectLicensePlate(imageBuffer: Buffer): Promise<string | null> {
    try {
      const [result] = await this.client.textDetection(imageBuffer);
      const fullText = result.textAnnotations?.[0]?.description ?? '';
      if (!fullText) {
        this.logger.warn(
          `Vision returned zero text for a ${imageBuffer.length}-byte image (no API error) — ` +
            `possible causes: image genuinely has no legible text, or an upstream truncation/corruption ` +
            `before this call.`,
        );
        return null;
      }
      const words = fullText
        .toUpperCase()
        .replace(/[^A-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
      const plate = findPlateInWords(words);
      if (!plate) {
        this.logger.warn(`Vision detected text but no plate-shaped token matched. Raw text: ${JSON.stringify(fullText)}`);
      }
      return plate;
    } catch (err) {
      this.logger.error(
        `Vision OCR call threw for a ${imageBuffer.length}-byte image: ${err instanceof Error ? err.stack ?? err.message : String(err)}`,
      );
      return null;
    }
  }
}
