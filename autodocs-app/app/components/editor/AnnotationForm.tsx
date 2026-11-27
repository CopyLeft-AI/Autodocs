"use client";

import { IconTrash } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { Annotation } from '@/app/lib/annotations/types';
import type { SessionEditor } from '@/app/lib/editor/use-session-editor';
import { formatTime, parseTime } from '@/app/lib/editor/timeline';
import { ProvenanceBadge } from './ProvenanceBadge';

const SAVE_DELAY_MILLISECONDS = 800;

interface AnnotationFormProps {
  annotation: Annotation;
  actions: SessionEditor['actions'];
  readOnly: boolean;
  timeMs: number;
  durationMs: number;
  textReference: RefObject<HTMLTextAreaElement | null>;
  confirmingDelete: boolean;
  onAskDelete: (ask: boolean) => void;
  onDelete: () => void;
}

/** The text being typed, saved shortly after the last key, without overwriting other people. */
function useAutosavedText(annotation: Annotation, actions: SessionEditor['actions'], readOnly: boolean) {
  const [base, setBase] = useState({ text: annotation.text, version: annotation.version });
  const [draft, setDraft] = useState(annotation.text);
  const [inFlight, setInFlight] = useState(0);
  /** The newest text on its way to the server. */
  const sent = useRef<string | null>(null);
  const saving = inFlight > 0;
  const dirty = draft !== base.text;

  // A newer server copy replaces ours when it cannot lose typing.
  if (annotation.version > base.version && (!dirty || annotation.text === base.text || annotation.text === draft)) {
    setBase({ text: annotation.text, version: annotation.version });
    if (!dirty) setDraft(annotation.text);
  }
  const conflict = !saving && dirty && annotation.version > base.version && annotation.text !== base.text;

  const { updateAnnotation, setUnsaved } = actions;
  // Saves may overlap: the editor sends them in order.
  const save = useCallback(async () => {
    if (readOnly || conflict || draft === (sent.current ?? base.text)) return;
    sent.current = draft;
    setInFlight((count) => count + 1);
    const saved = await updateAnnotation({ ...annotation, version: base.version }, { text: draft });
    if (saved) setBase((current) => (saved.version > current.version ? { text: saved.text, version: saved.version } : current));
    if (sent.current === draft) sent.current = null;
    setInFlight((count) => count - 1);
  }, [readOnly, conflict, draft, base, updateAnnotation, annotation]);

  const latest = useRef(save);
  useEffect(() => { latest.current = save; });
  // Not retried until the text or its base changes, so a failing request is not repeated.
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => void latest.current(), SAVE_DELAY_MILLISECONDS);
    return () => clearTimeout(timer);
  }, [draft, dirty, base.version]);
  // Leaving the annotation saves what was typed.
  useEffect(() => () => void latest.current(), []);
  useEffect(() => {
    setUnsaved(dirty && !readOnly);
    return () => setUnsaved(false);
  }, [dirty, readOnly, setUnsaved]);

  return {
    draft, setDraft, dirty, conflict, saving, save,
    keepMine: () => setBase({ text: annotation.text, version: annotation.version }),
    useTheirs: () => { setBase({ text: annotation.text, version: annotation.version }); setDraft(annotation.text); },
  };
}

function TimeField({ label, value, readOnly, timeMs, onCommit }: { label: string; value: number; readOnly: boolean; timeMs: number; onCommit: (value: number) => void }) {
  const [typed, setTyped] = useState<string | null>(null);
  const commit = () => {
    const parsed = typed === null ? null : parseTime(typed);
    setTyped(null);
    if (parsed !== null && parsed !== value) onCommit(parsed);
  };
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="flex gap-1">
        <input value={typed ?? formatTime(value, true)} disabled={readOnly} onChange={(event) => setTyped(event.target.value)} onBlur={commit}
          onKeyDown={(event) => { if (event.key === 'Enter') commit(); }} className="w-full min-w-0 rounded border border-border bg-background px-2 py-1 font-mono text-xs" />
        {!readOnly && <button type="button" onClick={() => onCommit(timeMs)} title={`Set ${label.toLowerCase()} to the playhead`} className="shrink-0 rounded border border-border px-2 text-xs hover:bg-accent">Here</button>}
      </span>
    </label>
  );
}

/** Edit one annotation. Remount (by key) for another one. */
export function AnnotationForm({ annotation, actions, readOnly, timeMs, durationMs, textReference, confirmingDelete, onAskDelete, onDelete }: AnnotationFormProps) {
  const text = useAutosavedText(annotation, actions, readOnly);
  const setTimes = (startMs: number, endMs: number) => {
    const limit = (value: number) => Math.min(Math.max(0, value), Math.max(durationMs, annotation.endMs));
    void actions.updateAnnotation(annotation, { startMs: limit(Math.min(startMs, endMs)), endMs: limit(Math.max(startMs, endMs)) });
  };

  return (
    <div className="space-y-3">
      <ProvenanceBadge annotation={annotation} />
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">What happens in this range</span>
        <textarea ref={textReference} value={text.draft} readOnly={readOnly} maxLength={10_000} rows={6} onChange={(event) => text.setDraft(event.target.value)} onBlur={() => void text.save()}
          onKeyDown={(event) => { if (event.key === 'Escape') event.currentTarget.blur(); }}
          placeholder={readOnly ? '' : 'Describe it'} className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm" />
      </label>
      {!readOnly && !text.conflict && <p role="status" className="text-xs text-muted-foreground">{text.saving ? 'Saving…' : text.dirty ? 'Not saved yet' : 'Saved'}</p>}
      {text.conflict && (
        <div role="alert" className="space-y-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <p>{annotation.editedByName ?? 'Someone'} changed this text while you were typing. Theirs:</p>
          <p className="whitespace-pre-wrap rounded bg-background p-2">{annotation.text}</p>
          <div className="flex gap-2">
            <button type="button" onClick={text.keepMine} className="rounded border border-border px-2 py-1 text-xs">Keep mine</button>
            <button type="button" onClick={text.useTheirs} className="rounded border border-border px-2 py-1 text-xs">Use theirs</button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <TimeField label="Start" value={annotation.startMs} timeMs={timeMs} readOnly={readOnly} onCommit={(value) => setTimes(value, Math.max(value, annotation.endMs))} />
        <TimeField label="End" value={annotation.endMs} timeMs={timeMs} readOnly={readOnly} onCommit={(value) => setTimes(Math.min(value, annotation.startMs), value)} />
      </div>
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Place in the hierarchy</span>
        <select value={annotation.depth ?? 0} disabled={readOnly} onChange={(event) => void actions.updateAnnotation(annotation, { depth: Number(event.target.value) })} className="w-full rounded border border-border bg-background px-2 py-1 text-sm">
          <option value={-1}>Starts a sub-task</option>
          <option value={0}>Same level</option>
          {[...new Set([1, 2, 3, annotation.depth ?? 0])].filter((depth) => depth > 0).sort((a, b) => a - b).map((depth) => <option key={depth} value={depth}>Closes {depth} level{depth > 1 ? 's' : ''}</option>)}
        </select>
      </label>
      {!readOnly && (confirmingDelete ? (
        <div className="flex items-center gap-2 text-sm">
          <button type="button" onClick={onDelete} className="rounded bg-destructive px-3 py-1.5 text-white">Delete this annotation</button>
          <button type="button" onClick={() => onAskDelete(false)} className="rounded border border-border px-3 py-1.5">Keep</button>
        </div>
      ) : (
        <button type="button" onClick={() => onAskDelete(true)} className="inline-flex items-center gap-1.5 text-sm text-destructive hover:underline"><IconTrash size={15} /> Delete (Del)</button>
      ))}
    </div>
  );
}
