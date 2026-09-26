'use client';

import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import { Input, Label } from '@/components/ui/Field';

type ConfirmModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  icon: React.ReactNode;
  tone?: 'neutral' | 'danger';
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  /**
   * When set, the confirm button stays disabled until the user types this
   * exact word. Reserved for genuinely irreversible actions -- PRD SS7.4
   * allows permanent destruction only from inside Trash, and only behind this.
   */
  typedConfirmation?: string;
  confirmDisabled?: boolean;
  /** The caller closes the dialog itself (after an async result). */
  keepOpenOnConfirm?: boolean;
};

export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  icon,
  tone = 'neutral',
  title,
  body,
  confirmLabel,
  typedConfirmation,
  confirmDisabled = false,
  keepOpenOnConfirm = false,
}: ConfirmModalProps) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Reset the typed word each time the dialog opens.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTyped('');
    }
  }, [isOpen]);

  const isDanger = tone === 'danger';
  const canConfirm =
    !confirmDisabled &&
    (!typedConfirmation || typed.trim().toUpperCase() === typedConfirmation.toUpperCase());

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title={title}
      icon={<span className={isDanger ? 'text-destructive' : 'text-primary'}>{icon}</span>}
      width="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={isDanger ? 'danger' : 'primary'}
            disabled={!canConfirm}
            busy={busy}
            className={isDanger ? '!bg-destructive !text-destructive-foreground !border-transparent' : ''}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
              if (!keepOpenOnConfirm) onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-muted-foreground">{body}</div>

      {typedConfirmation && (
        <div className="mt-4">
          <Label htmlFor="typed-confirmation">
            Type <span className="font-mono">{typedConfirmation}</span> to confirm
          </Label>
          <Input
            id="typed-confirmation"
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
          />
        </div>
      )}
    </Dialog>
  );
}
