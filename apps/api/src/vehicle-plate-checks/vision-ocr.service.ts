import { Injectable, Logger } from '@nestjs/common';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';

/** A plate-shaped token: 5-8 uppercase letters/digits, mixing at least one of each (rules out e.g. a plain word). */
const PLATE_TOKEN = /\b(?=[A-Z0-9]{5,8}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*[0-9])[A-Z0-9]{5,8}\b/;

/**
 * Wraps Cloud Vision's generic OCR (`textDetection`) to pull a best-guess
 * license plate out of a photo. This is a heuristic, not a purpose-built
 * ANPR model — good enough for a first version given a mismatch only ever
 * raises a fraud flag for human review, it never blocks a sale.
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
      const normalized = fullText.toUpperCase().replace(/[^A-Z0-9\s]/g, ' ');
      const match = normalized.match(PLATE_TOKEN);
      return match?.[0] ?? null;
    } catch (err) {
      this.logger.warn(`Vision OCR failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }
}
