// External
import { describe, expect, test } from 'bun:test';

// Ours
import type { Annotation } from '../app/lib/annotations/types';
import { commandFor } from '../app/lib/editor/shortcuts';
import { annotationAt, fitViewport, follow, formatTime, neighbourKeyframe, outlineLevels, parseTime, pixelToTime, rulerTicks, skipInactivity, stackLanes, zoomAt } from '../app/lib/editor/timeline';

const note = (id: string, startMs: number, endMs: number): Annotation => ({ id, layerId: 'l', startMs, endMs } as Annotation);
const events = [0, 1000, 20_000, 21_000, 60_000].map((timeMs) => ({ timeMs, code: 'o', data: '' }));

describe('viewport', () => {
  test('zooming keeps the time under the pointer and never leaves the recording', () => {
    const view = fitViewport(100_000, 1000);
    const zoomed = zoomAt(view, 500, 4, 100_000, 1000);
    expect(pixelToTime(zoomed, 500)).toBe(50_000);
    expect(zoomAt(zoomed, 0, 0.001, 100_000, 1000)).toEqual(view);
    expect(follow(zoomed, 90_000, 100_000, 1000).startMs).toBe(75_000);
    expect(follow(zoomed, 50_000, 100_000, 1000)).toBe(zoomed);
    expect(rulerTicks(view, 1000)).toContain(30_000);
  });
});

describe('time text', () => {
  test('formats and parses', () => {
    expect([formatTime(3_723_400, true), formatTime(65_000)]).toEqual(['1:02:03.4', '1:05']);
    expect([parseTime('90.5'), parseTime('1:05'), parseTime('1:00:00'), parseTime('x'), parseTime('')]).toEqual([90_500, 65_000, 3_600_000, null, null]);
  });
});

describe('navigation', () => {
  test('skips to where activity resumes', () => {
    expect(skipInactivity(events, 0, 1, 60_000)).toBe(20_000);
    expect(skipInactivity(events, 30_000, -1, 60_000)).toBe(20_000);
    expect(skipInactivity(events, 20_000, -1, 60_000)).toBe(0);
    expect(skipInactivity([], 0, 1, 5)).toBe(5);
  });

  test('finds keyframes and the annotation under the playhead', () => {
    const notes = [note('a', 0, 100), note('b', 50, 70)];
    expect([neighbourKeyframe(notes, 50, 1), neighbourKeyframe(notes, 50, -1), neighbourKeyframe(notes, 100, 1)]).toEqual([70, 0, null]);
    expect(annotationAt(notes, 'l', 60)?.id).toBe('b');
    expect(annotationAt(notes, 'l', 200)).toBeNull();
  });

  test('stacks overlaps and indents by hierarchy', () => {
    expect(stackLanes([note('a', 0, 100), note('b', 50, 70), note('c', 101, 120)]).count).toBe(2);
    expect(outlineLevels([{ depth: -1 }, { depth: -1 }, { depth: 2 }, { depth: 0 }, { depth: 5 }, { depth: null }])).toEqual([0, 1, 2, 0, 0, 0]);
  });
});

describe('shortcuts', () => {
  const press = (key: string, ctrlKey = false) => commandFor({ key, ctrlKey, metaKey: false, altKey: false });
  test('keep the earlier annotator keys and leave browser shortcuts alone', () => {
    expect([press('A'), press('c'), press(' '), press('End'), press('ArrowLeft', true), press('ArrowUp')]).toEqual(['setA', 'create', 'toggle', 'toEnd', 'inactivityBack', 'previousKeyframe']);
    expect([press('c', true), press('s', true), press('ArrowLeft'), press('x')]).toEqual([null, null, null, null]);
  });
});
