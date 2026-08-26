import { Injectable, Logger } from '@nestjs/common';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';

/** A slot-by-slot shape: 'L' = any letter (coercible), 'D' = any digit (coercible), or an exact required character. */
type Slot = 'L' | 'D' | { exact: string };
type PlateShape = Slot[];

/**
 * Plate shapes this app expects to see at a station near the Kenya/Uganda/
 * Tanzania border, including Kenyan government vehicle categories.
 * Deliberately excludes diplomatic and personalized formats from this
 * fixed-shape list — diplomatic plates are handled separately below
 * (genuinely variable-length, doesn't fit a fixed shape), and personalized
 * plates have no pattern at all.
 *
 * - Kenya standard, 1989-present (also covers current-era plates,
 *   electric cars — "EVA 001A" — and Government of Kenya vehicles, which
 *   are just a "GK" + department-letter 3-letter prefix like any other
 *   series, e.g. "GKA 227B" — plus Uganda's old pre-2023 format,
 *   "UAA 001A") — all the same 3-letter/3-digit/1-letter shape.
 * - Kenya electric motorcycles, 2024- ("EMAA 001A") — 4 letters.
 * - Kenya county government ("42CG 002A") — 2-digit county code, fixed
 *   "CG", 3 digits, 1 letter. "CG" must match exactly (not coercible)
 *   since it's a fixed category marker, not an arbitrary series code.
 * - Uganda's current digital plates (introduced Nov 2023): private
 *   ("UA 001AA", 2 letters/3 digits/2 letters) and motorcycle/trailer
 *   ("UMA 001AA" / "TUA 001AA", 3 letters/3 digits/2 letters).
 * - Tanzania mainland ("T 123ABC") and Zanzibar ("Z 123ABC") — a fixed
 *   country letter, then 3 digits, then 3 letters. The leading letter is
 *   required to match exactly (not coercible) since it's a single-char
 *   country code, not a multi-letter series code — treating it as a
 *   generic letter slot would make this shape match almost any random
 *   7-character run and swamp the more specific Kenya/Uganda shapes.
 *
 * Sources: Wikipedia's "Vehicle registration plates of Kenya"/"of Uganda"/
 * "of Tanzania", cross-checked against money254.co.ke, kenyans.co.ke,
 * biznakenya.com, and The Star for the GK/CG formats specifically (the
 * one NTSA public-notice PDF found was a dead link, but the independent
 * secondary sources agree with each other and with the user's own
 * examples), and a web search for Uganda's current digital format
 * (checked 2026-08-26).
 */
const PLATE_SHAPES: PlateShape[] = [
  ['L', 'L', 'L', 'D', 'D', 'D', 'L'],
  ['L', 'L', 'L', 'L', 'D', 'D', 'D', 'L'],
  ['D', 'D', { exact: 'C' }, { exact: 'G' }, 'D', 'D', 'D', 'L'],
  ['L', 'L', 'D', 'D', 'D', 'L', 'L'],
  ['L', 'L', 'L', 'D', 'D', 'D', 'L', 'L'],
  [{ exact: 'T' }, 'D', 'D', 'D', 'L', 'L', 'L'],
  [{ exact: 'Z' }, 'D', 'D', 'D', 'L', 'L', 'L'],
];

/**
 * Kenyan diplomatic plates ("25CD 090AK", "5CD 18K") don't fit a fixed
 * shape — the country-code digit run, sequence-number digit run, and
 * rank-letter suffix all vary in length across real examples. Matched
 * separately as two adjacent OCR words: a literal "<digits>CD" marker
 * (the "CD" is required exact — it's what makes this pattern distinctive
 * enough to not false-positive on unrelated digit/letter text) followed
 * by "<digits><1-2 letters>".
 */
const DIPLOMATIC_MARKER = /^([0-9]{1,3})CD$/;
const DIPLOMATIC_SEQUENCE = /^([0-9]{1,3})([A-Z]{1,2})$/;

function findDiplomaticPlate(words: string[]): string | null {
  for (let i = 0; i + 1 < words.length; i++) {
    if (!DIPLOMATIC_MARKER.test(words[i]!)) continue;
    if (!DIPLOMATIC_SEQUENCE.test(words[i + 1]!)) continue;
    return words[i]! + words[i + 1]!;
  }
  return null;
}

/**
 * Well-established OCR-confused pairs, keyed by which reading is "wrong"
 * for the slot in question. Deliberately excludes shakier pairs like G/6 —
 * tested against a real misread ("005" detected as "GO5") and it produced
 * a confident but *wrong* digit rather than a safe non-match, which is
 * worse than declining to guess.
 */
const DIGIT_LOOKALIKE: Record<string, string> = { O: '0', I: '1', L: '1', S: '5', B: '8', Z: '2' };
const LETTER_LOOKALIKE: Record<string, string> = { '0': 'O', '1': 'I', '5': 'S', '8': 'B', '2': 'Z' };

interface ShapeMatch {
  plate: string;
  /** How many characters had to be reinterpreted via a lookalike table to fit this shape. */
  corrections: number;
  /** How many OCR words were concatenated to build this candidate. */
  span: number;
}

/**
 * Coerces a candidate into the given plate shape by correcting characters
 * that landed in the "wrong" slot but are well-known OCR lookalikes (0/O,
 * 1/I, 5/S, 8/B, 2/Z) — e.g. Vision reading a plate's embossed zero as a
 * letter "O". Since the format at each position is fixed for a real
 * plate, a mismatched character there is virtually always a misread, not
 * a genuinely different value. Returns null if the length doesn't match
 * or a character can't be reconciled with its expected slot at all.
 * Tracks how many corrections it made — several plate categories share a
 * total length (e.g. county's 8 chars vs. the EV-motorcycle shape's 8
 * chars), and a shape that happens to accept a candidate only via
 * corrections shouldn't win over a different shape that accepts the same
 * candidate exactly as read.
 */
function coerceToShape(candidate: string, shape: PlateShape, span: number): ShapeMatch | null {
  if (candidate.length !== shape.length) return null;
  const chars = candidate.split('');
  let corrections = 0;
  for (let i = 0; i < shape.length; i++) {
    const slot = shape[i]!;
    if (typeof slot === 'object') {
      if (chars[i] !== slot.exact) return null;
      continue;
    }
    const isLetter = /[A-Z]/.test(chars[i]!);
    if (slot === 'L' && !isLetter) {
      const fixed = LETTER_LOOKALIKE[chars[i]!];
      if (!fixed) return null;
      chars[i] = fixed;
      corrections++;
    } else if (slot === 'D' && isLetter) {
      const fixed = DIGIT_LOOKALIKE[chars[i]!];
      if (!fixed) return null;
      chars[i] = fixed;
      corrections++;
    }
  }
  return { plate: chars.join(''), corrections, span };
}

/** True if `a` is a better match than `b`: fewer corrections wins; on a tie, fewer words wins. */
function isBetterMatch(a: ShapeMatch, b: ShapeMatch): boolean {
  if (a.corrections !== b.corrections) return a.corrections < b.corrections;
  return a.span < b.span;
}

/**
 * Pulls the best-fitting plate out of a whitespace-split word list by
 * trying every run of up to 3 consecutive words concatenated together
 * against every known plate shape, and keeping whichever match required
 * the fewest lookalike corrections — ties broken toward fewer words
 * combined, since a tighter grouping is less likely to have accidentally
 * swept in a stray character from unrelated nearby text (seen in
 * practice: a stray "C" picked up next to a plate produced an 8-char
 * "CKAY851Q" that fit the EV-motorcycle shape with zero corrections, an
 * equally "clean" match as the correct 7-char "KAY851Q" — span breaks
 * that tie correctly since the real plate needs fewer words). Kenyan
 * plates are laid out as 1-3 separate OCR "words" depending on
 * spacing/line breaks (e.g. "KBW" + "878S", or "KBW" + "878" + "S", or a
 * single "KBW878S") — trying short consecutive runs handles all of those
 * without assuming a fixed separator, while still requiring the groups
 * to be adjacent words (so unrelated text elsewhere in the photo can't
 * get spliced into the middle of a match).
 */
function findPlateInWords(words: string[]): ShapeMatch | null {
  let best: ShapeMatch | null = null;
  for (let i = 0; i < words.length; i++) {
    for (let span = 1; span <= 3 && i + span <= words.length; span++) {
      const combined = words.slice(i, i + span).join('');
      if (!/^[A-Z0-9]+$/.test(combined)) continue;
      for (const shape of PLATE_SHAPES) {
        const candidate = coerceToShape(combined, shape, span);
        if (candidate && (!best || isBetterMatch(candidate, best))) {
          best = candidate;
        }
      }
    }
  }
  return best;
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
      const shapeMatch = findPlateInWords(words);
      const diplomaticPlate = findDiplomaticPlate(words);
      // Diplomatic matches are an exact regex fit (no lookalike correction involved), so
      // they only lose to a shape match that was itself correction-free.
      const plate = shapeMatch && shapeMatch.corrections === 0 ? shapeMatch.plate : (diplomaticPlate ?? shapeMatch?.plate ?? null);
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
