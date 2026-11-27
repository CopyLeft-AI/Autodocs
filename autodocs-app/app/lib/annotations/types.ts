/** Contracts shared by the editor and the API. */

export type AnnotationOrigin = 'ai' | 'human' | 'imported';

export interface Annotation {
  id: string;
  layerId: string;
  startMs: number;
  endMs: number;
  text: string;
  /** Hierarchy marker from the annotation model: -1 opens a sub-task, 0 continues, n closes n levels. */
  depth: number | null;
  origin: AnnotationOrigin;
  authorName: string | null;
  aiBackend: string | null;
  aiModel: string | null;
  boundaryBackend: string | null;
  boundaryModel: string | null;
  editedByName: string | null;
  editedAt: string | null;
  version: number;
  createdAt: string;
}

export interface AnnotationLayer {
  id: string;
  title: string;
  position: number;
}

export interface AnnotationRevision {
  id: string;
  annotationId: string | null;
  action: string;
  actorName: string;
  summary: string;
  createdAt: string;
}

export interface SessionAccess {
  isOwner: boolean;
  canAnnotate: boolean;
}

export interface SessionDetail {
  id: string;
  title: string;
  durationSeconds: number;
  createdAt: string;
  access: SessionAccess;
  /** 'original' file, 'reconstructed' from stored event XML (no colours), or 'missing'. */
  recordingSource: 'original' | 'reconstructed' | 'missing';
  layers: AnnotationLayer[];
  annotations: Annotation[];
}

export interface AnnotationInput {
  layerId: string;
  startMs: number;
  endMs: number;
  text: string;
  depth: number | null;
}

export type AnnotationChanges = Partial<AnnotationInput>;

/** Which of the four visual styles an annotation gets. */
export type Provenance = 'ai' | 'ai-edited' | 'human' | 'imported';

export function provenanceOf(annotation: Pick<Annotation, 'origin' | 'editedAt'>): Provenance {
  if (annotation.origin === 'ai') return annotation.editedAt ? 'ai-edited' : 'ai';
  return annotation.origin;
}

/** One line saying who made the annotation, and with what. */
export function provenanceLabel(annotation: Annotation): string {
  const editor = annotation.editedByName ? `edited by ${annotation.editedByName}` : '';
  const created = annotation.origin === 'ai'
    ? `AI: ${annotation.aiModel ?? 'model not recorded'}`
    : annotation.origin === 'human'
      ? `Human: ${annotation.authorName ?? 'deleted account'}`
      : `Imported${annotation.authorName ? `, file says ${annotation.authorName}` : ''}`;
  return editor ? `${created}, ${editor}` : created;
}
