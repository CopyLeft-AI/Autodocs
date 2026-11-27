"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Annotation, AnnotationChanges, AnnotationInput, AnnotationLayer, SessionDetail } from '@/app/lib/annotations/types';
import { parseCast, type Recording } from '@/app/lib/cast/parse';
import { ApiError, messageOf, request, requestText } from './api';
import { createSaveQueue } from './save-queue';
import { sortLayers } from './timeline';

const REFRESH_MILLISECONDS = 10_000;

export type SaveState = 'saved' | 'saving' | 'failed' | 'unsaved';

/**
 * The session being edited: loads it with its recording, applies changes on the
 * server, and re-reads it periodically so other people's work appears.
 */
export function useSessionEditor(sessionId: string) {
  const base = `/api/terminal-sessions/${encodeURIComponent(sessionId)}`;
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(false);
  /** Increases after every change, so the history can reload. */
  const [revision, setRevision] = useState(0);

  /** Text typed but not yet saved. */
  const [unsaved, setUnsaved] = useState(false);
  const [enqueue] = useState(() => createSaveQueue<Annotation>());
  const requested = useRef(0);
  const applied = useRef(0);

  const reload = useCallback(async (): Promise<SessionDetail> => {
    const order = ++requested.current;
    const { session: loaded } = await request<{ session: SessionDetail }>('GET', base);
    // An answer that arrives after a newer one is out of date.
    if (order < applied.current) return loaded;
    applied.current = order;
    setSession(loaded);
    setLoadError(null);
    setRevision((current) => current + 1);
    return loaded;
  }, [base]);

  const fail = useCallback((error: unknown) => setLoadError({ status: error instanceof ApiError ? error.status : 0, message: messageOf(error) }), []);

  useEffect(() => {
    void reload().catch(fail);
    const timer = setInterval(() => { if (!document.hidden) void reload().catch(() => undefined); }, REFRESH_MILLISECONDS);
    return () => clearInterval(timer);
  }, [reload, fail]);

  // Fetched once the session is known, even if the first attempt to read it failed.
  const source = session?.recordingSource;
  useEffect(() => {
    if (!source || source === 'missing') return;
    let disposed = false;
    const load = async () => {
      try {
        const parsed = parseCast(await requestText(`${base}/recording`));
        if (!parsed.ok) throw new Error(parsed.error);
        if (!disposed) setRecording(parsed.recording);
      } catch (error) {
        if (!disposed) fail(error);
      }
    };
    void load();
    return () => { disposed = true; };
  }, [base, source, fail]);

  /** Run one change; the session is re-read afterwards, also when it failed. */
  const change = useCallback(async <T,>(work: () => Promise<T>): Promise<T | null> => {
    setPending((count) => count + 1);
    setErrorMessage(null);
    try {
      const result = await work();
      setFailed(false);
      return result;
    } catch (error) {
      setFailed(true);
      setErrorMessage(messageOf(error));
      return null;
    } finally {
      await reload().catch(() => undefined);
      setPending((count) => count - 1);
    }
  }, [reload]);

  const actions = useMemo(() => ({
    createAnnotation: async (input: AnnotationInput) => (await change(() => request<{ annotation: Annotation }>('POST', `${base}/annotations`, input)))?.annotation ?? null,
    updateAnnotation: (annotation: Annotation, changes: AnnotationChanges) =>
      enqueue(annotation.id, annotation.version, async (expectedVersion) =>
        (await change(() => request<{ annotation: Annotation }>('PATCH', `${base}/annotations/${annotation.id}`, { ...changes, expectedVersion })))?.annotation ?? null),
    setUnsaved,
    deleteAnnotation: (annotationId: string) => change(() => request('DELETE', `${base}/annotations/${annotationId}`)),
    createLayer: async (title: string) => (await change(() => request<{ layer: AnnotationLayer }>('POST', `${base}/layers`, { title })))?.layer ?? null,
    updateLayer: (layerId: string, changes: { title?: string; position?: number }) => change(() => request('PATCH', `${base}/layers/${layerId}`, changes)),
    deleteLayer: (layerId: string) => change(() => request('DELETE', `${base}/layers/${layerId}`)),
  }), [base, change, enqueue]);

  const layers = useMemo(() => sortLayers(session?.layers ?? []), [session?.layers]);
  const saveState: SaveState = pending > 0 ? 'saving' : failed ? 'failed' : unsaved ? 'unsaved' : 'saved';

  // Closing the page now would lose work.
  const atRisk = unsaved || pending > 0;
  useEffect(() => {
    if (!atRisk) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [atRisk]);

  return { base, session, layers, recording, loadError, errorMessage, saveState, revision, reload, actions, dismissError: () => setErrorMessage(null) };
}

export type SessionEditor = ReturnType<typeof useSessionEditor>;
