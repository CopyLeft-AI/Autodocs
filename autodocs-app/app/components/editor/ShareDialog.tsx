"use client";

import { useState } from 'react';
import { Modal } from '@/app/components/Modal';
import { messageOf, request } from '@/app/lib/editor/api';

export function ShareDialog({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [canAnnotate, setCanAnnotate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const share = async () => {
    setBusy(true);
    setResult(null);
    try {
      const { sharedWith } = await request<{ sharedWith: { name: string } }>('POST', '/api/terminal-sessions/share', { terminalSessionId: sessionId, targetUserEmail: email.trim().toLowerCase(), canAnnotate });
      setResult({ ok: true, message: `Shared with ${sharedWith.name}.` });
      setEmail('');
    } catch (error) {
      setResult({ ok: false, message: messageOf(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Share this session" onClose={onClose}>
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void share(); }}>
        <label className="block space-y-1">
          <span className="text-sm">Email of an AutoDocs user</span>
          <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={canAnnotate} onChange={(event) => setCanAnnotate(event.target.checked)} />
          May add and change annotations
        </label>
        <p className="text-xs text-muted-foreground">Sharing again with the same person replaces this permission.</p>
        {result && <p role="status" className={`text-sm ${result.ok ? 'text-emerald-300' : 'text-destructive'}`}>{result.message}</p>}
        <button type="submit" disabled={busy || !email.trim()} className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{busy ? 'Sharing…' : 'Share'}</button>
      </form>
    </Modal>
  );
}
