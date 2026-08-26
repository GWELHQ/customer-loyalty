import { Injectable, Logger } from '@nestjs/common';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';

/** A candidate 7-character run shaped like a Kenyan plate: letter, digit, or ambiguous in each slot. */
const PLATE_SHAPE = /^[A-Z0-9]{7}$/;

/**
 * Well-established OCR-confused pairs, keyed by which reading is "wrong"
 * for the slot in question. Deliberately excludes shakier pairs like G/6 —
 * tested against a real misread ("005" detected as "GO5") and it produced
 * a confident but *wrong* digit rather than a safe non-match, which is
 * worse than declining to guess.
 */
const DIGIT_LOOKALIKE: Record<string, string> = { O: '0', I: '1', L: '1', S: '5', B: '8', Z: '2' };
const LETTER_LOOKALIKE: Record<string, string> = { '0': 'O', '1': 'I', '5': 'S', '8': 'B', '2': 'Z' };

/**
 * Coerces a 7-character candidate into the fixed Kenyan plate shape (3
 * letters, 3 digits, 1 letter) by correcting characters that landed in the
 * "wrong" slot but are well-known OCR lookalikes (0/O, 1/I, 5/S, 8/B, 2/Z,
 * 6/G) — e.g. Vision reading a plate's embossed zero as a letter "O" or
 * "G". Since the format at each position is fixed for a real plate, a
 * mismatched character there is virtually always a misread, not a
 * genuinely different value. Returns null if a character can't be
 * reconciled with its expected slot at all.
 */
function coerceToPlateShape(candidate: string): string | null {
  const letterSlots = [0, 1, 2, 6];
  const digitSlots = [3, 4, 5];
  const chars = candidate.split('');
  for (const i of letterSlots) {
    if (!/[A-Z]/.test(chars[i]!)) {
      const fixed = LETTER_LOOKALIKE[chars[i]!];
      if (!fixed) return null;
      chars[i] = fixed;
    }
  }
  for (const i of digitSlots) {
    if (!/[0-9]/.test(chars[i]!)) {
      const fixed = DIGIT_LOOKALIKE[chars[i]!];
      if (!fixed) return null;
      chars[i] = fixed;
    }
  }
  return chars.join('');
}

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
      if (!PLATE_SHAPE.test(combined)) continue;
      const plate = coerceToPlateShape(combined);
      if (plate) return plate;
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
