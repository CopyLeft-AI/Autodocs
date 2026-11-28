import { describe, expect, test } from 'bun:test';
import { createSaveQueue } from '../app/lib/editor/save-queue';
import { readLibrecodeAnnotations } from '../app/lib/annotations/librecode';

describe('save queue', () => {
  const server = () => {
    let version = 1;
    return {
      send: async (expected: number) => {
        await Promise.resolve();
        return expected === version ? { id: 'a', version: ++version } : null;
      },
      someoneElse: () => { version++; },
    };
  };

  test('a second change based on the same version follows our first', async () => {
    const enqueue = createSaveQueue<{ id: string; version: number }>();
    const { send } = server();
    const results = await Promise.all([enqueue('a', 1, send), enqueue('a', 1, send)]);
    expect(results.map((result) => result?.version)).toEqual([2, 3]);
  });

  test('a change made by someone else is still refused', async () => {
    const enqueue = createSaveQueue<{ id: string; version: number }>();
    const { send, someoneElse } = server();
    await enqueue('a', 1, send);
    someoneElse();
    expect(await enqueue('a', 1, send)).toBeNull();
  });

  test('a failed request does not block the next one', async () => {
    const enqueue = createSaveQueue<{ id: string; version: number }>();
    const { send } = server();
    await expect(enqueue('a', 1, async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    expect((await enqueue('a', 1, send))?.version).toBe(2);
  });
});

describe('imported annotations', () => {
  test('values the database would refuse are cleaned', () => {
    const [layer] = readLibrecodeAnnotations({ librecode_annotations: { layers: [{
      title: 'A\u0000B', annotations: [{ beginning: 0, end: 1, text: 'x', depth: 1e10, provenance: { author: 'n\u0000m' } }],
    }] } });
    expect(layer.title).toBe('AB');
    expect(layer.annotations[0]).toMatchObject({ depth: null, claimedAuthor: 'nm' });
  });
});
