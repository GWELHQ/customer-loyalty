import type { Customer } from '@loyalty/shared';
import { jsPDF } from 'jspdf';
import dmSansBoldUrl from '../assets/fonts/DMSans-Bold.ttf?url';
import dmSansExtraBoldUrl from '../assets/fonts/DMSans-ExtraBold.ttf?url';

// 80mm x 80mm sticker, scaled 0.8x from the 100mm source design (see the
// "Windshield Sticker" design project) so every measurement below is that
// design's mm value x 0.8.
const SIZE_MM = 80;
const GREEN = '#33ad5c';

// Fonts are embedded per-document (addFileToVFS/addFont write into the jsPDF
// instance itself) — caching the base64 payload is enough, but registration
// must run again for every new jsPDF() instance, never gated by a
// module-level "already done" flag.
let fontPayloadCache: Promise<{ bold: string; extraBold: string }> | null = null;

async function registerFonts(doc: jsPDF): Promise<void> {
  fontPayloadCache ??= Promise.all([fetchAsBase64(dmSansBoldUrl), fetchAsBase64(dmSansExtraBoldUrl)]).then(
    ([bold, extraBold]) => ({ bold, extraBold }),
  );
  const { bold, extraBold } = await fontPayloadCache;
  doc.addFileToVFS('DMSans-Bold.ttf', bold);
  doc.addFont('DMSans-Bold.ttf', 'DMSans', 'bold');
  doc.addFileToVFS('DMSans-ExtraBold.ttf', extraBold);
  doc.addFont('DMSans-ExtraBold.ttf', 'DMSans', 'extrabold');
}

async function fetchAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Renders the app's green circular mark as a solid white silhouette, matching the design's `filter:brightness(0) invert(1)` treatment. */
async function loadWhiteMark(): Promise<{ dataUrl: string; aspectRatio: number }> {
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
  return { dataUrl: canvas.toDataURL('image/png'), aspectRatio: canvas.width / canvas.height };
}

async function loadQrDataUrl(value: string): Promise<string> {
  const { default: QRCodeStyling } = await import('qr-code-styling');
  // Same styling as the on-screen QrCode component (apps/web/src/ui/QrCode.tsx)
  // — literal hex, not var(--gw-green-*), for the same reason it's literal
  // there: qr-code-styling paints via canvas/svg attributes that don't
  // resolve CSS custom properties.
  const qrCode = new QRCodeStyling({
    width: 600,
    height: 600,
    data: value,
    margin: 24,
    qrOptions: { errorCorrectionLevel: 'M' },
    dotsOptions: { type: 'dots', color: '#20713b' },
    cornersSquareOptions: { type: 'extra-rounded', color: '#20713b' },
    cornersDotOptions: { type: 'dot', color: '#278e4a' },
    backgroundOptions: { color: '#eafaf0' },
  });
  const blob = (await qrCode.getRawData('png')) as Blob;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read QR code image'));
    reader.readAsDataURL(blob);
  });
}

/** Generates and downloads an 80mm x 80mm PDF windshield sticker for a customer, with their QR code embedded. */
export async function generateCustomerStickerPdf(customer: Customer): Promise<void> {
  const qrValue = `${window.location.origin}/qr/${customer.id}`;
  const [qrDataUrl, mark] = await Promise.all([loadQrDataUrl(qrValue), loadWhiteMark()]);

  const doc = new jsPDF({ unit: 'mm', format: [SIZE_MM, SIZE_MM] });
  await registerFonts(doc);

  // Full-bleed green rounded card.
  doc.setFillColor(GREEN);
  doc.roundedRect(0, 0, SIZE_MM, SIZE_MM, 3.2, 3.2, 'F');

  // Green Wells mark, centered horizontally near the top.
  const markHeight = 9.6; // 12mm x 0.8
  const markWidth = markHeight * mark.aspectRatio;
  doc.addImage(mark.dataUrl, 'PNG', (SIZE_MM - markWidth) / 2, 4.8, markWidth, markHeight);

  // Headline.
  doc.setFont('DMSans', 'extrabold');
  doc.setFontSize(15);
  doc.setTextColor('#ffffff');
  doc.text('I fuel at', SIZE_MM / 2, 20, { align: 'center' });
  doc.text('Green Wells Energies', SIZE_MM / 2, 25.5, { align: 'center' });

  // White rounded panel holding the QR code — sized to its content, same as
  // the design's flex layout: 2.4mm padding (3mm x 0.8) around the QR, a
  // 1.6mm gap (2mm x 0.8), then the label's own line height.
  const panelPadding = 2.4;
  const qrSize = 36.8; // 46mm x 0.8
  const qrToLabelGap = 1.6;
  const labelFontSize = 6.8; // pt, ~= 2.8mm x 0.8 design mm converted to pt
  const labelHeight = 4.5;
  const panelWidth = qrSize + panelPadding * 2;
  const panelHeight = panelPadding + qrSize + qrToLabelGap + labelHeight + panelPadding;
  const panelX = (SIZE_MM - panelWidth) / 2;
  const panelY = SIZE_MM - panelHeight - 3.2;
  doc.setFillColor('#ffffff');
  doc.roundedRect(panelX, panelY, panelWidth, panelHeight, 2.4, 2.4, 'F');

  doc.addImage(qrDataUrl, 'PNG', panelX + panelPadding, panelY + panelPadding, qrSize, qrSize);

  doc.setFont('DMSans', 'bold');
  doc.setFontSize(labelFontSize);
  doc.setTextColor(GREEN);
  doc.text('SCAN TO JOIN', SIZE_MM / 2, panelY + panelPadding + qrSize + qrToLabelGap + labelHeight / 2 + 1, {
    align: 'center',
    charSpace: 0.4,
  });

  doc.save(`${customer.fullName.replace(/\s+/g, '-')}-sticker.pdf`);
}
