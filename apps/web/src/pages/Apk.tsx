import type { ApkVersion } from '@loyalty/shared';
import { useEffect, useState } from 'react';
import { useApi } from '../data/client';
import { Icon } from '../ui/Icon';
import { Button, Card } from '../ui/primitives';

type PublicApkVersion = Omit<ApkVersion, 'gcsPath' | 'uploadedByUserId' | 'uploadedByName'>;

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Public, unauthenticated download page for the Android pump-attendant
 * app — no sidebar/AppShell, no sign-in required. Mobile-first: this is
 * meant to be opened straight from a phone browser after tapping a shared
 * link, so the single-column layout is the primary target, not a
 * fallback for a desktop design.
 */
export function Apk() {
  const api = useApi();
  const [release, setRelease] = useState<PublicApkVersion | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.apk
      .release()
      .then(setRelease)
      .catch(() => setRelease(null));
  }, [api]);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--color-surface-sunken, #f4f6f8)',
        display: 'flex',
        justifyContent: 'center',
        padding: '32px 16px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', marginBottom: 28 }}>
          <img src="/logo-mark.png" alt="" style={{ width: 32, height: 32, objectFit: 'contain' }} />
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17, letterSpacing: '0.02em' }}>
            GREEN WELLS ENERGIES
          </div>
        </div>

        <Card style={{ textAlign: 'center', padding: '28px 20px' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22 }}>Sales Assistant App</div>
          <div style={{ fontSize: 13.5, color: 'var(--color-text-secondary)', marginTop: 6, lineHeight: 1.5 }}>
            The Android app pump attendants use to record sales at the pump.
          </div>

          {release === undefined && (
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 24 }}>Loading…</div>
          )}

          {release === null && (
            <div
              style={{
                fontSize: 13.5,
                color: 'var(--color-text-secondary)',
                background: 'var(--color-surface-sunken)',
                borderRadius: 8,
                padding: 16,
                marginTop: 24,
              }}
            >
              No app build has been released yet. Check back soon.
            </div>
          )}

          {release && (
            <>
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: 'var(--color-text-secondary)',
                  marginTop: 20,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Version {release.versionName} · {formatFileSize(release.fileSizeBytes)}
              </div>

              {error && (
                <div style={{ fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12, marginTop: 16 }}>
                  {error}
                </div>
              )}

              <a href={api.apk.downloadUrl()} style={{ textDecoration: 'none', display: 'block', marginTop: 16 }}>
                <Button
                  variant="primary"
                  style={{ width: '100%', height: 52, fontSize: 15.5, gap: 10 }}
                  onClick={() => setError(null)}
                >
                  <Icon name="download" size={18} />
                  Download for Android
                </Button>
              </a>

              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 10 }}>
                Your phone may warn about apps from outside the Play Store — this is expected; allow the install.
              </div>
            </>
          )}
        </Card>

        {release && (release.features.length > 0 || release.fixes.length > 0) && (
          <Card style={{ marginTop: 16 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15 }}>
              What's new in {release.versionName}
            </div>
            {release.features.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Features
                </div>
                <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 13.5, lineHeight: 1.7 }}>
                  {release.features.map((f: string, i: number) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
            {release.fixes.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Fixes
                </div>
                <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 13.5, lineHeight: 1.7 }}>
                  {release.fixes.map((f: string, i: number) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
