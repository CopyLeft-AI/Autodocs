"use client";

import { useEffect, useState } from 'react';
import type { AnnotationRevision } from '@/app/lib/annotations/types';
import { messageOf, request } from '@/app/lib/editor/api';

/** Who did what, newest first. `revision` changes whenever the session was re-read. */
export function HistoryList({ base, revision }: { base: string; revision: number }) {
  const [revisions, setRevisions] = useState<AnnotationRevision[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    request<{ revisions: AnnotationRevision[] }>('GET', `${base}/history`)
      .then((body) => { if (!disposed) { setRevisions(body.revisions); setErrorMessage(null); } })
      .catch((error: unknown) => { if (!disposed) setErrorMessage(messageOf(error)); });
    return () => { disposed = true; };
  }, [base, revision]);

  if (errorMessage) return <p role="alert" className="text-sm text-destructive">{errorMessage}</p>;
  if (!revisions) return <p className="text-sm text-muted-foreground">Loading history…</p>;
  if (revisions.length === 0) return <p className="text-sm text-muted-foreground">Nothing has been done yet.</p>;

  return (
    <ol className="space-y-2">
      {revisions.map((entry) => (
        <li key={entry.id} className="border-l-2 border-border pl-2 text-sm">
          <span className="block break-words"><strong>{entry.actorName}</strong>: {entry.summary}</span>
          <time dateTime={entry.createdAt} className="font-mono text-[11px] text-muted-foreground">{new Date(entry.createdAt).toLocaleString('sv-SE')}</time>
        </li>
      ))}
    </ol>
  );
}
