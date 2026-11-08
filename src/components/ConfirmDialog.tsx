import { useEffect, useRef } from 'react';
import { tr } from '../i18n';

export function ConfirmDialog({ title, description, confirmLabel, busy, onCancel, onConfirm }: { title: string; description: string; confirmLabel: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => { dialog.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, []);
  return <div className="confirm-backdrop" onClick={event => event.stopPropagation()}><div ref={dialog} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description" onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape' && !busy) onCancel();
    if (event.key === 'Tab') {
      const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
      const next = buttons[(buttons.indexOf(document.activeElement as HTMLButtonElement) + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length];
      event.preventDefault(); next?.focus();
    }
  }}><h2 id="confirm-title">{title}</h2><p id="confirm-description">{description}</p><div className="clip-edit-actions"><button type="button" disabled={busy} onClick={onCancel}>{tr('取消')}</button><button type="button" className="destructive" disabled={busy} onClick={onConfirm}>{confirmLabel}</button></div></div></div>;
}
