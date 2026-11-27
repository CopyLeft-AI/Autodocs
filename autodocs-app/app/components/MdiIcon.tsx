/** A Material Design icon from @mdi/js, the set the earlier annotator used. */
export function MdiIcon({ path, size = 20, className }: { path: string; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden="true" fill="currentColor">
      <path d={path} />
    </svg>
  );
}
