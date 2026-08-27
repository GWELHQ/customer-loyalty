import { useEffect, useRef, useState } from 'react';

// Literal hex, not var(--gw-green-*): qr-code-styling paints via <canvas>/<svg>
// attributes, which don't resolve CSS custom properties the way inline
// `style` does — these values match tokens.css's --gw-green-700/600/50 exactly.
const QR_DARK_GREEN = '#20713b';
const QR_MID_GREEN = '#278e4a';
const QR_PALE_GREEN = '#eafaf0';

/** Renders any string as a scannable, brand-styled QR code — caller decides what the content means. */
export function QrCode({ value, size = 176 }: { value: string; size?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');

    // Dynamically imported — this component only renders inside a customer
    // profile panel, so the library shouldn't cost anything until someone
    // actually opens it.
    void import('qr-code-styling')
      .then(({ default: QRCodeStyling }) => {
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = '';
        const qrCode = new QRCodeStyling({
          width: size,
          height: size,
          data: value,
          margin: 8,
          qrOptions: { errorCorrectionLevel: 'M' },
          dotsOptions: { type: 'dots', color: QR_DARK_GREEN },
          cornersSquareOptions: { type: 'extra-rounded', color: QR_DARK_GREEN },
          cornersDotOptions: { type: 'dot', color: QR_MID_GREEN },
          backgroundOptions: { color: QR_PALE_GREEN },
        });
        qrCode.append(containerRef.current);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('failed');
      });

    return () => {
      cancelled = true;
    };
  }, [value, size]);

  return (
    <div style={{ display: 'grid', gap: 8, justifyItems: 'center' }}>
      <div
        style={{
          width: size + 16,
          height: size + 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--gw-green-50)',
          border: '6px solid #fff',
          boxShadow: '0 0 0 1px var(--color-border)',
        }}
      >
        <div
          ref={containerRef}
          role="img"
          aria-label="QR code identifying this customer"
          style={{ display: status === 'ready' ? 'block' : 'none' }}
        />
        {status !== 'ready' && (
          <span
            style={{
              fontSize: 12,
              color: status === 'failed' ? 'var(--color-danger)' : 'var(--color-text-muted)',
              textAlign: 'center',
              padding: '0 8px',
            }}
          >
            {status === 'failed' ? 'Could not generate the QR code.' : 'Generating…'}
          </span>
        )}
      </div>
    </div>
  );
}
