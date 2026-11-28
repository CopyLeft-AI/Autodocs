import { provenanceLabel, provenanceOf, type Annotation } from '@/app/lib/annotations/types';
import { PROVENANCE_STYLES } from './provenance';

export function ProvenanceBadge({ annotation }: { annotation: Annotation }) {
  const style = PROVENANCE_STYLES[provenanceOf(annotation)];
  return (
    <span className={`inline-flex max-w-full items-center gap-1.5 rounded border px-1.5 py-0.5 text-[11px] ${style.block} ${style.text}`}>
      <style.icon size={13} className="shrink-0" />
      <span className="truncate">{provenanceLabel(annotation)}</span>
    </span>
  );
}

export function ProvenanceLegend() {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1">
      {Object.entries(PROVENANCE_STYLES).map(([key, style]) => (
        <li key={key} className={`flex items-center gap-1.5 text-[11px] ${style.text}`}>
          <span className={`inline-block h-3 w-5 rounded-sm border ${style.block}`} />
          <style.icon size={13} />
          {style.name}
        </li>
      ))}
    </ul>
  );
}
