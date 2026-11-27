"use client";

import { IconX } from '@tabler/icons-react';
import { useEffect, useRef, type ReactNode } from 'react';

/** A native modal dialog: focus is trapped and Escape closes it. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog ref={dialog} aria-label={title} onCancel={(event) => { event.preventDefault(); onClose(); }}
      className="m-auto w-[min(34rem,92vw)] rounded-xl border border-border bg-card p-0 text-foreground backdrop:bg-black/70">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h2 className="text-base">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><IconX size={18} /></button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}
