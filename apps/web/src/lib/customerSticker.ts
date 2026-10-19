import type { Customer } from '@loyalty/shared';
import { StreamingPdf, openPdfSink, pdfString } from './streamingPdf';

// 80mm x 80mm sticker rendered at the artwork's native 1254px (~398 DPI), so
// the artwork is drawn 1:1 with no resampling.
const SIZE_MM = 80;
const SIZE_PX = 1254;
const PX_PER_MM = SIZE_PX / SIZE_MM;

// Reference pixel size the Green Wells Sticker design was authored at — the
// badge's own px values (padding, radius, QR size, margins) scale off this.
const DESIGN_SIZE = 1254;
const BADGE_BORDER = '#0B5D2E';
const BADGE_LABEL_COLOR = '#003A88';
const ARTWORK_SRC = '/sticker-artwork-v3.png';

function mm(value: number): number {
  return value * PX_PER_MM;
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
  return img;
}

// Same styling as the on-screen QrCode component (apps/web/src/ui/QrCode.tsx)
// — literal hex, not var(--gw-green-*), for the same reason it's literal
// there: qr-code-styling paints via canvas/svg attributes that don't
// resolve CSS custom properties.
async function qrDataUrl(value: string, sizePx: number, margin = 24): Promise<string> {
  const { default: QRCodeStyling } = await import('qr-code-styling');
  const qrCode = new QRCodeStyling({
    width: sizePx,
    height: sizePx,
    data: value,
    margin,
    qrOptions: { errorCorrectionLevel: 'M' },
    dotsOptions: { type: 'dots', color: '#20713b' },
    cornersSquareOptions: { type: 'extra-rounded', color: '#20713b' },
    cornersDotOptions: { type: 'dot', color: '#278e4a' },
    backgroundOptions: { color: '#eafaf0' },
  });
  const blob = (await qrCode.getRawData('png')) as Blob;
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read QR code image'));
    reader.readAsDataURL(blob);
  });
}

async function loadQrImage(value: string, displaySizePx: number, scale = 1): Promise<HTMLImageElement> {
  // Rendered well above final display size for crisp downscaling.
  // At least 4x for crisp downscaling; at higher badge scales match it 1:1.
  // The quiet-zone margin (24px at 4x) scales with it so the QR looks the same.
  const factor = Math.max(4, scale);
  const dataUrl = await qrDataUrl(value, displaySizePx * factor, 6 * factor);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Could not load QR code image'));
    img.src = dataUrl;
  });
  return img;
}

// Scales the Green Wells Sticker design's badge measurements (authored at
// DESIGN_SIZE px) down to this sticker's print resolution.
const STICKER_SCALE = SIZE_PX / DESIGN_SIZE;
function s(value: number): number {
  return value * STICKER_SCALE;
}

// Canvas 2D shadows aren't clipped to the shape that casts them — rendering
// the badge on its own (see renderBadgeCanvas) needs this much extra canvas
// on every side, or the blurred edge gets cut off square.
const BADGE_SHADOW_PAD = Math.ceil(s(28) * 2 + s(10));

interface BadgeGeometry {
  qrPanelSize: number;
  padX: number;
  padTop: number;
  gap: number;
  labelHeight: number;
  badgeWidth: number;
  badgeHeight: number;
  /** Position within the full SIZE_PX sticker canvas (bottom-right corner). */
  badgeX: number;
  badgeY: number;
  badgeRadius: number;
}

function badgeGeometry(): BadgeGeometry {
  const qrPanelSize = s(216);
  const padX = s(20);
  const padTop = s(20);
  const padBottom = s(16);
  const gap = s(12);
  const margin = s(40);
  const labelHeight = s(26);
  const badgeWidth = qrPanelSize + padX * 2;
  const badgeHeight = padTop + qrPanelSize + gap + labelHeight + padBottom;
  return {
    qrPanelSize,
    padX,
    padTop,
    gap,
    labelHeight,
    badgeWidth,
    badgeHeight,
    badgeX: SIZE_PX - margin - badgeWidth,
    badgeY: SIZE_PX - margin - badgeHeight,
    badgeRadius: s(22),
  };
}

/**
 * Full-bleed fuel-sticker artwork clipped to the sticker's rounded corners —
 * identical for every customer, no QR involved. Filled white first (rather
 * than left transparent outside the clip) so this can be exported as JPEG
 * in the bulk PDF below — JPEG has no alpha channel, and would otherwise
 * flatten transparent corners to black instead of matching the page.
 */
function renderBackgroundCanvas(artwork: HTMLImageElement, scale = 1): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE_PX * scale;
  canvas.height = SIZE_PX * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SIZE_PX, SIZE_PX);
  roundedRectPath(ctx, 0, 0, SIZE_PX, SIZE_PX, mm(3.2));
  ctx.clip();
  ctx.drawImage(artwork, 0, 0, SIZE_PX, SIZE_PX);
  // Callers composite onto this canvas in raw pixels — drop the scale transform.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return canvas;
}

/**
 * Renders just one customer's QR badge (white card, green border, optional
 * drop shadow, QR over "SCAN TO JOIN") to its own small canvas, padded on
 * every side so a shadow isn't clipped. Kept separate from the background
 * because this is the only part of the sticker that differs per customer.
 *
 * The shadow is on by default; the bulk PDF embeds the badge losslessly with an
 * alpha mask, so it keeps the shadow too. `scale` supersamples the badge (the
 * PDFs use 8x so the QR and label stay crisp at print size). Returns the padding used so the
 * caller can position the badge correctly.
 */
async function renderBadgeCanvas(
  qrValue: string,
  geo: BadgeGeometry,
  includeShadow = true,
  scale = 1,
): Promise<{ canvas: HTMLCanvasElement; pad: number }> {
  const qrImage = await loadQrImage(qrValue, geo.qrPanelSize, scale);
  const pad = includeShadow ? BADGE_SHADOW_PAD : 0;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((geo.badgeWidth + pad * 2) * scale);
  canvas.height = Math.ceil((geo.badgeHeight + pad * 2) * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  const x = pad;
  const y = pad;

  ctx.save();
  if (includeShadow) {
    ctx.shadowColor = 'rgba(0, 24, 58, 0.28)';
    ctx.shadowBlur = s(28) * scale;
    ctx.shadowOffsetY = s(10) * scale;
  }
  roundedRectPath(ctx, x, y, geo.badgeWidth, geo.badgeHeight, geo.badgeRadius);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();

  roundedRectPath(ctx, x, y, geo.badgeWidth, geo.badgeHeight, geo.badgeRadius);
  ctx.lineWidth = s(3);
  ctx.strokeStyle = BADGE_BORDER;
  ctx.stroke();

  ctx.save();
  roundedRectPath(ctx, x + geo.padX, y + geo.padTop, geo.qrPanelSize, geo.qrPanelSize, s(8));
  ctx.clip();
  ctx.drawImage(qrImage, x + geo.padX, y + geo.padTop, geo.qrPanelSize, geo.qrPanelSize);
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.fillStyle = BADGE_LABEL_COLOR;
  ctx.font = `800 ${s(26)}px "DM Sans"`;
  ctx.letterSpacing = `${s(26) * 0.06}px`;
  ctx.fillText('SCAN TO JOIN', x + geo.badgeWidth / 2, y + geo.padTop + geo.qrPanelSize + geo.gap + geo.labelHeight * 0.8);

  return { canvas, pad };
}

async function downloadStickerPng(qrValue: string, fileName: string, scale: number): Promise<void> {
  const artwork = await loadImage(ARTWORK_SRC);
  await document.fonts.load('800 40px "DM Sans"');

  const geo = badgeGeometry();
  const canvas = renderBackgroundCanvas(artwork, scale);
  const { canvas: badge, pad } = await renderBadgeCanvas(qrValue, geo, true, scale);
  canvas.getContext('2d')!.drawImage(badge, (geo.badgeX - pad) * scale, (geo.badgeY - pad) * scale);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png', 1));
  if (!blob) throw new Error('Could not render the sticker image');

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Generates and downloads an 80mm x 80mm, ~400 DPI PNG windshield sticker for a customer, with their QR code embedded. */
export async function generateCustomerStickerPdf(customer: Customer): Promise<void> {
  await downloadStickerPng(`${window.location.origin}/qr/${customer.id}`, `${customer.fullName.replace(/\s+/g, '-')}-sticker.png`, 1);
}

// Same page /qr/** redirects to (firebase.json). Not an app URL, so the POS
// scanner never mistakes it for a customer — any phone just opens the site.
const GENERAL_QR_URL = 'https://greenwellsenergies.com/our-products-services/';

const PT_PER_MM = 72 / 25.4;
// Badge is rasterised at 8x the artwork's pixel density in the PDFs.
const BADGE_PDF_SCALE = 8;

// Helvetica and Arial share glyph metrics, so a canvas measurement in Arial
// gives the PDF's built-in Helvetica text width for centring.
let measureCtx: CanvasRenderingContext2D | null = null;
function helveticaWidthMm(text: string, sizePt: number): number {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  measureCtx.font = '1000px Arial, Helvetica, sans-serif';
  return ((measureCtx.measureText(text).width / 1000) * sizePt) / PT_PER_MM;
}

/**
 * Generates a single A4 PDF with every customer's full Green Wells sticker
 * (same artwork + QR badge as `generateCustomerStickerPdf`, one per customer)
 * — 2 per row x 3 per page at true 80mm print size, name and phone underneath
 * each so a sheet can be cut apart and handed out to the right person.
 *
 * Output is full quality: the artwork is embedded losslessly at its native
 * resolution, and because it is identical for every customer it is written
 * once and referenced from every page, while each badge (QR, shadow, label)
 * is its own lossless image. The PDF is streamed to disk object by object by
 * StreamingPdf rather than built in memory, so there is no size ceiling —
 * multi-GB exports work. Call from a click handler (the save dialog needs the
 * user gesture).
 */
export async function exportCustomerQrCodesPdf(customers: Customer[]): Promise<void> {
  if (customers.length === 0) throw new Error('No customers to export');

  const sink = await openPdfSink(`customer-stickers-${new Date().toISOString().slice(0, 10)}.pdf`);
  if (!sink) return; // user cancelled the save dialog

  const artwork = await loadImage(ARTWORK_SRC);
  await document.fonts.load('800 40px "DM Sans"');

  const pdf = new StreamingPdf(sink);
  await pdf.begin();

  const geo = badgeGeometry();
  const pad = BADGE_SHADOW_PAD;
  const px2mm = (px: number) => px / PX_PER_MM;

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 10;
  const cols = 2;
  const rowsPerPage = 3;
  const perPage = cols * rowsPerPage;
  const cellW = (pageWidth - margin * 2) / cols;
  const cellH = (pageHeight - margin * 2) / rowsPerPage;
  const stickerSize = SIZE_MM;
  const textBlockHeight = 9;

  const rootId = pdf.allocate();
  const pagesId = pdf.allocate();
  const fontId = pdf.allocate();
  const backgroundId = await pdf.imageFromCanvas(renderBackgroundCanvas(artwork));
  await pdf.object(fontId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  const pageIds: number[] = [];
  const n = (value: number) => value.toFixed(3);

  for (let start = 0; start < customers.length; start += perPage) {
    const pageCustomers = customers.slice(start, start + perPage);
    const xObjects: string[] = [`/Bg ${backgroundId} 0 R`];
    let content = '';

    for (const [posOnPage, customer] of pageCustomers.entries()) {
      const col = posOnPage % cols;
      const row = Math.floor(posOnPage / cols);
      const cellX = margin + col * cellW;
      const cellY = margin + row * cellH;
      const stickerX = cellX + (cellW - stickerSize) / 2;
      const stickerY = cellY + (cellH - stickerSize - textBlockHeight) / 2;

      // Placement helpers: top-left mm coordinates -> PDF points from the bottom-left.
      const place = (xMm: number, yMm: number, wMm: number, hMm: number) =>
        `${n(wMm * PT_PER_MM)} 0 0 ${n(hMm * PT_PER_MM)} ${n(xMm * PT_PER_MM)} ${n((pageHeight - yMm - hMm) * PT_PER_MM)} cm`;

      content += `q ${place(stickerX, stickerY, stickerSize, stickerSize)} /Bg Do Q
`;

      const { canvas: badge } = await renderBadgeCanvas(
        `${window.location.origin}/qr/${customer.id}`,
        geo,
        true,
        BADGE_PDF_SCALE,
      );
      const badgeId = await pdf.imageFromCanvas(badge);
      xObjects.push(`/B${posOnPage} ${badgeId} 0 R`);
      content += `q ${place(
        stickerX + px2mm(geo.badgeX - pad),
        stickerY + px2mm(geo.badgeY - pad),
        px2mm(geo.badgeWidth + pad * 2),
        px2mm(geo.badgeHeight + pad * 2),
      )} /B${posOnPage} Do Q
`;

      const centreX = cellX + cellW / 2;
      const text = (value: string, sizePt: number, gray: number, baselineMm: number) => {
        const x = centreX - helveticaWidthMm(value, sizePt) / 2;
        return `BT /F1 ${sizePt} Tf ${gray} g ${n(x * PT_PER_MM)} ${n((pageHeight - baselineMm) * PT_PER_MM)} Td ${pdfString(value)} Tj ET
`;
      };
      content += text(customer.fullName, 9, 0.08, stickerY + stickerSize + 5);
      content += text(customer.phoneNumber, 8, 0.47, stickerY + stickerSize + 9);
    }

    const contentId = pdf.allocate();
    const pageId = pdf.allocate();
    const bytes = new TextEncoder().encode(content);
    await pdf.streamObject(contentId, '', bytes);
    await pdf.object(
      pageId,
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n(pageWidth * PT_PER_MM)} ${n(pageHeight * PT_PER_MM)}] ` +
        `/Resources << /Font << /F1 ${fontId} 0 R >> /XObject << ${xObjects.join(' ')} >> >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  }

  await pdf.object(pagesId, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  await pdf.object(rootId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  await pdf.finish(rootId);
}

/**
 * Downloads a single-page, 80mm x 80mm PDF of the sticker with a general
 * (non-customer) QR code. Full quality like the bulk export: artwork embedded
 * losslessly at native resolution, badge rasterised at 8x. Call from a click
 * handler (the save dialog needs the user gesture).
 */
export async function generateGeneralStickerPdf(): Promise<void> {
  const sink = await openPdfSink('Green-Wells-general-sticker.pdf');
  if (!sink) return; // user cancelled the save dialog

  const artwork = await loadImage(ARTWORK_SRC);
  await document.fonts.load('800 40px "DM Sans"');

  const pdf = new StreamingPdf(sink);
  await pdf.begin();

  const geo = badgeGeometry();
  const pad = BADGE_SHADOW_PAD;
  const px2pt = (px: number) => (px / PX_PER_MM) * PT_PER_MM;
  const n = (value: number) => value.toFixed(3);
  const sizePt = SIZE_MM * PT_PER_MM;

  const rootId = pdf.allocate();
  const pagesId = pdf.allocate();
  const pageId = pdf.allocate();
  const contentId = pdf.allocate();
  const backgroundId = await pdf.imageFromCanvas(renderBackgroundCanvas(artwork));
  const { canvas: badge } = await renderBadgeCanvas(GENERAL_QR_URL, geo, true, BADGE_PDF_SCALE);
  const badgeId = await pdf.imageFromCanvas(badge);

  const badgeW = px2pt(geo.badgeWidth + pad * 2);
  const badgeH = px2pt(geo.badgeHeight + pad * 2);
  const badgeX = px2pt(geo.badgeX - pad);
  const badgeY = sizePt - px2pt(geo.badgeY - pad) - badgeH;
  const content =
    `q ${n(sizePt)} 0 0 ${n(sizePt)} 0 0 cm /Bg Do Q
` + `q ${n(badgeW)} 0 0 ${n(badgeH)} ${n(badgeX)} ${n(badgeY)} cm /B Do Q
`;

  await pdf.streamObject(contentId, '', new TextEncoder().encode(content));
  await pdf.object(
    pageId,
    `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n(sizePt)} ${n(sizePt)}] ` +
      `/Resources << /XObject << /Bg ${backgroundId} 0 R /B ${badgeId} 0 R >> >> /Contents ${contentId} 0 R >>`,
  );
  await pdf.object(pagesId, `<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`);
  await pdf.object(rootId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  await pdf.finish(rootId);
}
