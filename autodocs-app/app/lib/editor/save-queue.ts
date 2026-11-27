/**
 * Sends the changes to one annotation one after another. A change based on a
 * version that our own earlier changes have since replaced is moved to the newest
 * of those, so it is not refused; other people's changes still cause a conflict.
 */
export function createSaveQueue<Saved extends { id: string; version: number }>() {
  const tails = new Map<string, Promise<unknown>>();
  /** annotation id -> version we sent -> version the server answered with. */
  const steps = new Map<string, Map<number, number>>();

  return function enqueue(id: string, basedOn: number, send: (expectedVersion: number) => Promise<Saved | null>): Promise<Saved | null> {
    const run = async () => {
      const own = steps.get(id) ?? new Map<number, number>();
      steps.set(id, own);
      let expected = basedOn;
      for (let next = own.get(expected); next !== undefined && next > expected; next = own.get(expected)) expected = next;
      const saved = await send(expected);
      if (saved) own.set(expected, saved.version);
      return saved;
    };
    const result = (tails.get(id) ?? Promise.resolve()).then(run, run);
    tails.set(id, result);
    return result;
  };
}
