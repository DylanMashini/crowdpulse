'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

import { Button } from '@/components/ds';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** What will happen, including what is deleted. */
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  /** While the action runs: both buttons are disabled and the confirm button says this. */
  busyLabel?: string;
  busy?: boolean;
  /** A failure of the action, shown inside the dialog so it can be tried again. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirms an action that deletes data. Focus starts on the button that changes nothing. */
export function ConfirmDialog({ open, title, children, confirmLabel, cancelLabel, busyLabel, busy, error, onConfirm, onCancel }: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      className="m-auto w-[min(520px,calc(100vw-32px))] rounded-lg border border-line bg-surface-raised p-0 text-ink shadow-overlay backdrop:bg-scrim"
    >
      <div className="flex flex-col gap-3 p-5">
        <h2 id={titleId} className="type-heading">
          {title}
        </h2>
        <div className="rounded-md bg-critical-soft p-3 text-ink">{children}</div>
        {error ? (
          <p role="alert" className="text-[13px] leading-[18px] font-medium text-critical">
            {error}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <Button autoFocus onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant="danger" icon="trash" onClick={onConfirm} disabled={busy}>
            {busy && busyLabel ? busyLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
