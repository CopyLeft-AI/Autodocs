"use client";

import { useMemo, useState } from 'react';
import type { CastEvent } from '@/app/lib/cast/parse';
import { formatTime } from '@/app/lib/editor/timeline';
import { colourText } from '@/app/lib/terminal/ansi';
import type { Run, TextStyle } from '@/app/lib/terminal/screen';
import { TerminalLine } from './TerminalLine';

/** Blocks shown at once; very long events say how much is left out. */
const MAX_CHARACTERS = 200_000;

interface Block { tag: 'user_input' | 'system_output'; timeMs: number; raw: string; lines: Run[][]; }

/** Consecutive events of one kind form one block; colours carry across output blocks. */
function buildBlocks(events: CastEvent[]): { blocks: Block[]; omitted: number } {
  const merged: Array<Omit<Block, 'lines'>> = [];
  let used = 0;
  let omitted = 0;
  for (const event of events) {
    if (event.code !== 'i' && event.code !== 'o') continue;
    if (used >= MAX_CHARACTERS) { omitted++; continue; }
    used += event.data.length;
    const tag = event.code === 'i' ? 'user_input' : 'system_output';
    const last = merged.at(-1);
    if (last?.tag === tag) last.raw += event.data;
    else merged.push({ tag, timeMs: event.timeMs, raw: event.data });
  }
  let style: TextStyle = {};
  const blocks = merged.map((block) => {
    // Typed keys are shown readably; Enter and escape keys would otherwise be invisible.
    const text = block.tag === 'user_input'
      ? block.raw.replaceAll('\r', '⏎\n').replaceAll('\t', '⇥').replaceAll('\x7f', '⌫').replaceAll('\x1b', '⎋')
      : block.raw;
    const coloured = colourText(text, block.tag === 'user_input' ? {} : style);
    if (block.tag === 'system_output') style = coloured.style;
    return { ...block, lines: coloured.lines };
  });
  return { blocks, omitted };
}

const escapeXml = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function Tag({ name, time, closing }: { name: string; time?: number; closing?: boolean }) {
  return (
    <div className="font-mono text-[11px] text-sky-400/80">
      &lt;{closing ? '/' : ''}<span className="text-sky-300">{name}</span>
      {time !== undefined && <> <span className="text-slate-400">timestamp</span>=<span className="text-amber-300/90">&quot;{time / 1000}&quot;</span> <span className="text-slate-500">at {formatTime(time, true)}</span></>}
      &gt;
    </div>
  );
}

/** The selected event as XML, with the terminal's colours inside the elements. */
export function EventContent({ events }: { events: CastEvent[] }) {
  const { blocks, omitted } = useMemo(() => buildBlocks(events), [events]);
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');

  if (blocks.length === 0) return <p className="text-sm text-muted-foreground">No terminal input or output in this range.</p>;

  const copy = async () => {
    const xml = ['<event>', ...blocks.map((block) => `  <${block.tag} timestamp="${block.timeMs / 1000}">${escapeXml(block.raw)}</${block.tag}>`), '</event>'].join('\n');
    try { await navigator.clipboard.writeText(xml); setCopied('copied'); } catch { setCopied('failed'); }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Tag name="event" />
        <button type="button" onClick={() => void copy()} className="rounded border border-border px-2 py-1 text-xs hover:bg-accent">
          {copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy XML'}
        </button>
      </div>
      {blocks.map((block, index) => (
        <div key={index} className={`ml-2 rounded border-l-2 pl-2 ${block.tag === 'user_input' ? 'border-emerald-400/60' : 'border-sky-400/40'}`}>
          <Tag name={block.tag} time={block.timeMs} />
          <div className="overflow-x-auto rounded bg-[#0b1120] p-2 font-mono text-xs leading-[1.25] text-[#d5dde9]">
            {block.lines.map((runs, line) => <TerminalLine key={line} runs={runs} />)}
          </div>
          <Tag name={block.tag} closing />
        </div>
      ))}
      {omitted > 0 && <p className="text-xs text-muted-foreground">{omitted} more terminal events are not shown.</p>}
      <Tag name="event" closing />
    </div>
  );
}
