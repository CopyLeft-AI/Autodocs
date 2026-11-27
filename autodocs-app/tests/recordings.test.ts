// External
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

// Ours
import { eventsFromXml, reconstructRecording, timeAnalysisEvents } from '../app/lib/annotations/legacy';
import { readLibrecodeAnnotations, writeLibrecodeAnnotations } from '../app/lib/annotations/librecode';
import { provenanceLabel, provenanceOf, type Annotation } from '../app/lib/annotations/types';
import { parseCast, titleFromFileName, toVersion2, type Recording } from '../app/lib/cast/parse';

function parse(text: string): Recording {
  const result = parseCast(text);
  if (!result.ok) throw new Error(result.error);
  return result.recording;
}

const lines = (...values: unknown[]): string => values.map((value) => (typeof value === 'string' ? value : JSON.stringify(value))).join('\n');

describe('reading recordings', () => {
  test('version 2 times are absolute', () => {
    const recording = parse(lines({ version: 2, width: 100, height: 30 }, [0.5, 'o', 'a'], [2, 'o', 'b']));
    expect(recording.events.map((event) => event.timeMs)).toEqual([500, 2000]);
    expect([recording.columns, recording.rows, recording.durationMs]).toEqual([100, 30, 2000]);
  });

  test('version 3 times are intervals, comments are skipped', () => {
    const recording = parse(lines({ version: 3, term: { cols: 90, rows: 20 } }, '# note', [0.5, 'o', 'a'], [2, 'o', 'b']));
    expect(recording.events.map((event) => event.timeMs)).toEqual([500, 2500]);
    expect(recording.columns).toBe(90);
  });

  test('version 1 documents are accepted', () => {
    const recording = parse(JSON.stringify({ version: 1, width: 80, height: 24, stdout: [[1, 'a'], [1.5, 'b']] }, null, 2));
    expect(recording.durationMs).toBe(2500);
  });

  test('a truncated last line is skipped instead of failing the upload', () => {
    const recording = parse(`${lines({ version: 2 }, [1, 'o', 'a'])}\n[2.0, "o", "unfin`);
    expect([recording.events.length, recording.skippedLines, recording.durationMs]).toEqual([1, 1, 1000]);
  });

  test('files that are not recordings are refused with a reason', () => {
    for (const text of ['', 'hello', '{"a":1}', '{"version":9}', '{"version":2}']) expect(parseCast(text).ok).toBe(false);
  });

  test('conversion to version 2 keeps events and drops header annotations', () => {
    const source = parse(lines({ version: 3, term: { cols: 90, rows: 20 }, librecode_annotations: {} }, [1, 'o', 'a'], [1, 'i', 'b']));
    const converted = parse(toVersion2(source));
    expect(converted.events).toEqual(source.events);
    expect(converted.header.librecode_annotations).toBeUndefined();
  });

  test('titles drop recording extensions and keep unusual characters', () => {
    expect(titleFromFileName('apt_upgrade-broken_X-date +%s')).toBe('apt_upgrade-broken_X-date +%s');
    expect(titleFromFileName('session.annotated.cast')).toBe('session');
    expect(titleFromFileName('.cast')).toBe('recording');
  });

  test('every sample recording in the repository can be read', async () => {
    const root = join(import.meta.dir, '..', '..');
    let count = 0;
    for await (const file of new Bun.Glob('**/*.cast').scan({ cwd: root })) {
      if (file.includes('node_modules')) continue;
      expect({ file, ok: parseCast(await Bun.file(join(root, file)).text()).ok }).toEqual({ file, ok: true });
      count++;
    }
    console.log(`checked ${count} sample recordings`);
  });
});

describe('librecode annotations', () => {
  const cast = lines({ version: 2, width: 80, height: 24 }, [1, 'o', 'a']);

  test('what is exported can be imported again', () => {
    const exported = writeLibrecodeAnnotations(cast, [{ title: 'Level 0', annotations: [{ id: 'x', startMs: 100, endMs: 900, text: 'ls', depth: -1, provenance: { origin: 'ai', author: null, model: 'm', editedBy: null } }] }]);
    const [layer] = readLibrecodeAnnotations(parse(exported).header);
    expect(layer).toEqual({ title: 'Level 0', annotations: [{ startMs: 100, endMs: 900, text: 'ls', depth: -1, claimedAuthor: 'm' }] });
    expect(exported.split('\n')[1]).toBe(cast.split('\n')[1]);
  });

  test('files from the old annotator import, with swapped bounds repaired', () => {
    const header = { librecode_annotations: { note: 'librecode annotations', layers: [{ annotations: [{ group: 'g', beginning: 2000, end: 1000, text: 't' }, { beginning: 'bad' }] }] } };
    expect(readLibrecodeAnnotations(header)).toEqual([{ title: 'Timeline Level 0', annotations: [{ startMs: 1000, endMs: 2000, text: 't', depth: null, claimedAuthor: null }] }]);
    expect(readLibrecodeAnnotations({})).toEqual([]);
  });
});

describe('analysis results', () => {
  const xml = '<event>\n  <user_input timestamp="1.5">ls &lt;x&gt;</user_input>\n  <system_output timestamp="2">a\nb</system_output>\n</event>';

  test('terminal events are read back from event XML', () => {
    expect(eventsFromXml(xml)).toEqual([{ timeMs: 1500, code: 'i', data: 'ls <x>' }, { timeMs: 2000, code: 'o', data: 'a\nb' }]);
  });

  test('each event lasts until the next one; events without XML are spread out', () => {
    const timed = timeAnalysisEvents([
      { label: 'a', depth: 0, content: '<user_input timestamp="1">a</user_input>' },
      { label: 'b', depth: 0, content: null },
      { label: 'c', depth: 1, content: '<user_input timestamp="5">c</user_input>' },
    ], 9000);
    expect(timed.map((item) => [item.startMs, item.endMs])).toEqual([[1000, 2999], [3000, 4999], [5000, 9000]]);
    expect(timeAnalysisEvents([], 100)).toEqual([]);
  });

  test('old sessions can be replayed from their XML', () => {
    expect(reconstructRecording([{ label: 'a', depth: 0, content: xml }])?.events[1].data).toBe('a\r\nb');
    expect(reconstructRecording([{ label: 'a', depth: 0, content: null }])).toBeNull();
  });
});

describe('provenance', () => {
  const base = { origin: 'ai', editedAt: null, editedByName: null, aiModel: 'm1', authorName: null } as Annotation;

  test('AI, AI edited by a person, human and imported are told apart', () => {
    expect(provenanceOf(base)).toBe('ai');
    expect(provenanceOf({ ...base, editedAt: '2026-01-01' })).toBe('ai-edited');
    expect(provenanceOf({ ...base, origin: 'human', editedAt: '2026-01-01' })).toBe('human');
    expect(provenanceOf({ ...base, origin: 'imported' })).toBe('imported');
    expect(provenanceLabel({ ...base, editedByName: 'Ana' })).toBe('AI: m1, edited by Ana');
  });
});
