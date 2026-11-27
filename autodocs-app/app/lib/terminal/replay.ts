/**
 * Replays a recording on a headless terminal emulator and reports the screen at
 * any time. With a focus range, a second emulator is wiped when the range starts
 * and then receives only the range's output: whatever it shows was written by
 * the selected event, everything else is muted. After the range, later output
 * reaches it as blanks, so it scrolls and erases like the real screen.
 */
import { Terminal, type IBufferCell } from '@xterm/headless';
import type { CastEvent, Recording } from '../cast/parse';
import { blankPrintable } from './ansi';
import { appendRun, paletteColour, rgbColour, type Run, type Screen } from './screen';

export interface FocusRange { startMs: number; endMs: number; }

function write(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}

/** Erase both visible screen and nothing else: cursor, colours and modes stay. */
const WIPE = '\x1b[2J';

class Emulator {
  readonly terminal: Terminal;

  constructor(columns: number, rows: number) {
    this.terminal = new Terminal({ cols: columns, rows, allowProposedApi: true, scrollback: 0 });
  }

  async apply(events: CastEvent[]): Promise<void> {
    let pending = '';
    for (const event of events) {
      if (event.code === 'o') pending += event.data;
      if (event.code !== 'r') continue;
      const [columns, rows] = event.data.split('x').map(Number);
      if (!(columns > 0 && rows > 0)) continue;
      await write(this.terminal, pending);
      pending = '';
      this.terminal.resize(Math.min(columns, 1000), Math.min(rows, 1000));
    }
    if (pending) await write(this.terminal, pending);
  }
}

function cellRun(cell: IBufferCell): Run {
  const run: Run = { text: cell.getChars() || ' ' };
  if (cell.isFgPalette()) run.foreground = paletteColour(cell.getFgColor());
  else if (cell.isFgRGB()) run.foreground = rgbColour(cell.getFgColor());
  if (cell.isBgPalette()) run.background = paletteColour(cell.getBgColor());
  else if (cell.isBgRGB()) run.background = rgbColour(cell.getBgColor());
  if (cell.isBold()) run.bold = true;
  if (cell.isDim()) run.dim = true;
  if (cell.isItalic()) run.italic = true;
  if (cell.isUnderline()) run.underline = true;
  if (cell.isStrikethrough()) run.strikethrough = true;
  if (cell.isInverse()) run.inverse = true;
  return run;
}

export class ReplayEngine {
  private full: Emulator;
  private focused: Emulator | null = null;
  private applied = 0;
  private focus: FocusRange | null = null;
  private unfinished = '';
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly recording: Recording) {
    this.full = new Emulator(recording.columns, recording.rows);
  }

  /** The screen at `timeMs`. Calls are serialized, so callers may overlap. */
  screenAt(timeMs: number, focus: FocusRange | null = null): Promise<Screen> {
    const next = this.queue.then(() => this.render(timeMs, focus));
    this.queue = next.catch(() => undefined);
    return next;
  }

  dispose(): void {
    this.full.terminal.dispose();
    this.focused?.terminal.dispose();
  }

  private reset(): void {
    this.dispose();
    this.full = new Emulator(this.recording.columns, this.recording.rows);
    this.focused = null;
    this.applied = 0;
    this.unfinished = '';
  }

  /** Number of events at or before `timeMs`. */
  private countUntil(timeMs: number): number {
    const events = this.recording.events;
    let low = 0;
    let high = events.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (events[middle].timeMs <= timeMs) low = middle + 1; else high = middle;
    }
    return low;
  }

  private async render(timeMs: number, focus: FocusRange | null): Promise<Screen> {
    const target = this.countUntil(timeMs);
    const focusChanged = focus?.startMs !== this.focus?.startMs || focus?.endMs !== this.focus?.endMs;
    if (focusChanged || target < this.applied) this.reset();
    this.focus = focus;
    if (focus) {
      const first = this.countUntil(focus.startMs - 1);
      const last = this.countUntil(focus.endMs);
      if (!this.focused && target > first) {
        await this.advance(first);
        this.focused = new Emulator(this.recording.columns, this.recording.rows);
        // Bring the second emulator to the same state, then blank it.
        await this.focused.apply(this.recording.events.slice(0, first));
        await this.focused.apply([{ timeMs: focus.startMs, code: 'o', data: WIPE }]);
      }
      if (this.focused) {
        const from = Math.max(this.applied, first);
        const own = Math.max(from, Math.min(target, last));
        await this.focused.apply(this.recording.events.slice(from, own));
        await this.focused.apply(this.blanked(this.recording.events.slice(own, target)));
      }
    }
    await this.advance(target);
    return this.snapshot(focus !== null);
  }

  private blanked(events: CastEvent[]): CastEvent[] {
    return events.map((event) => {
      if (event.code !== 'o') return event;
      const { data, rest } = blankPrintable(this.unfinished + event.data);
      this.unfinished = rest;
      return { ...event, data };
    });
  }

  private async advance(target: number): Promise<void> {
    if (target <= this.applied) return;
    await this.full.apply(this.recording.events.slice(this.applied, target));
    this.applied = target;
  }

  private snapshot(focusing: boolean): Screen {
    const { terminal } = this.full;
    const buffer = terminal.buffer.active;
    const mask = this.focused?.terminal.buffer.active;
    const rows: Run[][] = [];
    for (let y = 0; y < terminal.rows; y++) {
      const line = buffer.getLine(buffer.baseY + y);
      const written = mask?.getLine(mask.baseY + y);
      const row: Run[] = [];
      for (let x = 0; line && x < terminal.cols; x++) {
        const cell = line.getCell(x);
        // Width 0 is the second half of a wide character.
        if (!cell || cell.getWidth() === 0) continue;
        const run = cellRun(cell);
        if (focusing) {
          const own = written?.getCell(x);
          run.muted = !own || own.getChars() === '' || own.getChars() !== cell.getChars();
        }
        appendRun(row, run);
      }
      rows.push(row);
    }
    return { rows, columns: terminal.cols, cursor: { column: buffer.cursorX, row: buffer.cursorY } };
  }
}
