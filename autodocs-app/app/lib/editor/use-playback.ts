"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { clamp } from './timeline';

export const SPEEDS = [0.5, 1, 2, 4, 8] as const;

/** The playhead: position, playing state and speed, advanced by animation frames. */
export function usePlayback(durationMs: number) {
  const [timeMs, setTimeMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const position = useRef(0);
  const stopAt = useRef<number | null>(null);

  const seek = useCallback((target: number) => {
    position.current = clamp(Math.round(target), 0, durationMs);
    stopAt.current = null;
    setTimeMs(position.current);
  }, [durationMs]);

  const pause = useCallback(() => setIsPlaying(false), []);

  /** Play from the playhead, or `from`, optionally stopping at `until`. */
  const play = useCallback((from?: number, until?: number) => {
    if (from !== undefined) seek(from);
    else if (position.current >= durationMs) seek(0);
    stopAt.current = until ?? null;
    setIsPlaying(true);
  }, [durationMs, seek]);

  const toggle = useCallback(() => (isPlaying ? pause() : play()), [isPlaying, pause, play]);

  useEffect(() => {
    if (!isPlaying) return;
    let previous = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const end = stopAt.current ?? durationMs;
      position.current = Math.min(end, position.current + (now - previous) * speed);
      previous = now;
      setTimeMs(Math.round(position.current));
      if (position.current >= end) { stopAt.current = null; setIsPlaying(false); return; }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, speed, durationMs]);

  return { timeMs, isPlaying, speed, setSpeed, seek, play, pause, toggle };
}

export type Playback = ReturnType<typeof usePlayback>;
