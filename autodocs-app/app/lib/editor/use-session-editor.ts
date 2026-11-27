"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Annotation, AnnotationChanges, AnnotationInput, AnnotationLayer, SessionDetail } from '@/app/lib/annotations/types';
import { parseCast, type Recording } from '@/app/lib/cast/parse';
import { ApiError, messageOf, request, requestText } from './api';
import { sortLayers } from './timeline';

const REFRESH_MILLISECONDS = 10_000;

export type SaveState = 'saved' | 'saving' | 'failed';

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

  const reload = useCallback(async (): Promise<SessionDetail> => {
    const { session: loaded } = await request<{ session: SessionDetail }>('GET', base);
    setSession(loaded);
    setRevision((current) => current + 1);
    return loaded;
  }, [base]);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const loaded = await reload();
        if (loaded.recordingSource === 'missing') return;
        const parsed = parseCast(await requestText(`${base}/recording`));
        if (!parsed.ok) throw new Error(parsed.error);
        if (!disposed) setRecording(parsed.recording);
      } catch (error) {
        if (!disposed) setLoadError({ status: error instanceof ApiError ? error.status : 0, message: messageOf(error) });
      }
    };
    void load();
    const timer = setInterval(() => { if (!document.hidden) void reload().catch(() => undefined); }, REFRESH_MILLISECONDS);
    return () => { disposed = true; clearInterval(timer); };
  }, [base, reload]);

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
    updateAnnotation: async (annotation: Annotation, changes: AnnotationChanges) =>
      (await change(() => request<{ annotation: Annotation }>('PATCH', `${base}/annotations/${annotation.id}`, { ...changes, expectedVersion: annotation.version })))?.annotation ?? null,
    deleteAnnotation: (annotationId: string) => change(() => request('DELETE', `${base}/annotations/${annotationId}`)),
    createLayer: async (title: string) => (await change(() => request<{ layer: AnnotationLayer }>('POST', `${base}/layers`, { title })))?.layer ?? null,
    updateLayer: (layerId: string, changes: { title?: string; position?: number }) => change(() => request('PATCH', `${base}/layers/${layerId}`, changes)),
    deleteLayer: (layerId: string) => change(() => request('DELETE', `${base}/layers/${layerId}`)),
  }), [base, change]);

  const layers = useMemo(() => sortLayers(session?.layers ?? []), [session?.layers]);
  const saveState: SaveState = pending > 0 ? 'saving' : failed ? 'failed' : 'saved';

  return { base, session, layers, recording, loadError, errorMessage, saveState, revision, reload, actions, dismissError: () => setErrorMessage(null) };
}

export type SessionEditor = ReturnType<typeof useSessionEditor>;
