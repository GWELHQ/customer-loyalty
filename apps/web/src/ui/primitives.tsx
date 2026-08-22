import type { ButtonHTMLAttributes, CSSProperties, PropsWithChildren, ReactNode } from 'react';

export function Card({ children, style, padding = 18 }: PropsWithChildren<{ style?: CSSProperties; padding?: number }>) {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, right }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
      <div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginTop: 2 }}>{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'secondary',
  size = 'md',
  style,
  children,
  ...rest
}: PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' }
>) {
  const height = size === 'sm' ? 34 : 42;
  const fontSize = size === 'sm' ? 12.5 : 14;
  const base: CSSProperties = {
    height,
    padding: '0 16px',
    borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-body)',
    fontSize,
    fontWeight: 700,
    cursor: rest.disabled ? 'not-allowed' : 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    border: '1px solid transparent',
    opacity: rest.disabled ? 0.55 : 1,
    transition: 'background 0.12s ease',
  };
  const variants: Record<ButtonVariant, CSSProperties> = {
    primary: { background: 'var(--color-primary)', color: '#fff' },
    secondary: { background: 'var(--color-surface)', color: 'var(--color-text)', borderColor: 'var(--color-border-strong)' },
    ghost: { background: 'transparent', color: 'var(--color-text)' },
    danger: { background: 'var(--color-surface)', color: 'var(--color-danger)', borderColor: 'var(--gw-red-500)' },
  };
  return (
    <button style={{ ...base, ...variants[variant], ...style }} {...rest}>
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: PropsWithChildren<{ tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }>) {
  const tones: Record<string, CSSProperties> = {
    neutral: { background: 'var(--color-surface-sunken)', color: 'var(--color-text-secondary)' },
    success: { background: 'var(--color-success-tint)', color: 'var(--color-success)' },
    warning: { background: 'var(--color-warning-tint)', color: 'var(--gw-amber-600)' },
    danger: { background: 'var(--color-danger-tint)', color: 'var(--color-danger)' },
    info: { background: 'var(--color-info-tint)', color: 'var(--color-info)' },
  };
  return (
    <span
      style={{
        fontSize: 11.5,
        fontWeight: 700,
        borderRadius: 999,
        padding: '4px 10px',
        display: 'inline-block',
        whiteSpace: 'nowrap',
        ...tones[tone],
      }}
    >
      {children}
    </span>
  );
}

export function KpiTile({
  label,
  value,
  note,
  color,
  onClick,
}: {
  label: string;
  value: ReactNode;
  note?: string;
  color?: string;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      style={{
        textAlign: 'left',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        padding: 14,
        cursor: onClick ? 'pointer' : 'default',
        fontFamily: 'var(--font-body)',
        boxShadow: 'var(--shadow-sm)',
        width: '100%',
      }}
    >
      <span style={{ display: 'block', fontSize: 12.5, color: 'var(--color-text-secondary)' }}>{label}</span>
      <span
        style={{
          display: 'block',
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: 25,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.01em',
          marginTop: 4,
          color: color ?? 'var(--color-text)',
        }}
      >
        {value}
      </span>
      {note && <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginTop: 3 }}>{note}</span>}
    </Tag>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: PropsWithChildren<{ title: string; onClose: () => void }>) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg, 0 20px 40px rgba(0,0,0,0.2))',
          width: '100%',
          maxWidth: 420,
          padding: 20,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17 }}>{title}</div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 18,
              lineHeight: 1,
              cursor: 'pointer',
              color: 'var(--color-text-secondary)',
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
      <div style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--color-text)' }}>{title}</div>
      {body && <div style={{ fontSize: 13, marginTop: 4 }}>{body}</div>}
    </div>
  );
}

export function Field({
  label,
  required,
  children,
}: PropsWithChildren<{ label: string; required?: boolean }>) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700 }}>
        {label}
        {required && (
          <span style={{ color: 'var(--color-danger)', marginLeft: 3 }} aria-hidden="true">
            *
          </span>
        )}
      </div>
      <div style={{ marginTop: 6 }}>{children}</div>
    </div>
  );
}

export const inputStyle: CSSProperties = {
  width: '100%',
  border: '1px solid var(--color-border-strong)',
  borderRadius: 'var(--radius-md)',
  padding: '10px 12px',
  fontSize: 14,
  fontFamily: 'var(--font-body)',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
};

export function Table({ children }: PropsWithChildren) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>{children}</table>
    </div>
  );
}

export function Th({ children, align }: PropsWithChildren<{ align?: 'left' | 'right' }>) {
  return (
    <th
      style={{
        textAlign: align ?? 'left',
        padding: '10px 14px',
        borderBottom: '1px solid var(--color-border)',
        color: 'var(--color-text-muted)',
        fontWeight: 700,
        fontSize: 12,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </th>
  );
}

export function Td({ children, align }: PropsWithChildren<{ align?: 'left' | 'right' }>) {
  return (
    <td
      style={{
        textAlign: align ?? 'left',
        padding: '11px 14px',
        borderBottom: '1px solid var(--color-border)',
        verticalAlign: 'middle',
      }}
    >
      {children}
    </td>
  );
}

export function Tr({ children, onClick }: PropsWithChildren<{ onClick?: () => void }>) {
  return (
    <tr onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      {children}
    </tr>
  );
}

export function Pagination({
  page,
  pageCount,
  onChange,
  totalLabel,
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  totalLabel?: string;
}) {
  if (pageCount <= 1) return null;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 12,
        padding: '12px 14px',
        borderTop: '1px solid var(--color-border)',
      }}
    >
      <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
        Page {page} of {pageCount}
        {totalLabel ? ` · ${totalLabel}` : ''}
      </span>
      <div style={{ display: 'flex', gap: 6 }}>
        <Button variant="secondary" size="sm" onClick={() => onChange(page - 1)} disabled={page <= 1}>
          Previous
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onChange(page + 1)} disabled={page >= pageCount}>
          Next
        </Button>
      </div>
    </div>
  );
}
