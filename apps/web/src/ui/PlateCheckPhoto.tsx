import { useState } from 'react';
import { useApi } from '../data/client';
import { Badge, Button, Modal } from './primitives';

/**
 * "View photo" button for a vehicle-plate-check — fetches a fresh signed
 * image URL on click (never cached, they expire in ~15 min) and shows it
 * in a modal alongside what OCR detected. Used from both the sale detail
 * panel and a fraud flag's evidence section — same underlying photo,
 * same review need in both places.
 */
export function PlateCheckPhoto({ plateCheckId }: { plateCheckId: string }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<Awaited<ReturnType<typeof api.vehiclePlateChecks.get>> | null>(null);

  async function view() {
    setOpen(true);
    setError(null);
    setLoading(true);
    try {
      setCheck(await api.vehiclePlateChecks.get(plateCheckId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the plate photo');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={view}>
        View photo
      </Button>
      {open && (
        <Modal title="Vehicle plate photo" onClose={() => setOpen(false)}>
          {loading && <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', padding: 20, textAlign: 'center' }}>Loading…</div>}
          {error && (
            <div style={{ fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12 }}>
              {error}
            </div>
          )}
          {check && (
            <div>
              <img
                src={check.viewUrl}
                alt="Vehicle plate"
                style={{ width: '100%', borderRadius: 'var(--radius-md)', display: 'block' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, fontSize: 13 }}>
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  Detected: <strong style={{ color: 'var(--color-text)' }}>{check.detectedPlateNumber ?? 'Not detected'}</strong>
                </span>
                <Badge tone={check.matched ? 'success' : 'danger'}>{check.matched ? 'Matched' : 'Mismatch'}</Badge>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
