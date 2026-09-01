import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { MicrosoftSignInButton } from '../ui/MicrosoftSignInButton';

export function SignIn() {
  const { user, loading, signInWithMicrosoft, landingPath } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return null;
  if (user) return <Navigate to={landingPath} replace />;

  async function handleSignIn() {
    setError(null);
    setBusy(true);
    try {
      await signInWithMicrosoft();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Sign-in failed. Ask an Admin to confirm your account is active.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '1.1fr 1fr' }}>
      <div
        style={{
          background: 'var(--gw-blue-500)',
          color: '#fff',
          padding: 48,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src="/logo-mark.png" alt="Green Wells" style={{ width: 36, height: 36, objectFit: 'contain', flex: 'none' }} />
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, letterSpacing: '0.02em' }}>
            GREEN WELLS ENERGIES
          </div>
        </div>
        <div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 40,
              lineHeight: 1.15,
              letterSpacing: '-0.02em',
              maxWidth: '15em',
            }}
          >
            Loyalty cashback, centralised across every station.
          </div>
          {/* <div style={{ fontSize: 16, color: '#c3d0e6', marginTop: 18, maxWidth: '30em', lineHeight: 1.6 }}>
            Customers earn KSh 2 per whole litre at Kisumu 1, Kisumu 2, Ugunja and Mbita. One record, one
            monthly total, one approval trail.
          </div> */}
        </div>
        <div style={{ fontSize: 13, color: '#8fa8d0' }}>Petroleum &amp; LPG distribution and retail</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26 }}>Sign in</div>
          <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginTop: 6 }}>
            Sign in with your Green Wells Microsoft account. 
          </div>

          <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {error && (
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--color-danger)',
                  background: 'var(--color-danger-tint)',
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                {error}
              </div>
            )}
            <MicrosoftSignInButton onClick={handleSignIn} busy={busy} />
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', textAlign: 'center' }}>
              Service assistants record sales in the Android app, not here.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
