import type { Customer } from '@loyalty/shared';
import { jsPDF } from 'jspdf';

// 80mm x 80mm sticker at ~300 DPI print quality: 12px per mm -> 960x960px.
const SIZE_MM = 80;
const PX_PER_MM = 12;
const SIZE_PX = SIZE_MM * PX_PER_MM;

// Reference pixel size the Green Wells Sticker design was authored at — the
// badge's own px values (padding, radius, QR size, margins) scale off this.
const DESIGN_SIZE = 1254;
const BADGE_BORDER = '#0B5D2E';
const BADGE_LABEL_COLOR = '#003A88';
const ARTWORK_SRC = '/sticker-artwork-v2.png';

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

async function loadQrImage(value: string, displaySizePx: number): Promise<HTMLImageElement> {
  // Rendered well above final display size for crisp downscaling.
  const dataUrl = await qrDataUrl(value, displaySizePx * 4);
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
  const labelHeight = s(26);
  const badgeWidth = qrPanelSize + padX * 2;
  const badgeHeight = padTop + qrPanelSize + gap + labelHeight + padBottom;
  const margin = s(40);
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
function renderBackgroundCanvas(artwork: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE_PX;
  canvas.height = SIZE_PX;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SIZE_PX, SIZE_PX);
  roundedRectPath(ctx, 0, 0, SIZE_PX, SIZE_PX, mm(3.2));
  ctx.clip();
  ctx.drawImage(artwork, 0, 0, SIZE_PX, SIZE_PX);
  return canvas;
}

/**
 * Renders just one customer's QR badge (white card, green border, optional
 * drop shadow, QR over "SCAN TO JOIN") to its own small canvas, padded on
 * every side so a shadow isn't clipped. Kept separate from the background
 * because this is the only part of the sticker that differs per customer.
 *
 * `includeShadow` defaults on for the single-sticker PNG download. The bulk
 * PDF export passes false, which also drops the shadow's blur padding —
 * jsPDF fully decodes and re-compresses every embedded PNG itself (unlike
 * JPEG, which it passes through as-is), so both the shadow's soft alpha
 * gradient and the extra padding pixels it required were measured
 * contributors to a 599-customer export blowing past a V8 "Invalid string
 * length": a flat card at native size compresses far better under jsPDF's
 * own re-encoding, and is barely noticeable on a sheet meant to be cut
 * apart anyway. Returns the actual padding used so the caller can position
 * the (now smaller, unpadded) badge correctly.
 */
async function renderBadgeCanvas(
  qrValue: string,
  geo: BadgeGeometry,
  includeShadow = true,
): Promise<{ canvas: HTMLCanvasElement; pad: number }> {
  const qrImage = await loadQrImage(qrValue, geo.qrPanelSize);
  const pad = includeShadow ? BADGE_SHADOW_PAD : 0;

  const canvas = document.createElement('canvas');
  canvas.width = geo.badgeWidth + pad * 2;
  canvas.height = geo.badgeHeight + pad * 2;
  const ctx = canvas.getContext('2d')!;
  const x = pad;
  const y = pad;

  ctx.save();
  if (includeShadow) {
    ctx.shadowColor = 'rgba(0, 24, 58, 0.28)';
    ctx.shadowBlur = s(28);
    ctx.shadowOffsetY = s(10);
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

/** Generates and downloads an 80mm x 80mm, ~300 DPI PNG windshield sticker for a customer, with their QR code embedded. */
export async function generateCustomerStickerPdf(customer: Customer): Promise<void> {
  const artwork = await loadImage(ARTWORK_SRC);
  await document.fonts.load('800 40px "DM Sans"');

  const geo = badgeGeometry();
  const canvas = renderBackgroundCanvas(artwork);
  const { canvas: badge, pad } = await renderBadgeCanvas(`${window.location.origin}/qr/${customer.id}`, geo);
  canvas.getContext('2d')!.drawImage(badge, geo.badgeX - pad, geo.badgeY - pad);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png', 1));
  if (!blob) throw new Error('Could not render the sticker image');

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${customer.fullName.replace(/\s+/g, '-')}-sticker.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Generates and downloads a single A4 PDF with every customer's full Green
 * Wells sticker (same artwork + QR badge as `generateCustomerStickerPdf`,
 * one per customer) — 2 per row x 3 per page at true 80mm print size, name
 * and phone underneath each so a sheet can be cut apart and handed out to
 * the right person.
 *
 * The background artwork is byte-identical for every customer — only the
 * QR badge differs — so it's re-embedded per placement as a compressed
 * JPEG rather than a lossless PNG (jsPDF's addImage `alias` looks like it
 * should de-duplicate identical repeated images, but empirically doesn't:
 * a naive per-customer PNG embed of this same photographic artwork blew up
 * to multiple GB and hit a V8 "Invalid string length" past a few hundred
 * customers). The QR itself lives only in the separate lossless badge PNG
 * below, so this JPEG's lossy compression never touches anything that
 * needs to stay scannable. The badge is rendered without its shadow (see
 * renderBadgeCanvas) since jsPDF fully re-compresses every embedded PNG
 * itself, and that gradient was a large, avoidable contributor to the size
 * blowup above.
 */
export async function exportCustomerQrCodesPdf(customers: Customer[]): Promise<void> {
  if (customers.length === 0) throw new Error('No customers to export');

  const artwork = await loadImage(ARTWORK_SRC);
  await document.fonts.load('800 40px "DM Sans"');

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const geo = badgeGeometry();
  const backgroundDataUrl = renderBackgroundCanvas(artwork).toDataURL('image/jpeg', 0.85);
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

  for (const [i, customer] of customers.entries()) {
    const posOnPage = i % perPage;
    if (i > 0 && posOnPage === 0) doc.addPage();
    const col = posOnPage % cols;
    const row = Math.floor(posOnPage / cols);

    const cellX = margin + col * cellW;
    const cellY = margin + row * cellH;
    const stickerX = cellX + (cellW - stickerSize) / 2;
    const stickerY = cellY + (cellH - stickerSize - textBlockHeight) / 2;
    doc.addImage(backgroundDataUrl, 'JPEG', stickerX, stickerY, stickerSize, stickerSize, 'sticker-artwork-bg');

    const { canvas: badge, pad } = await renderBadgeCanvas(`${window.location.origin}/qr/${customer.id}`, geo, false);
    const badgeDataUrl = badge.toDataURL('image/png', 1);
    const badgeX = stickerX + px2mm(geo.badgeX - pad);
    const badgeY = stickerY + px2mm(geo.badgeY - pad);
    const badgeSize = px2mm(geo.badgeWidth + pad * 2);
    const badgeSizeH = px2mm(geo.badgeHeight + pad * 2);
    doc.addImage(badgeDataUrl, 'PNG', badgeX, badgeY, badgeSize, badgeSizeH);

    doc.setFontSize(9);
    doc.setTextColor(20, 20, 20);
    doc.text(customer.fullName, cellX + cellW / 2, stickerY + stickerSize + 5, { align: 'center', maxWidth: cellW - 4 });
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(customer.phoneNumber, cellX + cellW / 2, stickerY + stickerSize + 9, { align: 'center' });
  }

  doc.save(`customer-stickers-${new Date().toISOString().slice(0, 10)}.pdf`);
}
