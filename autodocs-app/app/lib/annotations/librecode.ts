/**
 * The `librecode_annotations` header key of annotated recordings, as written by
 * the LibreCode annotator. `beginning` and `end` are milliseconds.
 */

export interface PortableAnnotation {
  startMs: number;
  endMs: number;
  text: string;
  depth: number | null;
  /** Who the file says wrote it; informational only, never trusted as identity. */
  claimedAuthor: string | null;
}

export interface PortableLayer {
  title: string;
  annotations: PortableAnnotation[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const MAX_MS = 2_000_000_000;

/** The database refuses NUL characters in text. */
const withoutNul = (value: string): string => value.replaceAll('\u0000', '');

function milliseconds(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? Math.min(MAX_MS, Math.max(0, Math.round(number))) : null;
}

/** Layers stored in a recording header; empty when there are none. */
export function readLibrecodeAnnotations(header: Record<string, unknown>): PortableLayer[] {
  const data = asRecord(header.librecode_annotations);
  if (!data || !Array.isArray(data.layers)) return [];
  return data.layers.flatMap((value: unknown, index: number): PortableLayer[] => {
    const layer = asRecord(value);
    if (!layer || !Array.isArray(layer.annotations)) return [];
    const annotations = layer.annotations.flatMap((item: unknown): PortableAnnotation[] => {
      const entry = asRecord(item);
      const first = milliseconds(entry?.beginning);
      const second = milliseconds(entry?.end);
      if (!entry || first === null || second === null) return [];
      const provenance = asRecord(entry.provenance);
      const author = provenance?.author ?? provenance?.model;
      return [{
        startMs: Math.min(first, second),
        endMs: Math.max(first, second),
        text: typeof entry.text === 'string' ? entry.text : '',
        depth: typeof entry.depth === 'number' && Number.isInteger(entry.depth) && entry.depth >= -1 && entry.depth <= 100 ? entry.depth : null,
        claimedAuthor: typeof author === 'string' ? withoutNul(author).slice(0, 120) : null,
      }];
    });
    const name = typeof layer.title === 'string' ? withoutNul(layer.title).trim() : '';
    const title = name ? name.slice(0, 120) : `Timeline Level ${index}`;
    return [{ title, annotations }];
  });
}

export interface ExportAnnotation {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  depth: number | null;
  provenance: { origin: string; author: string | null; model: string | null; editedBy: string | null };
}

export interface ExportLayer {
  title: string;
  annotations: ExportAnnotation[];
}

/**
 * Return the recording with its header's annotations replaced by `layers`.
 * Event lines are kept byte for byte.
 */
export function writeLibrecodeAnnotations(cast: string, layers: ExportLayer[]): string {
  const payload = {
    note: 'librecode annotations',
    layers: layers.map((layer) => ({
      title: layer.title,
      annotations: layer.annotations.map((annotation) => ({
        group: annotation.id,
        beginning: annotation.startMs,
        end: annotation.endMs,
        text: annotation.text,
        depth: annotation.depth,
        provenance: annotation.provenance,
      })),
    })),
  };
  const text = cast.replace(/^﻿/, '');
  const newline = text.indexOf('\n');
  try {
    const header = asRecord(JSON.parse(newline < 0 ? text : text.slice(0, newline)));
    if (header) {
      const rest = newline < 0 ? '' : text.slice(newline);
      return `${JSON.stringify({ ...header, librecode_annotations: payload })}${rest}`;
    }
  } catch {
    // A version 1 recording is one JSON document over several lines.
  }
  const document = asRecord(JSON.parse(text));
  return JSON.stringify({ ...document, librecode_annotations: payload });
}
