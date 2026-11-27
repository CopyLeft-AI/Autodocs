// External
import { describe, expect, test } from 'bun:test';

// Ours
import type { Recording } from '../app/lib/cast/parse';
import { colourText } from '../app/lib/terminal/ansi';
import { ReplayEngine } from '../app/lib/terminal/replay';
import { paletteColour, type Screen } from '../app/lib/terminal/screen';

function recording(...events: Array<[number, string]>): Recording {
  return { version: 2, columns: 20, rows: 4, header: {}, skippedLines: 0, durationMs: events.at(-1)?.[0] ?? 0, events: events.map(([timeMs, data]) => ({ timeMs, code: 'o', data })) };
}

const text = (screen: Screen): string[] => screen.rows.map((row) => row.map((run) => run.text).join('').trimEnd());
const lit = (screen: Screen): string[] => screen.rows.map((row) => row.filter((run) => !run.muted).map((run) => run.text).join('').trim());

describe('replay', () => {
  const source = recording([100, '$ ls\r\n'], [200, '\x1b[31mred\x1b[0m\r\n'], [300, '$ pwd\r\n'], [400, '/tmp\r\n'], [500, 'end\r\n']);

  test('shows the screen at a time, forwards and backwards', async () => {
    const engine = new ReplayEngine(source);
    expect(text(await engine.screenAt(200))).toEqual(['$ ls', 'red', '', '']);
    expect(text(await engine.screenAt(500))).toEqual(['$ pwd', '/tmp', 'end', '']);
    expect(text(await engine.screenAt(100))).toEqual(['$ ls', '', '', '']);
    expect((await engine.screenAt(200)).rows[1][0].foreground).toBe(paletteColour(1));
  });

  test('focus mutes everything the selected event did not write, through scrolling', async () => {
    const engine = new ReplayEngine(source);
    const range = { startMs: 300, endMs: 400 };
    expect(lit(await engine.screenAt(200, range)).join('')).toBe('');
    expect(lit(await engine.screenAt(400, range))).toEqual(['', '$ pwd', '/tmp', '']);
    // Output after the event scrolls the screen but stays muted.
    expect(lit(await engine.screenAt(500, range))).toEqual(['$ pwd', '/tmp', '', '']);
    expect(lit(await engine.screenAt(500, { startMs: 500, endMs: 500 }))).toEqual(['', '', 'end', '']);
  });

  test('text redrawn identically by the event counts as written by it', async () => {
    const engine = new ReplayEngine(recording([1, 'same'], [2, '\rsame']));
    expect(lit(await engine.screenAt(2, { startMs: 2, endMs: 2 }))[0]).toBe('same');
  });

  test('overlapping calls are safe and an empty recording renders blank', async () => {
    const engine = new ReplayEngine(source);
    const [first, second] = await Promise.all([engine.screenAt(500), engine.screenAt(100)]);
    expect([text(first)[2], text(second)[0]]).toEqual(['end', '$ ls']);
    expect(text(await new ReplayEngine(recording()).screenAt(0))).toEqual(['', '', '', '']);
  });
});

describe('colouring event text', () => {
  test('colours become styles and other sequences disappear', () => {
    const { lines, style } = colourText('\x1b]0;title\x07\x1b[1;32mok\x1b[0m\x1b[2K done\r\n\x1b[38;5;196mx\x1b[38;2;1;2;3my');
    expect(lines).toEqual([
      [{ text: 'ok', bold: true, foreground: paletteColour(2) }, { text: ' done' }],
      [{ text: 'x', foreground: paletteColour(196) }, { text: 'y', foreground: '#010203' }],
    ]);
    expect(style).toEqual({ foreground: '#010203' });
  });

  test('truncated sequences do not leak into the text', () => {
    expect(colourText('a\x1b[3').lines.flat().map((run) => run.text).join('')).not.toContain('\x1b');
  });
});
