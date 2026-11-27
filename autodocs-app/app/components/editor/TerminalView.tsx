"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Recording } from '@/app/lib/cast/parse';
import { ReplayEngine, type FocusRange } from '@/app/lib/terminal/replay';
import type { Screen } from '@/app/lib/terminal/screen';
import { TerminalLine } from './TerminalLine';

/** Width of one character relative to the font size in common monospace fonts. */
const CHARACTER_ASPECT = 0.602;

interface TerminalViewProps {
  recording: Recording;
  timeMs: number;
  focus: FocusRange | null;
  /** Hide muted text completely instead of dimming it. */
  hideMuted: boolean;
}

/** The terminal at the playhead, scaled to the width of its container. */
export function TerminalView({ recording, timeMs, focus, hideMuted }: TerminalViewProps) {
  const engine = useMemo(() => new ReplayEngine(recording), [recording]);
  const [screen, setScreen] = useState<Screen | null>(null);
  const [fontSize, setFontSize] = useState(13);
  const container = useRef<HTMLDivElement>(null);
  const latest = useRef(0);
  const focusStart = focus?.startMs;
  const focusEnd = focus?.endMs;

  useEffect(() => () => engine.dispose(), [engine]);

  useEffect(() => {
    const ticket = ++latest.current;
    const range = focusStart === undefined || focusEnd === undefined ? null : { startMs: focusStart, endMs: focusEnd };
    engine.screenAt(timeMs, range)
      .then((next) => { if (ticket === latest.current) setScreen(next); })
      .catch((error: unknown) => console.error('Could not render the terminal at', timeMs, error));
  }, [engine, timeMs, focusStart, focusEnd]);

  const columns = screen?.columns ?? recording.columns;
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setFontSize(Math.max(5, Math.min(16, (element.clientWidth - 24) / (columns * CHARACTER_ASPECT)))));
    observer.observe(element);
    return () => observer.disconnect();
  }, [columns]);

  return (
    <div ref={container} className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-[#0b1120] p-3">
      <div className="w-max font-mono leading-[1.25] text-[#d5dde9]" style={{ fontSize }} role="img" aria-label="Terminal replay">
        {screen?.rows.map((runs, row) => (
          <TerminalLine key={row} runs={runs} mutedOpacity={hideMuted ? 0 : 0.18} cursorColumn={!focus && row === screen.cursor.row ? screen.cursor.column : undefined} />
        ))}
      </div>
    </div>
  );
}
