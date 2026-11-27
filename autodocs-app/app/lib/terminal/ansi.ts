/**
 * Colour the raw text of one terminal event: SGR (colour) sequences become
 * styles, every other escape sequence and control character is removed.
 */
import { appendRun, paletteColour, rgbColour, type Run, type TextStyle } from './screen';

// CSI, OSC, other string sequences, two-character escapes, then lone controls.
// eslint-disable-next-line no-control-regex
const SEQUENCE = /\x1b\[([0-?]*)[ -/]*([@-~])|\x1b\][\s\S]*?(?:\x07|\x1b\\|$)|\x1b[P^_X][\s\S]*?(?:\x1b\\|$)|\x1b[ -/]*[0-~]?|[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]|\r\n?/g;

function extendedColour(codes: number[], index: number): { colour?: string; used: number } {
  if (codes[index] === 5 && codes[index + 1] !== undefined) return { colour: paletteColour(codes[index + 1] & 255), used: 2 };
  if (codes[index] === 2 && codes[index + 3] !== undefined) return { colour: rgbColour(((codes[index + 1] & 255) << 16) | ((codes[index + 2] & 255) << 8) | (codes[index + 3] & 255)), used: 4 };
  return { used: codes.length };
}

/** Apply one SGR parameter string to a style, returning the new style. */
export function applySgr(style: TextStyle, parameters: string): TextStyle {
  const codes = parameters.split(/[;:]/).map((part) => Number(part) || 0);
  let next: TextStyle = { ...style };
  for (let index = 0; index < codes.length; index++) {
    const code = codes[index];
    if (code === 0) next = {};
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 7) next.inverse = true;
    else if (code === 9) next.strikethrough = true;
    else if (code === 22) { delete next.bold; delete next.dim; }
    else if (code === 23) delete next.italic;
    else if (code === 24) delete next.underline;
    else if (code === 27) delete next.inverse;
    else if (code === 29) delete next.strikethrough;
    else if (code >= 30 && code <= 37) next.foreground = paletteColour(code - 30);
    else if (code >= 90 && code <= 97) next.foreground = paletteColour(code - 82);
    else if (code >= 40 && code <= 47) next.background = paletteColour(code - 40);
    else if (code >= 100 && code <= 107) next.background = paletteColour(code - 92);
    else if (code === 39) delete next.foreground;
    else if (code === 49) delete next.background;
    else if (code === 38 || code === 48) {
      const { colour, used } = extendedColour(codes, index + 1);
      if (colour) next[code === 38 ? 'foreground' : 'background'] = colour;
      index += used;
    }
  }
  return next;
}

/**
 * Styled lines of `text`. `style` is the colour in force when the text starts;
 * the returned style is the one to carry into the following event.
 */
export function colourText(text: string, style: TextStyle = {}): { lines: Run[][]; style: TextStyle } {
  const lines: Run[][] = [[]];
  let current = style;
  const write = (plain: string): void => {
    plain.split('\n').forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part) appendRun(lines.at(-1)!, { ...current, text: part });
    });
  };
  let end = 0;
  for (const match of text.matchAll(SEQUENCE)) {
    write(text.slice(end, match.index));
    end = match.index + match[0].length;
    if (match[2] === 'm' && !/^[<=>?]/.test(match[1])) current = applySgr(current, match[1]);
    else if (match[0].startsWith('\r')) write('\n');
  }
  write(text.slice(end));
  return { lines, style: current };
}

// Escape sequences and controls stay; the lookahead keeps an unfinished sequence for the next chunk.
// eslint-disable-next-line no-control-regex
const TOKEN = /(\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][\s\S]*?(?:\x07|\x1b\\)|\x1b[P^_X][\s\S]*?\x1b\\|\x1b[ -/]*[0-OQ-WYZ\\`-~]|[\x00-\x1a\x1c-\x1f\x7f])|(\x1b[\s\S]*$)|([^\x00-\x1f\x7f]+)/g;

const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1f64f}\u{1f900}-\u{1f9ff}\u{20000}-\u{3fffd}]/u;

/** A private-use character that no real recording is expected to show. */
const BLANK = '\ue000';

/**
 * Replace printable characters with placeholders while keeping cursor movement,
 * scrolling and erasing. `rest` is an unfinished sequence to prepend next time.
 */
export function blankPrintable(data: string): { data: string; rest: string } {
  let output = '';
  let rest = '';
  for (const [, control, unfinished, printable] of data.matchAll(TOKEN)) {
    if (control) output += control;
    else if (unfinished) rest = unfinished;
    else for (const character of printable) output += WIDE.test(character) ? BLANK + BLANK : BLANK;
  }
  return { data: output, rest };
}
