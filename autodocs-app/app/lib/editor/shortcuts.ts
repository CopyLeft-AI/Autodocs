/** The editor's keyboard shortcuts, kept apart from what they do. */
export type Command =
  | 'setA' | 'setB' | 'create' | 'toggle' | 'toEnd' | 'delete' | 'inactivityBack' | 'inactivityForward'
  | 'previousKeyframe' | 'nextKeyframe' | 'seek' | 'focus' | 'escape';

export interface KeyPress { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; }

const PLAIN: Record<string, Command> = {
  a: 'setA', b: 'setB', c: 'create', ' ': 'toggle', End: 'toEnd', Delete: 'delete',
  ArrowUp: 'previousKeyframe', ArrowDown: 'nextKeyframe', s: 'seek', f: 'focus', Escape: 'escape',
};

export function commandFor({ key, ctrlKey, metaKey, altKey }: KeyPress): Command | null {
  const name = key.length === 1 ? key.toLowerCase() : key;
  if (altKey) return null;
  if (ctrlKey || metaKey) return name === 'ArrowLeft' ? 'inactivityBack' : name === 'ArrowRight' ? 'inactivityForward' : null;
  return PLAIN[name] ?? null;
}

/** True when the key belongs to the focused control rather than the editor. */
export function isTypingTarget(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('dialog, textarea, select, [contenteditable="true"]')) return true;
  if (target instanceof HTMLInputElement && !['radio', 'checkbox', 'range'].includes(target.type)) return true;
  // Space and Enter press the focused button.
  return key === ' ' && target.closest('button, input, a') !== null;
}
