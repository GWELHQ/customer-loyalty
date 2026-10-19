// Minimal streaming PDF writer for the bulk customer-sticker export.
//
// jsPDF assembles the whole document as a single JS string, which V8 caps at
// ~512 MB — that's what capped the old export at a few hundred customers.
// This writer instead emits each object the moment it's ready, straight to a
// sink (a file on disk where the browser supports it), so the document size
// is limited only by disk space: the cross-reference is a binary xref stream
// with 8-byte offsets, so there's no 10 GB ceiling from classic xref entries
// either. Memory use stays at roughly one page's worth of data.
//
// Images are embedded losslessly (Flate-compressed raw RGB, with a separate
// alpha SMask only when a canvas actually has transparency), and a shared
// image can be drawn on any number of pages by referencing its object id.

export interface PdfSink {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

const encoder = new TextEncoder();

/** PDF literal-string bytes in WinAnsi (Latin-1 subset); other characters become '?'. */
export function pdfString(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    const c = code > 255 ? '?' : ch;
    out += c === '\\' || c === '(' || c === ')' ? `\\${c}` : c;
  }
  return `(${out})`;
}

function latin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class StreamingPdf {
  private pos = 0;
  private readonly offsets: number[] = [];
  private nextObjectId = 1;

  constructor(private readonly sink: PdfSink) {}

  /** Reserves an object id so other objects can reference it before it is written. */
  allocate(): number {
    return this.nextObjectId++;
  }

  private async emit(bytes: Uint8Array): Promise<void> {
    await this.sink.write(bytes);
    this.pos += bytes.length;
  }

  async begin(): Promise<void> {
    await this.emit(Uint8Array.from([...latin1('%PDF-1.5\n%'), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  }

  async object(id: number, body: string): Promise<void> {
    this.offsets[id] = this.pos;
    await this.emit(latin1(`${id} 0 obj\n${body}\nendobj\n`));
  }

  async streamObject(id: number, dict: string, data: Uint8Array): Promise<void> {
    this.offsets[id] = this.pos;
    await this.emit(latin1(`${id} 0 obj\n<< ${dict} /Length ${data.length} >>\nstream\n`));
    await this.emit(data);
    await this.emit(latin1('\nendstream\nendobj\n'));
  }

  /**
   * Writes a canvas as a lossless RGB image XObject (plus an alpha SMask object
   * when any pixel is not fully opaque). Returns the image's object id.
   */
  async imageFromCanvas(canvas: HTMLCanvasElement): Promise<number> {
    const { width, height } = canvas;
    const rgba = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
    const pixels = width * height;
    const rgb = new Uint8Array(pixels * 3);
    const alpha = new Uint8Array(pixels);
    let hasAlpha = false;
    for (let i = 0, p = 0, a = 0; a < pixels; a++, i += 4) {
      rgb[p++] = rgba[i]!;
      rgb[p++] = rgba[i + 1]!;
      rgb[p++] = rgba[i + 2]!;
      const av = rgba[i + 3]!;
      alpha[a] = av;
      if (av !== 255) hasAlpha = true;
    }

    let smaskId: number | null = null;
    if (hasAlpha) {
      smaskId = this.allocate();
      await this.streamObject(
        smaskId,
        `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`,
        await deflate(alpha),
      );
    }
    const id = this.allocate();
    await this.streamObject(
      id,
      `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${
        smaskId ? ` /SMask ${smaskId} 0 R` : ''
      }`,
      await deflate(rgb),
    );
    return id;
  }

  /** Writes the xref stream, closes the sink. `rootId` is the catalog object. */
  async finish(rootId: number): Promise<void> {
    const xrefId = this.allocate();
    const xrefOffset = this.pos;
    this.offsets[xrefId] = xrefOffset;

    // Entry layout /W [1 8 2]: type, offset (8 bytes), generation (2 bytes).
    const size = xrefId + 1;
    const entry = 11;
    const table = new Uint8Array(size * entry);
    const view = new DataView(table.buffer);
    view.setUint8(0, 0);
    view.setUint16(9, 0xffff);
    for (let id = 1; id < size; id++) {
      const at = id * entry;
      view.setUint8(at, 1);
      view.setBigUint64(at + 1, BigInt(this.offsets[id]!));
    }
    await this.streamObject(xrefId, `/Type /XRef /W [1 8 2] /Size ${size} /Root ${rootId} 0 R`, table);
    await this.emit(encoder.encode(`startxref\n${xrefOffset}\n%%EOF\n`));
    await this.sink.close();
  }
}

interface SaveFilePickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{ createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }> }>;
}

/**
 * Opens a sink for the finished PDF. Where the File System Access API exists
 * (Chromium browsers) the PDF streams straight to the chosen file on disk, so
 * its size is unbounded. Otherwise chunks are gathered into disk-backed Blob
 * pieces and downloaded at the end. Must be called from a user gesture, before
 * any other await, for the save dialog to be allowed. Returns null if the user
 * cancels the dialog.
 */
export async function openPdfSink(fileName: string): Promise<PdfSink | null> {
  const picker = (window as unknown as SaveFilePickerWindow).showSaveFilePicker;
  if (picker) {
    let writable;
    try {
      const handle = await picker.call(window, {
        suggestedName: fileName,
        types: [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }],
      });
      writable = await handle.createWritable();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      throw err;
    }
    return { write: (chunk) => writable.write(chunk), close: () => writable.close() };
  }

  let parts: BlobPart[] = [];
  let buffered = 0;
  return {
    async write(chunk) {
      parts.push(chunk as BlobPart);
      buffered += chunk.length;
      // Fold into a single Blob regularly so the browser can spill to disk
      // instead of us holding thousands of live typed arrays.
      if (buffered > 64 * 1024 * 1024) {
        parts = [new Blob(parts)];
        buffered = 0;
      }
    },
    async close() {
      const url = URL.createObjectURL(new Blob(parts, { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
  };
}
