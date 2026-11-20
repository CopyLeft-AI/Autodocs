import { Clock, FileText, GitBranch, CornerDownRight, LogOut, Trash2, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Session } from '@/app/home/page';
import { parseSessionContent, type SessionEvent } from '@/app/lib/session-content';


interface SessionTileProps {
  session: Session;
  onClick?: () => void;
  /** When given, the tile shows a delete button (owned sessions only). */
  onDelete?: (id: string) => Promise<void>;
}

function EventDepthBadge({ depth }: { depth: number }) {
  if (depth === -1) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
        <CornerDownRight className="w-2.5 h-2.5" />
        sub
      </span>
    );
  }
  if (depth >= 1) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
        <LogOut className="w-2.5 h-2.5" />
        exit
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
      <GitBranch className="w-2.5 h-2.5" />
      event
    </span>
  );
}

type TileDeleteState = 'idle' | 'confirm' | 'deleting' | 'error';

export function SessionTile({ session, onClick, onDelete }: SessionTileProps) {
  const { title, createdAt, duration, content } = session;
  const [deleteState, setDeleteState] = useState<TileDeleteState>('idle');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const confirmDelete = async () => {
    if (!onDelete) return;
    setDeleteState('deleting');
    setDeleteError(null);
    try {
      await onDelete(session.id);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete session.');
      setDeleteState('error');
    }
  };

  const events = useMemo(() => parseSessionContent(content), [content]);

  const eventCounts = {
    independent: events.filter((e: SessionEvent) => e.depth === 0).length,
    sub: events.filter((e: SessionEvent) => e.depth === -1).length,
    exiting: events.filter((e: SessionEvent) => e.depth >= 1).length,
  };

  const previewEvents = events.slice(0, 3);

  return (
    <div
      className="bg-card rounded-xl border border-border p-6 hover:bg-accent/10 transition-all cursor-pointer group"
      onClick={onClick}
    >
      {/* Top row */}
      <div className="flex items-start justify-between mb-4">
        <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center group-hover:bg-primary/20 transition-colors">
          <FileText className="w-6 h-6 text-primary" />
        </div>
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Clock className="w-4 h-4" />
          <span>{duration}</span>
          {onDelete && deleteState === 'idle' && (
            <button
              type="button"
              aria-label={`Delete session ${title}`}
              title="Delete session"
              onClick={(event) => { event.stopPropagation(); setDeleteState('confirm'); }}
              className="ml-1 p-1.5 rounded-md hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {onDelete && deleteState !== 'idle' && (
        <div
          className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs"
          onClick={(event) => event.stopPropagation()}
        >
          <p className="text-foreground mb-2">Delete &ldquo;{title}&rdquo;? This cannot be undone.</p>
          {deleteState === 'error' && <p className="text-destructive font-mono mb-2">{deleteError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={deleteState === 'deleting'}
              onClick={() => void confirmDelete()}
              className="px-3 py-1.5 rounded-md bg-destructive text-white inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {deleteState === 'deleting' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              {deleteState === 'error' ? 'Retry' : 'Delete'}
            </button>
            <button
              type="button"
              disabled={deleteState === 'deleting'}
              onClick={() => { setDeleteState('idle'); setDeleteError(null); }}
              className="px-3 py-1.5 rounded-md border border-border disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Title & date */}
      <h3 className="text-foreground mb-1 line-clamp-1">{title}</h3>
      <p className="text-sm text-muted-foreground mb-3">{createdAt}</p>

      {/* Event stats */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-muted-foreground font-mono">{events.length} events</span>
        <span className="text-border">·</span>
        <span className="text-xs text-emerald-400 font-mono">{eventCounts.independent} top-level</span>
        <span className="text-border">·</span>
        <span className="text-xs text-blue-400 font-mono">{eventCounts.sub} sub</span>
      </div>

      {/* Event preview list */}
      <div className="bg-muted rounded-md p-3 space-y-2">
        {previewEvents.map((event: SessionEvent, i: number) => (
          <div key={i} className="flex items-start gap-2">
            <div className="mt-0.5 flex-shrink-0">
              <EventDepthBadge depth={event.depth} />
            </div>
            <p className="text-xs text-muted-foreground font-mono leading-snug line-clamp-1">
              {event.label}
            </p>
          </div>
        ))}
        {events.length > 3 && (
          <p className="text-xs text-muted-foreground/50 font-mono pt-1">
            +{events.length - 3} more events...
          </p>
        )}
      </div>
    </div>
  );
}