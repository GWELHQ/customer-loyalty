import { Injectable, Logger } from '@nestjs/common';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';

/**
 * Kenyan plate shape: 3 letters, 3 digits, 1 letter (e.g. "KAA 123B"). The
 * gap between the letter and digit groups varies by plate style — oblong
 * plates print it as a single space, square plates stack the groups on
 * separate lines (so Cloud Vision's OCR emits a newline, sometimes with
 * surrounding line-spacing whitespace). `\s*` covers both rather than
 * assuming a single separator character, and requiring one unbroken 5-8
 * char token (the original approach) can't match either style.
 */
const PLATE_TOKEN = /\b([A-Z]{3})[\s-]*([0-9]{3})[\s-]*([A-Z])\b/;

/**
 * Wraps Cloud Vision's OCR to pull a best-guess license plate out of a
 * photo. This is a heuristic, not a purpose-built ANPR model — good enough
 * for a first version given a mismatch only ever raises a fraud flag for
 * human review, it never blocks a sale.
 *
 * Uses `documentTextDetection` (dense/structured text) rather than
 * `textDetection` (sparse, arbitrary text-in-scene) — plates are small,
 * high-contrast, structured text blocks, and the document mode's layout
 * analysis handles the stacked two-line square-plate style noticeably
 * better than the general-purpose mode did.
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
      const [result] = await this.client.documentTextDetection(imageBuffer);
      const fullText = result.fullTextAnnotation?.text ?? '';
      if (!fullText) {
        this.logger.warn(
          `Vision returned zero text for a ${imageBuffer.length}-byte image (no API error) — ` +
            `possible causes: image genuinely has no legible text, or an upstream truncation/corruption ` +
            `before this call.`,
        );
        return null;
      }
      const normalized = fullText.toUpperCase().replace(/[^A-Z0-9\s]/g, ' ');
      const match = normalized.match(PLATE_TOKEN);
      if (!match) {
        this.logger.warn(`Vision detected text but no plate-shaped token matched. Raw text: ${JSON.stringify(fullText)}`);
      }
      return match ? `${match[1]}${match[2]}${match[3]}` : null;
    } catch (err) {
      this.logger.error(
        `Vision OCR call threw for a ${imageBuffer.length}-byte image: ${err instanceof Error ? err.stack ?? err.message : String(err)}`,
      );
      return null;
    }
  }
}
