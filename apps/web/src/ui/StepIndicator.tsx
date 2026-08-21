import { Icon } from './Icon';

export type StepState = 'done' | 'current' | 'pending' | 'rejected';

export interface StepIndicatorStep {
  label: string;
  state: StepState;
  /** Small line under the label, e.g. "Brian Kiplagat · 21 Aug" */
  subtext?: string;
}

const STATE_COLORS: Record<StepState, { bg: string; border: string; text: string }> = {
  done: { bg: 'var(--color-primary)', border: 'var(--color-primary)', text: '#fff' },
  current: { bg: 'var(--color-surface)', border: 'var(--gw-blue-500)', text: 'var(--gw-blue-500)' },
  pending: { bg: 'var(--color-surface)', border: 'var(--color-border-strong)', text: 'var(--color-text-muted)' },
  rejected: { bg: 'var(--color-danger)', border: 'var(--color-danger)', text: '#fff' },
};

/** A horizontal approval-matrix step indicator — released -> approved -> disbursed, etc. */
export function StepIndicator({ steps }: { steps: StepIndicatorStep[] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start' }}>
      {steps.map((step, i) => {
        const colors = STATE_COLORS[step.state];
        const isLast = i === steps.length - 1;
        return (
          <div key={step.label} style={{ display: 'flex', alignItems: 'flex-start', flex: isLast ? 'none' : 1 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 96 }}>
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 999,
                  background: colors.bg,
                  border: `2px solid ${colors.border}`,
                  color: colors.text,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 800,
                  fontSize: 13,
                  flexShrink: 0,
                }}
              >
                {step.state === 'done' && <Icon name="check" size={15} color={colors.text} />}
                {step.state === 'rejected' && <Icon name="x" size={15} color={colors.text} />}
                {(step.state === 'current' || step.state === 'pending') && i + 1}
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: step.state === 'current' ? 800 : 600,
                  marginTop: 7,
                  textAlign: 'center',
                  color: step.state === 'pending' ? 'var(--color-text-muted)' : 'var(--color-text)',
                }}
              >
                {step.label}
              </div>
              {step.subtext && (
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2, textAlign: 'center' }}>
                  {step.subtext}
                </div>
              )}
            </div>
            {!isLast && (
              <div
                style={{
                  flex: 1,
                  height: 2,
                  marginTop: 14,
                  background: step.state === 'done' ? 'var(--color-primary)' : 'var(--color-border)',
                  minWidth: 24,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
