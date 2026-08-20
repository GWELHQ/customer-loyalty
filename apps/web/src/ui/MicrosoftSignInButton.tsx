import type { ButtonHTMLAttributes } from 'react';

/**
 * "Sign in with Microsoft" button, built to Microsoft's official identity
 * branding guidelines (light theme):
 * https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-branding-in-apps
 *
 * White background, #8C8C8C border, the four-color Microsoft logo, and
 * Segoe UI text — do not reskin this to match the app's own palette.
 */
export function MicrosoftSignInButton({
  busy,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        width: '100%',
        height: 41,
        padding: '0 12px',
        background: '#ffffff',
        border: '1px solid #8c8c8c',
        borderRadius: 2,
        cursor: rest.disabled || busy ? 'not-allowed' : 'pointer',
        opacity: rest.disabled || busy ? 0.7 : 1,
        ...rest.style,
      }}
    >
      <MicrosoftLogo />
      <span
        style={{
          fontFamily: "'Segoe UI', var(--font-body), system-ui, sans-serif",
          fontSize: 15,
          fontWeight: 600,
          color: '#5e5e5e',
          letterSpacing: 0,
        }}
      >
        {busy ? 'Signing in…' : 'Sign in with Microsoft'}
      </span>
    </button>
  );
}

function MicrosoftLogo() {
  return (
    <svg width="21" height="21" viewBox="0 0 21 21" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}
