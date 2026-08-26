/**
 * Table-based, inline-styled HTML email wrapper matching the web app's
 * design tokens (apps/web/src/styles/tokens.css) — email clients don't
 * load external stylesheets, so everything here is inlined by hand rather
 * than referencing the app's CSS.
 */

const LOGO_URL = 'https://loyalty-points-413d5.web.app/logo-mark.png';
const COLOR_SECONDARY = '#003a88';
const COLOR_PRIMARY = '#33ad5c';
const COLOR_TEXT = '#161c1d';
const COLOR_TEXT_SECONDARY = '#525f61';
const COLOR_BORDER = '#dbe0e1';
const COLOR_BG = '#f6f8f7';
const COLOR_SURFACE = '#ffffff';
const FONT_STACK = "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export interface RenderEmailOptions {
  title: string;
  bodyLines: string[];
  ctaLabel?: string;
  ctaHref?: string;
}

export function renderEmailHtml({ title, bodyLines, ctaLabel, ctaHref }: RenderEmailOptions): string {
  const paragraphs = bodyLines
    .map(
      (line) =>
        `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:${COLOR_TEXT_SECONDARY};">${escapeHtml(line)}</p>`,
    )
    .join('');

  const cta =
    ctaLabel && ctaHref
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px;">
          <tr>
            <td style="border-radius:8px;background:${COLOR_PRIMARY};">
              <a href="${escapeAttr(ctaHref)}" style="display:inline-block;padding:11px 22px;font-size:13.5px;font-weight:700;color:#ffffff;text-decoration:none;font-family:${FONT_STACK};">
                ${escapeHtml(ctaLabel)}
              </a>
            </td>
          </tr>
        </table>`
      : '';

  return `<!doctype html>
<html>
  <head>
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
  </head>
  <body style="margin:0;padding:0;background:${COLOR_BG};font-family:${FONT_STACK};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR_BG};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:${COLOR_SURFACE};border-radius:12px;overflow:hidden;border:1px solid ${COLOR_BORDER};">
            <tr>
              <td style="background:${COLOR_SECONDARY};padding:18px 24px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding-right:10px;"><img src="${LOGO_URL}" alt="Green Wells" width="26" height="26" style="display:block;" /></td>
                    <td style="font-family:${FONT_STACK};font-weight:800;font-size:14px;letter-spacing:0.03em;color:#ffffff;">GREEN WELLS</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="background:${COLOR_SURFACE};padding:28px 24px;">
                <h1 style="margin:0 0 16px;font-family:${FONT_STACK};font-weight:800;font-size:19px;color:${COLOR_TEXT};">${escapeHtml(title)}</h1>
                ${paragraphs}
                ${cta}
              </td>
            </tr>
            <tr>
              <td style="background:${COLOR_SURFACE};padding:16px 24px;border-top:1px solid ${COLOR_BORDER};font-size:11.5px;color:${COLOR_TEXT_SECONDARY};">
                Green Wells Loyalty Cashback — automated notification, no reply needed.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

/** KES amount to 2dp with thousands separators, e.g. "KES 213.70". */
export function formatEmailCurrency(amount: number): string {
  return `KES ${amount.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const ORDINAL_SUFFIXES: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' };

/** "DD^th MMM YYYY" in Africa/Nairobi, e.g. "25th Aug 2026". */
export function formatEmailDate(iso: string): string {
  const nairobiMs = new Date(iso).getTime() + 3 * 60 * 60 * 1000;
  const d = new Date(nairobiMs);
  const day = d.getUTCDate();
  const suffix = day >= 11 && day <= 13 ? 'th' : (ORDINAL_SUFFIXES[day % 10] ?? 'th');
  const month = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${day}${suffix} ${month} ${d.getUTCFullYear()}`;
}

/** Title Case for email subjects — capitalizes every word except a short list of minor words (unless it's the first word). */
const SUBJECT_MINOR_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'at', 'is']);

export function titleCaseSubject(subject: string): string {
  const words = subject.split(' ');
  return words
    .map((word, i) => {
      if (word.length === 0) return word;
      // Leave acronyms, KSh-style/currency codes, and embedded punctuation
      // like "PMS/AGO" or "213.70" alone — only re-case plain lowercase words.
      if (/[A-Z]/.test(word) || /\d/.test(word)) return word;
      const lower = word.toLowerCase();
      if (i !== 0 && SUBJECT_MINOR_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}
