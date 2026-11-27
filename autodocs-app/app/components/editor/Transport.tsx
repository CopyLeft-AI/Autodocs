"use client";

import { mdiAlphaACircleOutline, mdiAlphaBCircleOutline, mdiClockTimeFourOutline, mdiPause, mdiPlay, mdiSkipBackward, mdiSkipForward, mdiSkipNext, mdiSkipPrevious, mdiTagPlusOutline } from '@mdi/js';
import { useState } from 'react';
import { MdiIcon } from '@/app/components/MdiIcon';
import { formatTime, parseTime } from '@/app/lib/editor/timeline';
import { SPEEDS, type Playback } from '@/app/lib/editor/use-playback';

export interface TransportActions {
  inactivity: (direction: 1 | -1) => void;
  keyframe: (direction: 1 | -1) => void;
  setA: () => void;
  setB: () => void;
  create: () => void;
  openSeek: (open: boolean) => void;
}

interface TransportProps {
  playback: Playback;
  durationMs: number;
  rangeA: number | null;
  rangeB: number | null;
  readOnly: boolean;
  seeking: boolean;
  actions: TransportActions;
}

function Button({ icon, label, onClick, children, disabled }: { icon: string; label: string; onClick: () => void; children?: string; disabled?: boolean }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}
      className="inline-flex items-center gap-1 rounded p-1.5 text-foreground hover:bg-accent disabled:opacity-40">
      <MdiIcon path={icon} size={22} />
      {children && <span className="font-mono text-xs">{children}</span>}
    </button>
  );
}

/** Playback controls and the A-B marking buttons. */
export function Transport({ playback, durationMs, rangeA, rangeB, readOnly, seeking, actions }: TransportProps) {
  const [target, setTarget] = useState('');
  const parsed = parseTime(target);
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card px-2 py-1">
      <Button icon={mdiSkipBackward} label="Previous activity after a pause (Ctrl+Left)" onClick={() => actions.inactivity(-1)} />
      <Button icon={mdiSkipPrevious} label="Previous annotation edge (Up)" onClick={() => actions.keyframe(-1)} />
      <Button icon={playback.isPlaying ? mdiPause : mdiPlay} label={playback.isPlaying ? 'Pause (Space)' : 'Play (Space)'} onClick={playback.toggle} />
      <Button icon={mdiSkipNext} label="Next annotation edge (Down)" onClick={() => actions.keyframe(1)} />
      <Button icon={mdiSkipForward} label="Skip the next pause (Ctrl+Right)" onClick={() => actions.inactivity(1)} />
      <Button icon={mdiClockTimeFourOutline} label="Go to a time (S)" onClick={() => actions.openSeek(!seeking)} />
      {seeking ? (
        <form className="flex items-center gap-1" onSubmit={(event) => { event.preventDefault(); if (parsed !== null) { playback.seek(parsed); actions.openSeek(false); setTarget(''); } }}>
          <input autoFocus value={target} onChange={(event) => setTarget(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') actions.openSeek(false); }}
            placeholder="seconds or h:mm:ss" aria-label="Time to go to" className="w-36 rounded border border-border bg-background px-2 py-1 font-mono text-xs" />
          <button type="submit" disabled={parsed === null} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-40">Go</button>
        </form>
      ) : (
        <span className="mx-1 font-mono text-sm tabular-nums">{formatTime(playback.timeMs, true)} / {formatTime(durationMs, true)}</span>
      )}
      <input type="range" min={0} max={Math.max(1, durationMs)} value={playback.timeMs} onChange={(event) => playback.seek(Number(event.target.value))} aria-label="Playhead" className="min-w-24 flex-1" />
      <select value={playback.speed} onChange={(event) => playback.setSpeed(Number(event.target.value))} aria-label="Playback speed" className="rounded border border-border bg-background px-1 py-1 text-xs">
        {SPEEDS.map((speed) => <option key={speed} value={speed}>{speed}×</option>)}
      </select>
      {!readOnly && (
        <span className="flex items-center gap-1 border-l border-border pl-1">
          <Button icon={mdiAlphaACircleOutline} label="Set marker A at the playhead (A)" onClick={actions.setA}>{rangeA === null ? undefined : formatTime(rangeA, true)}</Button>
          <Button icon={mdiAlphaBCircleOutline} label="Set marker B at the playhead (B)" onClick={actions.setB}>{rangeB === null ? undefined : formatTime(rangeB, true)}</Button>
          <button type="button" onClick={actions.create} title="Create an annotation from A to B (C)" className="inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground">
            <MdiIcon path={mdiTagPlusOutline} size={18} /> Annotate
          </button>
        </span>
      )}
    </div>
  );
}
