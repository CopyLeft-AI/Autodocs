/**
 * Read asciinema recordings (asciicast v1, v2 and v3) into one shape.
 * Times are always milliseconds from the start of the recording.
 */

export interface CastEvent {
  timeMs: number;
  /** 'o' output, 'i' input, 'r' resize, 'm' marker, 'x' exit. */
  code: string;
  data: string;
}

export interface Recording {
  version: number;
  columns: number;
  rows: number;
  header: Record<string, unknown>;
  events: CastEvent[];
  durationMs: number;
  /** Lines that were not valid events (for example a truncated last line). */
  skippedLines: number;
}

export type ParseResult = { ok: true; recording: Recording } | { ok: false; error: string };

const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;
const MAX_SIDE = 1000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return undefined; }
}

function side(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? Math.min(value, MAX_SIDE) : fallback;
}

function finish(partial: Omit<Recording, 'durationMs'>): ParseResult {
  const durationMs = partial.events.reduce((longest, event) => Math.max(longest, event.timeMs), 0);
  return { ok: true, recording: { ...partial, durationMs } };
}

/** asciicast v1: one JSON object with a `stdout` list of [delay, data]. */
function parseVersion1(document: Record<string, unknown>): ParseResult {
  if (!Array.isArray(document.stdout)) return { ok: false, error: 'The version 1 recording has no "stdout" list.' };
  let seconds = 0;
  let skippedLines = 0;
  const events: CastEvent[] = [];
  for (const entry of document.stdout) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'number' || typeof entry[1] !== 'string') { skippedLines++; continue; }
    seconds += entry[0];
    events.push({ timeMs: Math.round(seconds * 1000), code: 'o', data: entry[1] });
  }
  const { stdout: _stdout, ...header } = document;
  return finish({ version: 1, columns: side(document.width, DEFAULT_COLUMNS), rows: side(document.height, DEFAULT_ROWS), header, events, skippedLines });
}

/** Parse the text of a .cast file; never throws. */
export function parseCast(text: string): ParseResult {
  const lines = text.replace(/^﻿/, '').split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  if (lines.length === 0) return { ok: false, error: 'The recording is empty.' };

  const header = asRecord(parseJson(lines[0]));
  if (!header || typeof header.version !== 'number') {
    const document = asRecord(parseJson(text));
    if (document?.version === 1) return parseVersion1(document);
    return { ok: false, error: 'This is not an asciinema recording: the first line must be a JSON header with a "version".' };
  }
  if (header.version === 1) return parseVersion1(header);
  if (header.version !== 2 && header.version !== 3) return { ok: false, error: `asciicast version ${header.version} is not supported.` };

  const term = asRecord(header.term);
  const relative = header.version === 3;
  let clock = 0;
  let skippedLines = 0;
  const events: CastEvent[] = [];
  for (const line of lines.slice(1)) {
    const entry = parseJson(line);
    if (!Array.isArray(entry) || typeof entry[0] !== 'number' || !Number.isFinite(entry[0]) || entry[0] < 0 || typeof entry[1] !== 'string' || typeof entry[2] !== 'string') {
      skippedLines++;
      continue;
    }
    clock = relative ? clock + entry[0] : entry[0];
    events.push({ timeMs: Math.round(clock * 1000), code: entry[1], data: entry[2] });
  }
  if (events.length === 0) return { ok: false, error: 'The recording has no terminal events.' };
  return finish({
    version: header.version,
    columns: side(relative ? term?.cols : header.width, DEFAULT_COLUMNS),
    rows: side(relative ? term?.rows : header.height, DEFAULT_ROWS),
    header, events, skippedLines,
  });
}

/**
 * Rewrite a recording as asciicast v2 with absolute times, the only form the
 * analysis service reads.
 */
export function toVersion2(recording: Recording): string {
  const header: Record<string, unknown> = { version: 2, width: recording.columns, height: recording.rows };
  if (typeof recording.header.timestamp === 'number') header.timestamp = recording.header.timestamp;
  const lines = recording.events.map((event) => JSON.stringify([event.timeMs / 1000, event.code, event.data]));
  return `${[JSON.stringify(header), ...lines].join('\n')}\n`;
}

/** `date +%s` left in a file name: the quoting of the record command stopped the shell from running it. */
const UNRUN_DATE_COMMAND = /\$\(\s*date \+%s\s*\)|`?date \+%s`?/g;

/**
 * Session title for an uploaded file: the name without a recording extension.
 * An unrun `date +%s` becomes the time stored in the recording (Unix seconds,
 * what the command would have printed), or is dropped when there is none.
 */
export function titleFromFileName(fileName: string, recordedAt?: unknown): string {
  const seconds = typeof recordedAt === 'number' && Number.isFinite(recordedAt) ? String(Math.floor(recordedAt)) : '';
  let title = fileName.replace(/\.(cast|asciicast|rec|json|annotated|asciinema)(?=$|\.)/gi, '');
  const dated = title.replace(UNRUN_DATE_COMMAND, seconds);
  if (dated !== title) title = seconds ? dated : dated.replace(/[\s_-]+$/, '');
  title = title.trim();
  return title || 'recording';
}
