/** A terminal screen as styled runs of text, independent of any emulator or UI. */

export interface TextStyle {
  /** CSS colours; undefined means the terminal default. */
  foreground?: string;
  background?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  inverse?: boolean;
}

export interface Run extends TextStyle {
  text: string;
  /** In focus mode: true when the selected event did not write this text. */
  muted?: boolean;
}

export interface Screen {
  rows: Run[][];
  columns: number;
  cursor: { column: number; row: number };
}

const BASE_COLOURS = [
  '#1f2733', '#e5646e', '#5fd38a', '#e8c268', '#5b9cf6', '#c283e8', '#4fcbd6', '#c9d1dc',
  '#5c6a80', '#ff8a93', '#8ef0ae', '#ffdd8a', '#8bbdff', '#dba8ff', '#82e9f2', '#ffffff',
];

const CUBE = [0, 95, 135, 175, 215, 255];

function hex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

/** The CSS colour of an xterm 256-colour palette index. */
export function paletteColour(index: number): string {
  if (index < 16) return BASE_COLOURS[index];
  if (index < 232) {
    const value = index - 16;
    return hex(CUBE[Math.floor(value / 36)], CUBE[Math.floor(value / 6) % 6], CUBE[value % 6]);
  }
  const grey = 8 + (index - 232) * 10;
  return hex(grey, grey, grey);
}

export const rgbColour = (value: number): string => hex((value >> 16) & 255, (value >> 8) & 255, value & 255);

const STYLE_KEYS = ['foreground', 'background', 'bold', 'dim', 'italic', 'underline', 'strikethrough', 'inverse', 'muted'] as const;

/** Add text to a row, merging it with the previous run when the style is the same. */
export function appendRun(row: Run[], run: Run): void {
  const last = row.at(-1);
  if (last && STYLE_KEYS.every((key) => last[key] === run[key])) last.text += run.text;
  else row.push({ ...run });
}
