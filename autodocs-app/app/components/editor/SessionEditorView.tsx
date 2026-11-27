"use client";

import { mdiDownload } from '@mdi/js';
import { IconArrowLeft, IconFocus2, IconLoader2, IconShare, IconSparkles, IconTrash } from '@tabler/icons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnalysisDialog } from '@/app/components/AnalysisDialog';
import { MdiIcon } from '@/app/components/MdiIcon';
import { Modal } from '@/app/components/Modal';
import { UploadProgressPanel } from '@/app/components/UploadProgressPanel';
import type { Annotation } from '@/app/lib/annotations/types';
import { messageOf, request } from '@/app/lib/editor/api';
import { forgetSession, readResumePoint, saveResumePoint } from '@/app/lib/editor/resume';
import { commandFor, isTypingTarget, type Command } from '@/app/lib/editor/shortcuts';
import { annotationAt, formatTime, neighbourKeyframe, skipInactivity } from '@/app/lib/editor/timeline';
import { usePlayback } from '@/app/lib/editor/use-playback';
import { useSessionEditor, type SessionEditor } from '@/app/lib/editor/use-session-editor';
import { useAnalysisJobs } from '@/app/lib/use-analysis-jobs';
import { AnnotationForm } from './AnnotationForm';
import { AnnotationList } from './AnnotationList';
import { EventContent } from './EventContent';
import { HistoryList } from './HistoryList';
import { ProvenanceLegend } from './ProvenanceBadge';
import { ShareDialog } from './ShareDialog';
import { TerminalView } from './TerminalView';
import { Timeline } from './Timeline';
import { Transport, type TransportActions } from './Transport';

type Tab = 'annotation' | 'list' | 'content' | 'history';
const TABS: Array<[Tab, string]> = [['annotation', 'Annotation'], ['list', 'List'], ['content', 'Content'], ['history', 'History']];
const headerButton = 'inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent';

/** The page that replays a recording and edits its annotations. */
export function SessionEditorView({ sessionId }: { sessionId: string }) {
  const editor = useSessionEditor(sessionId);
  const router = useRouter();

  useEffect(() => {
    if (editor.loadError?.status === 401) router.replace('/login');
  }, [editor.loadError, router]);

  if (!editor.session) {
    return (
      <main className="flex h-screen flex-col items-center justify-center gap-4 bg-background">
        {editor.loadError ? (
          <>
            <p role="alert" className="text-destructive">{editor.loadError.message}</p>
            <Link href="/home" className={headerButton}>Back to sessions</Link>
          </>
        ) : <p className="flex items-center gap-2 text-muted-foreground"><IconLoader2 className="animate-spin" /> Opening the session…</p>}
      </main>
    );
  }
  return <Workspace editor={editor} session={editor.session} />;
}

function Workspace({ editor, session }: { editor: SessionEditor; session: NonNullable<SessionEditor['session']> }) {
  const { actions, layers, recording } = editor;
  const router = useRouter();
  const readOnly = !session.access.canAnnotate;
  const durationMs = recording?.durationMs ?? session.durationSeconds * 1000;
  const playback = usePlayback(durationMs);
  const { timeMs, seek, pause, play } = playback;

  const [chosenLayerId, setLayerId] = useState<string | null>(null);
  const layerId = layers.some((layer) => layer.id === chosenLayerId) ? chosenLayerId : layers[0]?.id ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rangeA, setRangeA] = useState<number | null>(null);
  const [rangeB, setRangeB] = useState<number | null>(null);
  const [focusing, setFocusing] = useState(false);
  const [hideMuted, setHideMuted] = useState(false);
  const [tab, setTab] = useState<Tab>('annotation');
  const [dialog, setDialog] = useState<'analysis' | 'share' | 'delete' | null>(null);
  const [seeking, setSeeking] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [resumedAt, setResumedAt] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const textReference = useRef<HTMLTextAreaElement>(null);
  const focusNewText = useRef<string | null>(null);

  const selected = session.annotations.find((annotation) => annotation.id === selectedId) ?? null;
  const layerAnnotations = useMemo(() => session.annotations.filter((annotation) => annotation.layerId === layerId), [session.annotations, layerId]);
  const hasMarkers = rangeA !== null && rangeB !== null && rangeB > rangeA;
  // What "the selected event" means: the selected annotation, otherwise A to B.
  const range = selected ? { startMs: selected.startMs, endMs: selected.endMs } : hasMarkers ? { startMs: rangeA, endMs: rangeB } : null;
  const focus = focusing ? range : null;
  const events = useMemo(
    () => (recording && range ? recording.events.filter((event) => event.timeMs >= range.startMs && event.timeMs <= range.endMs) : []),
    // The range object is new on every render; its ends are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recording, range?.startMs, range?.endMs],
  );

  const jobs = useAnalysisJobs({ onJobSaved: () => void editor.reload() });
  const ownJobs = jobs.jobs.filter((job) => job.sessionId === session.id);

  // Continue where this browser stopped last time, once the length is known.
  const restored = useRef(false);
  const ready = recording !== null || session.recordingSource === 'missing';
  useEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    const point = readResumePoint(session.id);
    if (!point) return;
    if (point.layerId) setLayerId(point.layerId);
    if (point.timeMs > 0 && point.timeMs < durationMs) { seek(point.timeMs); setResumedAt(point.timeMs); }
  }, [ready, session.id, durationMs, seek]);

  const savedSecond = Math.floor(timeMs / 1000);
  useEffect(() => {
    if (restored.current) saveResumePoint({ id: session.id, title: session.title }, { timeMs: savedSecond * 1000, layerId });
  }, [session.id, session.title, savedSecond, layerId]);

  const select = useCallback((annotation: Annotation) => {
    setSelectedId(annotation.id);
    setLayerId(annotation.layerId);
    setConfirmingDelete(false);
    setTab((current) => (current === 'history' ? 'annotation' : current));
  }, []);

  /** Selecting from a list also moves there. */
  const jumpTo = (annotation: Annotation) => { select(annotation); pause(); seek(focusing ? annotation.endMs : annotation.startMs); };

  const create = async () => {
    if (readOnly || !layerId) return;
    const first = rangeA ?? 0;
    const second = rangeB ?? timeMs;
    pause();
    const created = await actions.createAnnotation({ layerId, startMs: Math.min(first, second), endMs: Math.max(first, second), text: '', depth: 0 });
    if (!created) return;
    setRangeA(null);
    setRangeB(null);
    focusNewText.current = created.id;
    setSelectedId(created.id);
    setTab('annotation');
  };

  useEffect(() => {
    if (selected && focusNewText.current === selected.id && tab === 'annotation') {
      focusNewText.current = null;
      textReference.current?.focus();
    }
  }, [selected, tab]);

  /** The selected annotation, or else the one under the playhead in the active timeline. */
  const deletionTarget = selected ?? (layerId ? annotationAt(session.annotations, layerId, timeMs) : null);
  const removeSelected = () => {
    if (!selected) return;
    setConfirmingDelete(false);
    setSelectedId(null);
    void actions.deleteAnnotation(selected.id);
  };

  const toggleFocus = () => {
    if (!focusing) {
      const target = range ?? (layerId ? annotationAt(session.annotations, layerId, timeMs) : null);
      if (!target) return;
      if (!range && 'id' in target) setSelectedId(target.id as string);
      pause();
      if (timeMs < target.startMs || timeMs > target.endMs) seek(target.endMs);
    }
    setFocusing(!focusing);
  };

  const transport: TransportActions = {
    inactivity: (direction) => seek(skipInactivity(recording?.events ?? [], timeMs, direction, durationMs)),
    keyframe: (direction) => {
      const frame = neighbourKeyframe(layerAnnotations, timeMs, direction);
      if (frame !== null) { pause(); seek(frame); }
    },
    setA: () => { setSelectedId(null); setRangeA(timeMs); if (rangeB !== null && rangeB < timeMs) setRangeB(null); },
    setB: () => { setSelectedId(null); setRangeB(timeMs); if (rangeA !== null && rangeA > timeMs) setRangeA(null); },
    create: () => void create(),
    openSeek: setSeeking,
  };

  const run: Record<Command, () => void> = {
    setA: () => { if (!readOnly) transport.setA(); },
    setB: () => { if (!readOnly) transport.setB(); },
    create: transport.create,
    toggle: playback.toggle,
    toEnd: () => play(Math.max(0, durationMs - 1000)),
    delete: () => {
      if (readOnly || !deletionTarget) return;
      // The first press asks, the second deletes.
      if (confirmingDelete && selected) removeSelected();
      else { select(deletionTarget); setTab('annotation'); setConfirmingDelete(true); }
    },
    inactivityBack: () => transport.inactivity(-1),
    inactivityForward: () => transport.inactivity(1),
    previousKeyframe: () => transport.keyframe(-1),
    nextKeyframe: () => transport.keyframe(1),
    seek: () => setSeeking(true),
    focus: toggleFocus,
    escape: () => { setSelectedId(null); setFocusing(false); setConfirmingDelete(false); setRangeA(null); setRangeB(null); setSeeking(false); },
  };
  const commands = useRef(run);
  useEffect(() => { commands.current = run; });
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target, event.key)) return;
      const command = commandFor(event);
      if (!command) return;
      event.preventDefault();
      commands.current[command]();
    };
    window.addEventListener('keydown', press);
    return () => window.removeEventListener('keydown', press);
  }, []);

  const deleteSession = async () => {
    setDeleteError(null);
    try {
      await request('DELETE', editor.base);
      forgetSession(session.id);
      router.replace('/home');
    } catch (error) {
      setDeleteError(messageOf(error));
    }
  };

  return (
    <main className="flex h-screen min-w-[56rem] flex-col gap-2 bg-background p-3">
      <header className="flex flex-wrap items-center gap-2">
        <Link href="/home" className={headerButton}><IconArrowLeft size={16} /> Sessions</Link>
        <h1 className="min-w-0 flex-1 truncate text-base" title={session.title}>{session.title}</h1>
        {readOnly
          ? <span className="rounded border border-border px-2 py-1 text-xs text-muted-foreground">View only</span>
          : <span role="status" className={`text-xs ${editor.saveState === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{editor.saveState === 'saving' ? 'Saving…' : editor.saveState === 'failed' ? 'Last change not saved' : editor.saveState === 'unsaved' ? 'Not saved yet' : 'All changes saved'}</span>}
        {!readOnly && session.recordingSource !== 'missing' && <button type="button" onClick={() => setDialog('analysis')} className={headerButton}><IconSparkles size={16} /> Run a model</button>}
        {session.access.isOwner && <button type="button" onClick={() => setDialog('share')} className={headerButton}><IconShare size={16} /> Share</button>}
        {session.recordingSource !== 'missing' && (
          <>
            <a href={`${editor.base}/recording`} download className={headerButton} title="The recording without annotations"><MdiIcon path={mdiDownload} size={16} /> .cast</a>
            <a href={`${editor.base}/recording?annotations=1`} download className={headerButton} title="The recording with all timelines and who made each annotation"><MdiIcon path={mdiDownload} size={16} /> Annotated .cast</a>
          </>
        )}
        {session.access.isOwner && <button type="button" onClick={() => setDialog('delete')} aria-label="Delete session" title="Delete session" className={`${headerButton} text-destructive`}><IconTrash size={16} /></button>}
      </header>

      {editor.errorMessage && (
        <p role="alert" className="flex justify-between rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {editor.errorMessage}<button type="button" onClick={editor.dismissError} className="underline">Dismiss</button>
        </p>
      )}
      {editor.loadError && <p role="alert" className="text-sm text-destructive">{editor.loadError.message}</p>}
      {resumedAt !== null && (
        <p className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-1.5 text-sm">
          Continued where you left off, at {formatTime(resumedAt)}.
          <button type="button" onClick={() => { seek(0); setResumedAt(null); }} className="underline">Start from the beginning</button>
          <button type="button" onClick={() => setResumedAt(null)} className="underline">Dismiss</button>
        </p>
      )}
      {session.recordingSource === 'reconstructed' && <p className="text-xs text-amber-300">The original file was not kept for this older session. The replay is rebuilt from its stored events, without colours or exact layout.</p>}
      {ownJobs.map((job) => (
        <UploadProgressPanel key={job.id} job={job} isBusy={jobs.busyJobIds.has(job.id)} onControl={(action) => void jobs.controlJob(job.id, action)} onDelete={() => void jobs.deleteJob(job.id)} onDismiss={() => jobs.dismissJob(job.id)} />
      ))}
      {jobs.errorMessage && <p role="alert" className="text-xs text-destructive">{jobs.errorMessage}</p>}

      <div className="flex min-h-[16rem] flex-1 gap-2">
        <section aria-label="Replay" className="flex min-w-0 flex-1 flex-col gap-2">
          {recording
            ? <TerminalView recording={recording} timeMs={timeMs} focus={focus} hideMuted={hideMuted} />
            : <div className="flex flex-1 items-center justify-center rounded-lg border border-border text-sm text-muted-foreground">{session.recordingSource === 'missing' ? 'No terminal recording was stored for this session.' : 'Loading the recording…'}</div>}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button type="button" onClick={toggleFocus} aria-pressed={focusing} disabled={!focusing && !range && !deletionTarget}
              className={`${headerButton} disabled:opacity-40 ${focusing ? 'border-amber-300 bg-amber-300/15' : ''}`}><IconFocus2 size={16} /> Show only the selected event (F)</button>
            {focusing && (
              <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={hideMuted} onChange={(event) => setHideMuted(event.target.checked)} /> Hide the rest completely</label>
            )}
            {range && recording && <button type="button" onClick={() => play(range.startMs, range.endMs)} className={headerButton}>Play this event</button>}
            {focusing && !range && <span className="text-xs text-muted-foreground">Select an annotation or set A and B.</span>}
          </div>
        </section>

        <aside className="flex w-[26rem] shrink-0 flex-col rounded-lg border border-border bg-card">
          <div role="tablist" className="flex border-b border-border">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                className={`flex-1 border-b-2 py-2 text-sm ${tab === id ? 'border-primary' : 'border-transparent text-muted-foreground'}`}>{label}</button>
            ))}
          </div>
          <div role="tabpanel" className="min-h-0 flex-1 overflow-auto p-3">
            {tab === 'annotation' && (selected
              ? <AnnotationForm key={selected.id} annotation={selected} actions={actions} readOnly={readOnly} timeMs={timeMs} durationMs={durationMs} textReference={textReference} confirmingDelete={confirmingDelete} onAskDelete={setConfirmingDelete} onDelete={removeSelected} />
              : <div className="space-y-3 text-sm text-muted-foreground">
                  <p>{readOnly ? 'Select an annotation on the timeline to read it.' : 'Select an annotation on the timeline, or mark a new one: A where it starts, B where it ends, then C.'}</p>
                  <ProvenanceLegend />
                </div>)}
            {tab === 'list' && <AnnotationList annotations={layerAnnotations} selectedId={selectedId} onSelect={jumpTo} />}
            {tab === 'content' && (range ? <EventContent events={events} /> : <p className="text-sm text-muted-foreground">Select an annotation or set A and B to see its terminal content.</p>)}
            {tab === 'history' && <HistoryList base={editor.base} revision={editor.revision} />}
          </div>
        </aside>
      </div>

      <Transport playback={playback} durationMs={durationMs} rangeA={rangeA} rangeB={rangeB} readOnly={readOnly} seeking={seeking} actions={transport} />
      <Timeline durationMs={durationMs} timeMs={timeMs} isPlaying={playback.isPlaying} layers={layers} annotations={session.annotations} activeLayerId={layerId} selectedId={selectedId}
        rangeA={rangeA} rangeB={rangeB} readOnly={readOnly} onSeek={seek} onSelect={select}
        onRange={(startMs, endMs) => { setSelectedId(null); setRangeA(startMs); setRangeB(endMs); }}
        onActivateLayer={setLayerId}
        onResize={(annotation, startMs, endMs) => void actions.updateAnnotation(annotation, { startMs, endMs })}
        onAddLayer={() => void actions.createLayer(`Timeline ${layers.length + 1}`).then((layer) => { if (layer) setLayerId(layer.id); })}
        onRenameLayer={(layer, title) => void actions.updateLayer(layer.id, { title })}
        onMoveLayer={(layer, position) => void actions.updateLayer(layer.id, { position })}
        onDeleteLayer={(layer) => void actions.deleteLayer(layer.id)} />
      <ProvenanceLegend />

      {dialog === 'analysis' && (
        <AnalysisDialog sessionId={session.id} title={session.title} onClose={() => setDialog(null)}
          onStarted={(job) => { setDialog(null); if (job) jobs.addJob(job); else void editor.reload(); }} />
      )}
      {dialog === 'share' && <ShareDialog sessionId={session.id} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && (
        <Modal title="Delete this session" onClose={() => setDialog(null)}>
          <div className="space-y-3 text-sm">
            <p>Delete &ldquo;{session.title}&rdquo;, its recording and every annotation, for everyone it is shared with? This cannot be undone.</p>
            {deleteError && <p role="alert" className="text-destructive">{deleteError}</p>}
            <button type="button" onClick={() => void deleteSession()} className="rounded-lg bg-destructive px-4 py-2 text-white">Delete</button>
          </div>
        </Modal>
      )}
    </main>
  );
}
