import type { Customer } from '@loyalty/shared';
import { jsPDF } from 'jspdf';

// 80mm x 80mm sticker at ~300 DPI print quality: 12px per mm -> 960x960px.
const SIZE_MM = 80;
const PX_PER_MM = 12;
const SIZE_PX = SIZE_MM * PX_PER_MM;
const GREEN = '#33ad5c';

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

/** Renders the app's green circular mark as a solid white silhouette, matching the source design's `filter:brightness(0) invert(1)` treatment. */
async function loadWhiteMark(): Promise<{ image: HTMLImageElement; aspectRatio: number }> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Could not load logo mark'));
    img.src = '/logo-mark.png';
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const whiteMark = new Image();
  await new Promise<void>((resolve, reject) => {
    whiteMark.onload = () => resolve();
    whiteMark.onerror = () => reject(new Error('Could not render white logo mark'));
    whiteMark.src = canvas.toDataURL('image/png');
  });
  return { image: whiteMark, aspectRatio: canvas.width / canvas.height };
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

async function loadQrImage(value: string): Promise<HTMLImageElement> {
  // Rendered well above final display size for crisp downscaling.
  const dataUrl = await qrDataUrl(value, mm(36.8) * 2);
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
  const [qrImage, mark] = await Promise.all([loadQrImage(qrValue), loadWhiteMark()]);
  await document.fonts.load('800 40px "DM Sans"');
  await document.fonts.load('700 40px "DM Sans"');

  const canvas = document.createElement('canvas');
  canvas.width = SIZE_PX;
  canvas.height = SIZE_PX;
  const ctx = canvas.getContext('2d')!;

  // Full-bleed green rounded card.
  roundedRectPath(ctx, 0, 0, SIZE_PX, SIZE_PX, mm(3.2));
  ctx.fillStyle = GREEN;
  ctx.fill();

  // Green Wells mark, centered horizontally near the top.
  const markHeight = mm(9.6); // 12mm x 0.8
  const markWidth = markHeight * mark.aspectRatio;
  ctx.drawImage(mark.image, (SIZE_PX - markWidth) / 2, mm(4.8), markWidth, markHeight);

  // Headline.
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 ${mm(5.3)}px "DM Sans"`;
  ctx.fillText('I fuel at', SIZE_PX / 2, mm(20));
  ctx.fillText('Green Wells Energies', SIZE_PX / 2, mm(25.5));

  // White rounded panel holding the QR code — sized to its content, same as
  // the design's flex layout: 2.4mm padding (3mm x 0.8) around the QR, a
  // 1.6mm gap (2mm x 0.8), then the label's own line height.
  const panelPadding = mm(2.4);
  const qrSize = mm(36.8); // 46mm x 0.8
  const qrToLabelGap = mm(1.6);
  const labelHeight = mm(4.5);
  const panelWidth = qrSize + panelPadding * 2;
  const panelHeight = panelPadding + qrSize + qrToLabelGap + labelHeight + panelPadding;
  const panelX = (SIZE_PX - panelWidth) / 2;
  const panelY = SIZE_PX - panelHeight - mm(3.2);
  roundedRectPath(ctx, panelX, panelY, panelWidth, panelHeight, mm(2.4));
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.drawImage(qrImage, panelX + panelPadding, panelY + panelPadding, qrSize, qrSize);

  ctx.fillStyle = GREEN;
  ctx.font = `700 ${mm(2.4)}px "DM Sans"`;
  ctx.letterSpacing = '1.4px';
  ctx.fillText('SCAN TO JOIN', SIZE_PX / 2, panelY + panelPadding + qrSize + qrToLabelGap + labelHeight / 2 + mm(1));

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
