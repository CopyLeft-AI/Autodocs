import type { CSSProperties } from 'react';
import type { Run } from '@/app/lib/terminal/screen';

const BACKGROUND = '#0b1120';
const FOREGROUND = '#d5dde9';

function runStyle(run: Run, mutedOpacity: number): CSSProperties {
  const foreground = run.inverse ? run.background ?? BACKGROUND : run.foreground;
  const background = run.inverse ? run.foreground ?? FOREGROUND : run.background;
  const decorations = [run.underline && 'underline', run.strikethrough && 'line-through'].filter(Boolean).join(' ');
  return {
    color: foreground,
    backgroundColor: background,
    fontWeight: run.bold ? 700 : undefined,
    fontStyle: run.italic ? 'italic' : undefined,
    textDecoration: decorations || undefined,
    opacity: run.muted ? mutedOpacity : run.dim ? 0.65 : undefined,
    filter: run.muted ? 'grayscale(1)' : undefined,
  };
}

/** One line of terminal text with its colours. */
export function TerminalLine({ runs, mutedOpacity = 0.18, cursorColumn }: { runs: Run[]; mutedOpacity?: number; cursorColumn?: number }) {
  return (
    <div className="relative h-[1.25em] whitespace-pre">
      {runs.map((run, index) => <span key={index} style={runStyle(run, mutedOpacity)}>{run.text}</span>)}
      {cursorColumn !== undefined && <span className="absolute top-0 h-full w-[1ch] bg-slate-300/60" style={{ left: `${cursorColumn}ch` }} />}
    </div>
  );
}
