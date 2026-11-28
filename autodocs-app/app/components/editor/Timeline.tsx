"use client";

import { mdiCursorDefault, mdiMagnifyPlusOutline, mdiPan, mdiSelectDrag } from '@mdi/js';
import { IconArrowDown, IconArrowUp, IconArrowsHorizontal, IconMinus, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { MdiIcon } from '@/app/components/MdiIcon';
import { provenanceLabel, provenanceOf, type Annotation, type AnnotationLayer } from '@/app/lib/annotations/types';
import { clamp, constrainViewport, fitViewport, follow, formatTime, pixelToTime, rulerTicks, stackLanes, timeToPixel, zoomAt, type Viewport } from '@/app/lib/editor/timeline';
import { PROVENANCE_STYLES } from './provenance';

export type TimelineMode = 'cursor' | 'select' | 'pan' | 'zoom';

const MODES: Array<{ id: TimelineMode; label: string; icon: string }> = [
  { id: 'cursor', label: 'Pointer: seek, select, move and resize annotations', icon: mdiCursorDefault },
  { id: 'select', label: 'Select a range: drag to set A and B', icon: mdiSelectDrag },
  { id: 'pan', label: 'Pan: drag to scroll', icon: mdiPan },
  { id: 'zoom', label: 'Zoom: click to zoom in, Ctrl+click to zoom out', icon: mdiMagnifyPlusOutline },
];

const LANE_HEIGHT = 26;
const LABEL_WIDTH = 190;

interface TimelineProps {
  durationMs: number;
  timeMs: number;
  isPlaying: boolean;
  layers: AnnotationLayer[];
  annotations: Annotation[];
  activeLayerId: string | null;
  selectedId: string | null;
  rangeA: number | null;
  rangeB: number | null;
  readOnly: boolean;
  onSeek: (timeMs: number) => void;
  onSelect: (annotation: Annotation) => void;
  onRange: (startMs: number, endMs: number) => void;
  onActivateLayer: (layerId: string) => void;
  onResize: (annotation: Annotation, startMs: number, endMs: number) => void;
  onAddLayer: () => void;
  onRenameLayer: (layer: AnnotationLayer, title: string) => void;
  onMoveLayer: (layer: AnnotationLayer, position: number) => void;
  onDeleteLayer: (layer: AnnotationLayer) => void;
}

interface Drag {
  kind: 'seek' | 'range' | 'pan' | 'move' | 'start' | 'end';
  originPixel: number;
  originView: Viewport;
  annotation?: Annotation;
}

/** Layers of annotations on a zoomable time axis, with the playhead and the A-B range. */
export function Timeline(properties: TimelineProps) {
  const { durationMs, timeMs, isPlaying, layers, annotations, activeLayerId, selectedId, rangeA, rangeB, readOnly } = properties;
  const [mode, setMode] = useState<TimelineMode>('cursor');
  const [width, setWidth] = useState(800);
  const [view, setView] = useState<Viewport | null>(null);
  const [preview, setPreview] = useState<{ id: string; startMs: number; endMs: number } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const current = view ?? fitViewport(durationMs, width);
  const latest = useRef({ current, durationMs, width });
  useEffect(() => { latest.current = { current, durationMs, width }; });

  useEffect(() => {
    const element = track.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(100, element.clientWidth)));
    observer.observe(element);
    // React's wheel listener is passive, so zooming needs its own to stop page scroll.
    const wheel = (event: WheelEvent) => {
      const state = latest.current;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        setView(zoomAt(state.current, event.clientX - element.getBoundingClientRect().left, Math.exp(-event.deltaY / 300), state.durationMs, state.width));
      } else if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        event.preventDefault();
        const delta = event.deltaX || event.deltaY;
        setView(constrainViewport({ ...state.current, startMs: state.current.startMs + (delta / state.current.pixelsPerSecond) * 1000 }, state.durationMs, state.width));
      }
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); element.removeEventListener('wheel', wheel); };
  }, []);

  // Keep the playhead in sight while playing and after jumps.
  useEffect(() => {
    if (drag.current) return;
    const state = latest.current;
    const next = follow(state.current, timeMs, state.durationMs, state.width);
    if (next !== state.current) setView(next);
  }, [timeMs, isPlaying]);

  // The + and - keys zoom around the playhead.
  const keyZoom = useRef<(factor: number) => void>(() => undefined);
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || (event.target as HTMLElement).closest?.('input:not([type="radio"]), textarea, select, dialog')) return;
      if (event.key === '+' || event.key === '=') keyZoom.current(2);
      if (event.key === '-') keyZoom.current(0.5);
    };
    window.addEventListener('keydown', press);
    return () => window.removeEventListener('keydown', press);
  }, []);

  const pixelOf = (event: { clientX: number }) => event.clientX - (track.current?.getBoundingClientRect().left ?? 0);
  const timeOf = (event: { clientX: number }) => Math.round(clamp(pixelToTime(current, pixelOf(event)), 0, durationMs));

  const begin = (event: ReactPointerEvent, kind: Drag['kind'], annotation?: Annotation) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    track.current?.setPointerCapture(event.pointerId);
    drag.current = { kind, originPixel: pixelOf(event), originView: current, annotation };
  };

  const pressBackground = (event: ReactPointerEvent) => {
    if (mode === 'zoom') {
      setView(zoomAt(current, pixelOf(event), event.ctrlKey || event.metaKey ? 0.5 : 2, durationMs, width));
    } else if (mode === 'pan') begin(event, 'pan');
    else if (mode === 'select') begin(event, 'range');
    else { begin(event, 'seek'); properties.onSeek(timeOf(event)); }
  };

  const draggedRange = (state: Drag, event: { clientX: number }) => {
    const annotation = state.annotation!;
    const shift = Math.round(((pixelOf(event) - state.originPixel) / current.pixelsPerSecond) * 1000);
    if (state.kind === 'start') return { id: annotation.id, startMs: clamp(annotation.startMs + shift, 0, annotation.endMs), endMs: annotation.endMs };
    if (state.kind === 'end') return { id: annotation.id, startMs: annotation.startMs, endMs: clamp(annotation.endMs + shift, annotation.startMs, durationMs) };
    const moved = clamp(shift, -annotation.startMs, Math.max(0, durationMs - annotation.endMs));
    return { id: annotation.id, startMs: annotation.startMs + moved, endMs: annotation.endMs + moved };
  };

  const move = (event: ReactPointerEvent) => {
    const state = drag.current;
    if (!state) return;
    if (state.kind === 'seek') properties.onSeek(timeOf(event));
    else if (state.kind === 'pan') setView(constrainViewport({ ...state.originView, startMs: state.originView.startMs - ((pixelOf(event) - state.originPixel) / current.pixelsPerSecond) * 1000 }, durationMs, width));
    else if (state.kind === 'range') {
      const origin = Math.round(clamp(pixelToTime(current, state.originPixel), 0, durationMs));
      properties.onRange(Math.min(origin, timeOf(event)), Math.max(origin, timeOf(event)));
    } else if (Math.abs(pixelOf(event) - state.originPixel) > 3) setPreview(draggedRange(state, event));
  };

  const release = (event: ReactPointerEvent) => {
    const state = drag.current;
    drag.current = null;
    if (state?.annotation && preview) {
      const range = draggedRange(state, event);
      properties.onResize(state.annotation, range.startMs, range.endMs);
    }
    setPreview(null);
  };

  const zoomButton = (factor: number) => setView(zoomAt(current, clamp(timeToPixel(current, timeMs), 0, width), factor, durationMs, width));

  useEffect(() => { keyZoom.current = zoomButton; });

  const finishRename = () => {
    const layer = layers.find((entry) => entry.id === renaming?.id);
    if (layer && renaming?.title.trim() && renaming.title.trim() !== layer.title) properties.onRenameLayer(layer, renaming.title.trim());
    setRenaming(null);
  };

  const marker = (time: number | null, colour: string, label: string) => time !== null && (
    <div className="pointer-events-none absolute inset-y-0 z-20" style={{ left: timeToPixel(current, time) }}>
      <div className={`h-full w-0.5 ${colour}`} />
      <span className={`absolute top-0 left-0.5 rounded-sm px-1 text-[10px] font-bold text-black ${colour}`}>{label}</span>
    </div>
  );

  const iconButton = 'rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30';

  return (
    <section aria-label="Timeline" className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-2 py-1">
        <div role="radiogroup" aria-label="Timeline mode" className="flex gap-0.5">
          {MODES.map((entry) => (
            <button key={entry.id} type="button" role="radio" aria-checked={mode === entry.id} title={entry.label} aria-label={entry.label} onClick={() => setMode(entry.id)}
              className={`rounded p-1.5 ${mode === entry.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}>
              <MdiIcon path={entry.icon} size={18} />
            </button>
          ))}
        </div>
        <button type="button" className={iconButton} title="Zoom out (-)" aria-label="Zoom out" onClick={() => zoomButton(0.5)}><IconMinus size={16} /></button>
        <button type="button" className={iconButton} title="Zoom in (+)" aria-label="Zoom in" onClick={() => zoomButton(2)}><IconPlus size={16} /></button>
        <button type="button" className={iconButton} title="Show the whole recording" aria-label="Show the whole recording" onClick={() => setView(null)}><IconArrowsHorizontal size={16} /></button>
        <span className="text-[11px] text-muted-foreground">Ctrl + wheel zooms, Shift + wheel scrolls</span>
        {!readOnly && (
          <button type="button" onClick={properties.onAddLayer} className="ml-auto inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent">
            <IconPlus size={14} /> Add timeline
          </button>
        )}
      </div>

      <div className="flex max-h-[34vh] overflow-y-auto">
        <div className="shrink-0 border-r border-border" style={{ width: LABEL_WIDTH }}>
          <div className="h-6 border-b border-border" />
          {layers.map((layer, index) => {
            const height = stackLanes(annotations.filter((entry) => entry.layerId === layer.id)).count * LANE_HEIGHT + 8;
            return (
              <div key={layer.id} style={{ height }} className={`group flex items-center gap-1 border-b border-border/60 px-2 ${layer.id === activeLayerId ? 'bg-primary/15' : ''}`}>
                <input type="radio" name="active-layer" checked={layer.id === activeLayerId} onChange={() => properties.onActivateLayer(layer.id)} aria-label={`Work in ${layer.title}`} />
                {renaming?.id === layer.id ? (
                  <input autoFocus value={renaming.title} maxLength={120} onChange={(event) => setRenaming({ id: layer.id, title: event.target.value })} onBlur={finishRename}
                    onKeyDown={(event) => { if (event.key === 'Enter') finishRename(); if (event.key === 'Escape') setRenaming(null); }}
                    className="min-w-0 flex-1 rounded border border-primary bg-background px-1 text-xs" />
                ) : confirming === layer.id ? (
                  <span className="flex min-w-0 flex-1 items-center gap-1 text-xs">
                    <button type="button" className="rounded bg-destructive px-1.5 py-0.5 text-white" onClick={() => { setConfirming(null); properties.onDeleteLayer(layer); }}>Delete</button>
                    <button type="button" className="rounded border border-border px-1.5 py-0.5" onClick={() => setConfirming(null)}>Keep</button>
                  </span>
                ) : (
                  <button type="button" title={layer.title} onClick={() => properties.onActivateLayer(layer.id)} className="min-w-0 flex-1 truncate text-left text-xs">{layer.title}</button>
                )}
                {!readOnly && !renaming && confirming !== layer.id && (
                  <span className="hidden group-focus-within:flex group-hover:flex">
                    <button type="button" className={iconButton} aria-label={`Rename ${layer.title}`} title="Rename" onClick={() => setRenaming({ id: layer.id, title: layer.title })}><IconPencil size={13} /></button>
                    <button type="button" className={iconButton} aria-label={`Move ${layer.title} up`} title="Move up" disabled={index === 0} onClick={() => properties.onMoveLayer(layer, index - 1)}><IconArrowUp size={13} /></button>
                    <button type="button" className={iconButton} aria-label={`Move ${layer.title} down`} title="Move down" disabled={index === layers.length - 1} onClick={() => properties.onMoveLayer(layer, index + 1)}><IconArrowDown size={13} /></button>
                    <button type="button" className={iconButton} aria-label={`Delete ${layer.title}`} title="Delete timeline and its annotations" disabled={layers.length === 1} onClick={() => setConfirming(layer.id)}><IconTrash size={13} /></button>
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div ref={track} onPointerDown={pressBackground} onPointerMove={move} onPointerUp={release} onPointerCancel={() => { drag.current = null; setPreview(null); }}
          className={`relative min-w-0 flex-1 touch-none select-none overflow-hidden ${mode === 'pan' ? 'cursor-grab' : mode === 'zoom' ? 'cursor-zoom-in' : mode === 'select' ? 'cursor-crosshair' : 'cursor-default'}`}>
          <div className="relative h-6 border-b border-border">
            {rulerTicks(current, width).map((tick) => (
              <span key={tick} className="absolute top-0 h-full border-l border-border pl-1 font-mono text-[10px] leading-6 text-muted-foreground" style={{ left: timeToPixel(current, tick) }}>
                {formatTime(tick, tick % 1000 !== 0)}
              </span>
            ))}
          </div>
          {layers.map((layer) => {
            const own = annotations.filter((entry) => entry.layerId === layer.id);
            const { lanes, count } = stackLanes(own);
            return (
              <div key={layer.id} style={{ height: count * LANE_HEIGHT + 8 }} onPointerDown={() => properties.onActivateLayer(layer.id)}
                className={`relative border-b border-border/60 ${layer.id === activeLayerId ? 'bg-primary/10' : ''}`}>
                {own.map((annotation) => {
                  const shown = preview?.id === annotation.id ? preview : annotation;
                  const left = timeToPixel(current, shown.startMs);
                  const blockWidth = Math.max(4, timeToPixel(current, shown.endMs) - left);
                  if (left > width || left + blockWidth < 0) return null;
                  const style = PROVENANCE_STYLES[provenanceOf(annotation)];
                  const selected = annotation.id === selectedId;
                  // Long blocks keep their label visible after scrolling.
                  const hidden = Math.max(0, -left);
                  return (
                    <div key={annotation.id} role="button" tabIndex={0} aria-pressed={selected}
                      title={`${annotation.text || 'No text yet'}\n${formatTime(shown.startMs, true)} to ${formatTime(shown.endMs, true)}\n${provenanceLabel(annotation)}`}
                      onKeyDown={(event) => { if (event.key === 'Enter') properties.onSelect(annotation); }}
                      onPointerDown={(event) => {
                        if (mode !== 'cursor') return;
                        properties.onSelect(annotation);
                        if (readOnly) event.stopPropagation(); else begin(event, 'move', annotation);
                      }}
                      className={`absolute flex items-center overflow-hidden rounded border text-[11px] ${style.block} ${selected ? 'z-10 ring-2 ring-white' : ''}`}
                      style={{ left, width: blockWidth, top: lanes.get(annotation.id)! * LANE_HEIGHT + 4, height: LANE_HEIGHT - 4 }}>
                      <span className="flex min-w-0 items-center gap-1 px-1.5" style={{ marginLeft: hidden }}>
                        <style.icon size={12} className={`shrink-0 ${style.text}`} />
                        <span className="truncate">{annotation.text}</span>
                      </span>
                      {!readOnly && mode === 'cursor' && (['start', 'end'] as const).map((edge) => (
                        <span key={edge} onPointerDown={(event) => { properties.onSelect(annotation); begin(event, edge, annotation); }}
                          className={`absolute inset-y-0 w-1.5 cursor-ew-resize hover:bg-white/60 ${edge === 'start' ? 'left-0' : 'right-0'}`} />
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {rangeA !== null && rangeB !== null && rangeB > rangeA && (
            <div className="pointer-events-none absolute inset-y-0 bg-white/10" style={{ left: timeToPixel(current, rangeA), width: timeToPixel(current, rangeB) - timeToPixel(current, rangeA) }} />
          )}
          {marker(rangeA, 'bg-red-400', 'A')}
          {marker(rangeB, 'bg-green-400', 'B')}
          <div className="pointer-events-none absolute inset-y-0 z-30 w-0.5 bg-amber-300" style={{ left: timeToPixel(current, timeMs) }} />
        </div>
      </div>
    </section>
  );
}
