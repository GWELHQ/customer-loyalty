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
const ARTWORK_SRC = '/sticker-artwork.png';

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

/** Generates and downloads an 80mm x 80mm, ~300 DPI PNG windshield sticker for a customer, with their QR code embedded. */
export async function generateCustomerStickerPdf(customer: Customer): Promise<void> {
  const qrValue = `${window.location.origin}/qr/${customer.id}`;

  // Scales the Green Wells Sticker design's badge measurements (authored at
  // DESIGN_SIZE px) down to this sticker's print resolution.
  const scale = SIZE_PX / DESIGN_SIZE;
  const s = (value: number) => value * scale;
  const qrPanelSize = s(216);

  const [artwork, qrImage] = await Promise.all([
    loadImage(ARTWORK_SRC),
    loadQrImage(qrValue, qrPanelSize),
  ]);
  await document.fonts.load('800 40px "DM Sans"');

  const canvas = document.createElement('canvas');
  canvas.width = SIZE_PX;
  canvas.height = SIZE_PX;
  const ctx = canvas.getContext('2d')!;

  // Full-bleed fuel-sticker artwork, clipped to the sticker's rounded corners.
  ctx.save();
  roundedRectPath(ctx, 0, 0, SIZE_PX, SIZE_PX, mm(3.2));
  ctx.clip();
  ctx.drawImage(artwork, 0, 0, SIZE_PX, SIZE_PX);
  ctx.restore();

  // QR badge, bottom-right — mirrors the Green Wells Sticker design's badge:
  // white card, green border, drop shadow, QR over a "SCAN TO JOIN" label.
  const padX = s(20);
  const padTop = s(20);
  const padBottom = s(16);
  const gap = s(12);
  const labelHeight = s(26);
  const badgeWidth = qrPanelSize + padX * 2;
  const badgeHeight = padTop + qrPanelSize + gap + labelHeight + padBottom;
  const margin = s(40);
  const badgeX = SIZE_PX - margin - badgeWidth;
  const badgeY = SIZE_PX - margin - badgeHeight;
  const badgeRadius = s(22);

  ctx.save();
  ctx.shadowColor = 'rgba(0, 24, 58, 0.28)';
  ctx.shadowBlur = s(28);
  ctx.shadowOffsetY = s(10);
  roundedRectPath(ctx, badgeX, badgeY, badgeWidth, badgeHeight, badgeRadius);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();

  roundedRectPath(ctx, badgeX, badgeY, badgeWidth, badgeHeight, badgeRadius);
  ctx.lineWidth = s(3);
  ctx.strokeStyle = BADGE_BORDER;
  ctx.stroke();

  ctx.save();
  roundedRectPath(ctx, badgeX + padX, badgeY + padTop, qrPanelSize, qrPanelSize, s(8));
  ctx.clip();
  ctx.drawImage(qrImage, badgeX + padX, badgeY + padTop, qrPanelSize, qrPanelSize);
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.fillStyle = BADGE_LABEL_COLOR;
  ctx.font = `800 ${s(26)}px "DM Sans"`;
  ctx.letterSpacing = `${s(26) * 0.06}px`;
  ctx.fillText('SCAN TO JOIN', badgeX + badgeWidth / 2, badgeY + padTop + qrPanelSize + gap + labelHeight * 0.8);

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

/** Generates and downloads a single A4 PDF with every customer's QR code — 3x4 per page, name and phone underneath each. */
export async function exportCustomerQrCodesPdf(customers: Customer[]): Promise<void> {
  if (customers.length === 0) throw new Error('No customers to export');

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 12;
  const cols = 3;
  const rowsPerPage = 4;
  const perPage = cols * rowsPerPage;
  const cellW = (pageWidth - margin * 2) / cols;
  const cellH = (pageHeight - margin * 2) / rowsPerPage;
  const qrSize = Math.min(cellW, cellH) - 22;

  for (const [i, customer] of customers.entries()) {
    const posOnPage = i % perPage;
    if (i > 0 && posOnPage === 0) doc.addPage();
    const col = posOnPage % cols;
    const row = Math.floor(posOnPage / cols);

    const qrValue = `${window.location.origin}/qr/${customer.id}`;
    const dataUrl = await qrDataUrl(qrValue, 480, 16);

    const cellX = margin + col * cellW;
    const cellY = margin + row * cellH;
    const qrX = cellX + (cellW - qrSize) / 2;
    const qrY = cellY + 4;
    doc.addImage(dataUrl, 'PNG', qrX, qrY, qrSize, qrSize);

    doc.setFontSize(9);
    doc.setTextColor(20, 20, 20);
    doc.text(customer.fullName, cellX + cellW / 2, qrY + qrSize + 6, { align: 'center', maxWidth: cellW - 4 });
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(customer.phoneNumber, cellX + cellW / 2, qrY + qrSize + 11, { align: 'center' });
  }

  doc.save(`customer-qr-codes-${new Date().toISOString().slice(0, 10)}.pdf`);
}
