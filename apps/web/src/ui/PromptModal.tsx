import { useState } from 'react';
import { Button, Field, Modal, inputStyle } from './primitives';

/**
 * In-app replacement for `window.prompt()` — every "give a reason before this
 * action goes through" flow (reject, hold, dismiss, resolve, ...) needs the
 * same shape (one text field, confirm/cancel), so this is shared rather than
 * each page re-implementing its own modal + local text-input state.
 */
export function PromptModal({
  title,
  label,
  placeholder,
  confirmLabel = 'Submit',
  destructive,
  onCancel,
  onSubmit,
}: {
  title: string;
  label: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Renders the confirm button as `danger` instead of `primary` — for reject/hold/dismiss-style actions. */
  destructive?: boolean;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState('');
  const trimmed = value.trim();

  function submit() {
    if (!trimmed) return;
    onSubmit(trimmed);
  }

  return (
    <Modal title={title} onClose={onCancel}>
      <Field label={label} required>
        <textarea
          autoFocus
          style={{ ...inputStyle, minHeight: 84, resize: 'vertical', fontFamily: 'var(--font-body)' }}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            // Enter submits, Shift+Enter still inserts a newline for a longer reason.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
      </Field>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <Button variant={destructive ? 'danger' : 'primary'} size="sm" onClick={submit} disabled={!trimmed}>
          {confirmLabel}
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
