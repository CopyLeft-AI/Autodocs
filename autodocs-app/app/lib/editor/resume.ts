/** Where this browser left each session, so work can continue there. */
export interface ResumePoint { timeMs: number; layerId: string | null; }
export interface LastSession { id: string; title: string; }

const LAST_KEY = 'autodocs:editor:last';
const keyOf = (sessionId: string) => `autodocs:editor:${sessionId}`;

function read<T>(key: string): T | null {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be full or disabled; resuming is only a convenience.
  }
}

export const readResumePoint = (sessionId: string): ResumePoint | null => read<ResumePoint>(keyOf(sessionId));
export const readLastSession = (): LastSession | null => read<LastSession>(LAST_KEY);

export function saveResumePoint(session: LastSession, point: ResumePoint): void {
  write(keyOf(session.id), point);
  write(LAST_KEY, { id: session.id, title: session.title });
}

export function forgetSession(sessionId: string): void {
  try {
    window.localStorage.removeItem(keyOf(sessionId));
    if (readLastSession()?.id === sessionId) window.localStorage.removeItem(LAST_KEY);
  } catch {
    // Nothing to forget without storage.
  }
}
