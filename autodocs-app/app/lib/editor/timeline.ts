/** Pure calculations of the annotation timeline and the transport controls. */
import type { CastEvent } from '../cast/parse';
import type { Annotation, AnnotationLayer } from '../annotations/types';

export const MIN_PIXELS_PER_SECOND = 0.01;
export const MAX_PIXELS_PER_SECOND = 2000;
export const INACTIVITY_MS = 10_000;

export interface Viewport {
  /** Time at the left edge. */
  startMs: number;
  pixelsPerSecond: number;
}

export const timeToPixel = (view: Viewport, timeMs: number): number => ((timeMs - view.startMs) / 1000) * view.pixelsPerSecond;

export const pixelToTime = (view: Viewport, pixel: number): number => view.startMs + (pixel / view.pixelsPerSecond) * 1000;

export const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/** The viewport showing the whole recording in `width` pixels. */
export function fitViewport(durationMs: number, width: number): Viewport {
  const seconds = Math.max(durationMs / 1000, 1);
  return { startMs: 0, pixelsPerSecond: clamp(width / seconds, MIN_PIXELS_PER_SECOND, MAX_PIXELS_PER_SECOND) };
}

/** Keep the view inside the recording. */
export function constrainViewport(view: Viewport, durationMs: number, width: number): Viewport {
  const visibleMs = (width / view.pixelsPerSecond) * 1000;
  return { ...view, startMs: clamp(view.startMs, 0, Math.max(0, durationMs - visibleMs)) };
}

/** Zoom by `factor` while the time under `pixel` stays where it is. */
export function zoomAt(view: Viewport, pixel: number, factor: number, durationMs: number, width: number): Viewport {
  const minimum = Math.min(fitViewport(durationMs, width).pixelsPerSecond, view.pixelsPerSecond);
  const pixelsPerSecond = clamp(view.pixelsPerSecond * factor, minimum, MAX_PIXELS_PER_SECOND);
  const anchor = pixelToTime(view, pixel);
  return constrainViewport({ pixelsPerSecond, startMs: anchor - (pixel / pixelsPerSecond) * 1000 }, durationMs, width);
}

/** Scroll so that `timeMs` is visible, without moving when it already is. */
export function follow(view: Viewport, timeMs: number, durationMs: number, width: number): Viewport {
  const pixel = timeToPixel(view, timeMs);
  if (pixel >= 0 && pixel <= width) return view;
  return constrainViewport({ ...view, startMs: timeMs - ((width * 0.1) / view.pixelsPerSecond) * 1000 }, durationMs, width);
}

const TICK_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600, 86400];

/** Ruler marks at a readable spacing. */
export function rulerTicks(view: Viewport, width: number, minimumSpacing = 90): number[] {
  const step = (TICK_STEPS.find((seconds) => seconds * view.pixelsPerSecond >= minimumSpacing) ?? TICK_STEPS.at(-1)!) * 1000;
  const ticks: number[] = [];
  for (let time = Math.ceil(view.startMs / step) * step; time <= pixelToTime(view, width); time += step) ticks.push(Math.round(time));
  return ticks;
}

/** `m:ss`, `h:mm:ss`, with tenths when asked. */
export function formatTime(timeMs: number, tenths = false): string {
  const total = Math.max(0, Math.round(timeMs / 100)) / 10;
  const whole = Math.floor(total);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = String(whole % 60).padStart(2, '0');
  const base = hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
  return tenths ? `${base}.${Math.round((total - whole) * 10) % 10}` : base;
}

/** Accepts seconds ("90.5"), "m:ss" or "h:mm:ss"; null when unreadable. */
export function parseTime(text: string): number | null {
  const parts = text.trim().split(':');
  if (parts.length > 3 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part.trim()))) return null;
  return Math.round(parts.reduce((total, part) => total * 60 + Number(part), 0) * 1000);
}

/**
 * Where "skip inactivity" goes: past the next (or previous) pause of at least
 * `threshold` without terminal activity. Falls back to the end or the start.
 */
export function skipInactivity(events: CastEvent[], timeMs: number, direction: 1 | -1, durationMs: number, threshold = INACTIVITY_MS): number {
  const resumes: number[] = [];
  for (let index = 1; index < events.length; index++) {
    if (events[index].timeMs - events[index - 1].timeMs >= threshold) resumes.push(events[index].timeMs);
  }
  if (direction === 1) return resumes.find((time) => time > timeMs) ?? durationMs;
  return resumes.findLast((time) => time < timeMs - 500) ?? 0;
}

/** The next or previous annotation start or end around `timeMs`. */
export function neighbourKeyframe(annotations: Annotation[], timeMs: number, direction: 1 | -1): number | null {
  const frames = [...new Set(annotations.flatMap((annotation) => [annotation.startMs, annotation.endMs]))].sort((a, b) => a - b);
  return (direction === 1 ? frames.find((time) => time > timeMs) : frames.findLast((time) => time < timeMs)) ?? null;
}

/** The annotation of a layer at `timeMs`; the latest-starting one when several overlap. */
export function annotationAt(annotations: Annotation[], layerId: string, timeMs: number): Annotation | null {
  return annotations
    .filter((annotation) => annotation.layerId === layerId && annotation.startMs <= timeMs && timeMs <= annotation.endMs)
    .reduce<Annotation | null>((best, annotation) => (!best || annotation.startMs >= best.startMs ? annotation : best), null);
}

/** Split overlapping annotations of one layer onto separate lines. */
export function stackLanes(annotations: Annotation[]): { lanes: Map<string, number>; count: number } {
  const ends: number[] = [];
  const lanes = new Map<string, number>();
  for (const annotation of [...annotations].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)) {
    let lane = ends.findIndex((end) => end < annotation.startMs);
    if (lane < 0) lane = ends.length;
    ends[lane] = annotation.endMs;
    lanes.set(annotation.id, lane);
  }
  return { lanes, count: Math.max(1, ends.length) };
}

/**
 * Indentation of each annotation in a list, from the model's hierarchy marks:
 * -1 opens a level below itself, n > 0 closes n levels after itself.
 */
export function outlineLevels(annotations: Pick<Annotation, 'depth'>[]): number[] {
  let level = 0;
  return annotations.map(({ depth }) => {
    const own = level;
    if (depth === -1) level++;
    else if (depth !== null && depth > 0) level = Math.max(0, level - depth);
    return own;
  });
}

/** Layers in display order. */
export const sortLayers = (layers: AnnotationLayer[]): AnnotationLayer[] => [...layers].sort((a, b) => a.position - b.position);
