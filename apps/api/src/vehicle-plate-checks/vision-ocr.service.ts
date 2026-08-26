import { Injectable, Logger } from '@nestjs/common';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';

/** A slot-by-slot shape: 'L' = letter, 'D' = digit. */
type PlateShape = ('L' | 'D')[];

/**
 * Kenyan plate shapes this app expects to see at a fuel station: the
 * standard 3-letter/3-digit/1-letter format used since 1989 (also covers
 * current-era plates and electric cars, e.g. "KAA 123B" / "EVA 001A"), and
 * the 4-letter electric-motorcycle format introduced 2024 ("EMAA 001A").
 * Deliberately excludes diplomatic/government/personalized formats — too
 * varied to pattern-match, and not a realistic customer segment for a
 * cashback loyalty program. Per Wikipedia's
 * "Vehicle registration plates of Kenya" (checked 2026-08-26).
 */
const PLATE_SHAPES: PlateShape[] = [
  ['L', 'L', 'L', 'D', 'D', 'D', 'L'],
  ['L', 'L', 'L', 'L', 'D', 'D', 'D', 'L'],
];

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
 * Coerces a candidate into the given plate shape by correcting characters
 * that landed in the "wrong" slot but are well-known OCR lookalikes (0/O,
 * 1/I, 5/S, 8/B, 2/Z) — e.g. Vision reading a plate's embossed zero as a
 * letter "O". Since the format at each position is fixed for a real
 * plate, a mismatched character there is virtually always a misread, not
 * a genuinely different value. Returns null if the length doesn't match
 * or a character can't be reconciled with its expected slot at all.
 */
function coerceToShape(candidate: string, shape: PlateShape): string | null {
  if (candidate.length !== shape.length) return null;
  const chars = candidate.split('');
  for (let i = 0; i < shape.length; i++) {
    const isLetter = /[A-Z]/.test(chars[i]!);
    if (shape[i] === 'L' && !isLetter) {
      const fixed = LETTER_LOOKALIKE[chars[i]!];
      if (!fixed) return null;
      chars[i] = fixed;
    } else if (shape[i] === 'D' && isLetter) {
      const fixed = DIGIT_LOOKALIKE[chars[i]!];
      if (!fixed) return null;
      chars[i] = fixed;
    }
  }
  return chars.join('');
}

/**
 * Pulls a plate out of a whitespace-split word list by trying every run of
 * up to 3 consecutive words concatenated together, against every known
 * plate shape. Kenyan plates are laid out as 1-3 separate OCR "words"
 * depending on spacing/line breaks (e.g. "KBW" + "878S", or "KBW" + "878"
 * + "S", or a single "KBW878S") — trying short consecutive runs handles
 * all of those without assuming a fixed separator, while still requiring
 * the groups to be adjacent words (so unrelated text elsewhere in the
 * photo, e.g. a serial number printed along the plate's edge, can't get
 * spliced into the middle of a match).
 */
function findPlateInWords(words: string[]): string | null {
  for (let i = 0; i < words.length; i++) {
    for (let span = 1; span <= 3 && i + span <= words.length; span++) {
      const combined = words.slice(i, i + span).join('');
      if (!/^[A-Z0-9]+$/.test(combined)) continue;
      for (const shape of PLATE_SHAPES) {
        const plate = coerceToShape(combined, shape);
        if (plate) return plate;
      }
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
