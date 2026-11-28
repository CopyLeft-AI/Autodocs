/** The one place that says how each kind of authorship looks. */
import { IconDownload, IconPencilCheck, IconSparkles, IconUser, type Icon } from '@tabler/icons-react';
import type { Provenance } from '@/app/lib/annotations/types';

export interface ProvenanceStyle {
  name: string;
  icon: Icon;
  /** Block on the timeline and card in lists: shape differs as well as colour. */
  block: string;
  text: string;
}

export const PROVENANCE_STYLES: Record<Provenance, ProvenanceStyle> = {
  human: { name: 'Human', icon: IconUser, block: 'border-solid border-emerald-400 bg-emerald-500/25', text: 'text-emerald-300' },
  ai: { name: 'AI', icon: IconSparkles, block: 'border-dashed border-violet-400 bg-violet-500/20', text: 'text-violet-300' },
  'ai-edited': { name: 'AI, edited by a person', icon: IconPencilCheck, block: 'border-solid border-violet-400 border-l-4 border-l-amber-400 bg-gradient-to-r from-amber-500/25 to-violet-500/20', text: 'text-amber-300' },
  imported: { name: 'Imported', icon: IconDownload, block: 'border-dotted border-slate-400 bg-slate-500/20', text: 'text-slate-300' },
};
