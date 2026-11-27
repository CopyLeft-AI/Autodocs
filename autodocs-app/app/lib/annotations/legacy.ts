/**
 * Turn analysis results (event labels plus their XML) into timed annotations,
 * and rebuild a plain recording for old sessions that never stored one.
 */
import type { CastEvent, Recording } from '../cast/parse';
import type { SessionEvent } from '../session-content';
import type { PortableAnnotation } from './librecode';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXmlText(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (match, name: string) => {
    if (!name.startsWith('#')) return ENTITIES[name];
    const code = name[1] === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/** The terminal events inside one `<event>` block of the analysis XML. */
export function eventsFromXml(xml: string): CastEvent[] {
  const pattern = /<(user_input|system_output)\s+timestamp="([0-9.eE+-]+)"\s*(?:\/>|>([\s\S]*?)<\/\1>)/g;
  return [...xml.matchAll(pattern)].flatMap((match): CastEvent[] => {
    const seconds = Number(match[2]);
    if (!Number.isFinite(seconds)) return [];
    return [{ timeMs: Math.round(seconds * 1000), code: match[1] === 'user_input' ? 'i' : 'o', data: decodeXmlText(match[3] ?? '') }];
  });
}

/**
 * Give each analysis event a time range: from its first terminal event to the
 * next event's start. Events without XML get equal slices of the remaining time.
 */
export function timeAnalysisEvents(events: SessionEvent[], durationMs: number): PortableAnnotation[] {
  const known = events.map((event) => (event.content ? eventsFromXml(event.content)[0]?.timeMs ?? null : null));
  const starts: number[] = [];
  for (let index = 0; index < events.length; index++) {
    const start = known[index];
    if (start !== null) { starts.push(start); continue; }
    let next = index + 1;
    while (next < events.length && known[next] === null) next++;
    const previous = index === 0 ? 0 : starts[index - 1];
    const limit = next < events.length ? known[next]! : Math.max(durationMs, previous);
    const step = index === 0 ? 0 : (limit - previous) / (next - index + 1);
    starts.push(Math.round(previous + step));
  }
  return events.map((event, index) => ({
    startMs: starts[index],
    // An event ends just before the next one starts, so the two never share a terminal write.
    endMs: Math.max(starts[index], index + 1 < events.length ? starts[index + 1] - 1 : durationMs),
    text: event.label,
    depth: event.depth,
    claimedAuthor: null,
  }));
}

/** A recording rebuilt from event XML. Escape sequences were stripped, so it has no colours. */
export function reconstructRecording(events: SessionEvent[]): Recording | null {
  const terminal = events.flatMap((event) => (event.content ? eventsFromXml(event.content) : []));
  if (terminal.length === 0) return null;
  const output = terminal.map((event) => ({ ...event, data: event.data.replace(/\r?\n/g, '\r\n') }));
  return { version: 2, columns: 120, rows: 36, header: { version: 2 }, events: output, durationMs: output.at(-1)!.timeMs, skippedLines: 0 };
}
