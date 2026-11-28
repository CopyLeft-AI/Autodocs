"use client";

import { useEffect, useRef } from 'react';
import type { Annotation } from '@/app/lib/annotations/types';
import { formatTime, outlineLevels } from '@/app/lib/editor/timeline';
import { ProvenanceBadge } from './ProvenanceBadge';

/** The annotations of the active timeline in time order, indented by hierarchy. */
export function AnnotationList({ annotations, selectedId, onSelect }: { annotations: Annotation[]; selectedId: string | null; onSelect: (annotation: Annotation) => void }) {
  const ordered = [...annotations].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const levels = outlineLevels(ordered);
  const selected = useRef<HTMLButtonElement>(null);
  useEffect(() => { selected.current?.scrollIntoView({ block: 'nearest' }); }, [selectedId]);

  if (ordered.length === 0) return <p className="text-sm text-muted-foreground">This timeline has no annotations yet.</p>;

  return (
    <ol className="space-y-1">
      {ordered.map((annotation, index) => (
        <li key={annotation.id} style={{ marginLeft: Math.min(levels[index], 8) * 14 }}>
          <button ref={annotation.id === selectedId ? selected : undefined} type="button" onClick={() => onSelect(annotation)} aria-current={annotation.id === selectedId}
            className={`block w-full space-y-1 rounded-lg border p-2 text-left ${annotation.id === selectedId ? 'border-primary bg-primary/15' : 'border-border hover:bg-accent'}`}>
            <span className="block font-mono text-[11px] text-muted-foreground">{formatTime(annotation.startMs, true)} to {formatTime(annotation.endMs, true)}</span>
            <span className="block text-sm break-words">{annotation.text || <em className="text-muted-foreground">No text yet</em>}</span>
            <ProvenanceBadge annotation={annotation} />
          </button>
        </li>
      ))}
    </ol>
  );
}
