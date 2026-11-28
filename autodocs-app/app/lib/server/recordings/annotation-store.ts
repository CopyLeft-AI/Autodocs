// External
import type { PoolClient } from 'pg';

// Ours
import type { AnalysisModels } from '@/app/lib/annotations/analysis';
import type { PortableAnnotation, PortableLayer } from '@/app/lib/annotations/librecode';
import type { Annotation, AnnotationLayer, AnnotationOrigin } from '@/app/lib/annotations/types';

export const ANNOTATION_COLUMNS = `id, layer_id AS "layerId", start_ms AS "startMs", end_ms AS "endMs", text, depth, origin,
  author_name AS "authorName", ai_backend AS "aiBackend", ai_model AS "aiModel",
  boundary_backend AS "boundaryBackend", boundary_model AS "boundaryModel",
  edited_by_name AS "editedByName", edited_at AS "editedAt", version, created_at AS "createdAt"`;

export const LAYER_COLUMNS = 'id, title, position';

export interface Actor { id: string; name: string; }

export interface Revision {
  sessionId: string;
  annotationId?: string | null;
  action: string;
  actor: Actor | { id: null; name: string };
  summary: string;
  before?: unknown;
  after?: unknown;
}

export async function recordRevision(client: PoolClient, revision: Revision): Promise<void> {
  await client.query(
    `INSERT INTO annotation_revisions (terminal_session_id, annotation_id, action, user_id, actor_name, summary, before, after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [revision.sessionId, revision.annotationId ?? null, revision.action, revision.actor.id, revision.actor.name, revision.summary.slice(0, 300),
      revision.before === undefined ? null : JSON.stringify(revision.before), revision.after === undefined ? null : JSON.stringify(revision.after)],
  );
}

export async function insertLayer(client: PoolClient, sessionId: string, title: string): Promise<AnnotationLayer> {
  return (await client.query<AnnotationLayer>(
    `INSERT INTO annotation_layers (terminal_session_id, title, position)
     VALUES ($1, $2, (SELECT COALESCE(MAX(position) + 1, 0) FROM annotation_layers WHERE terminal_session_id = $1))
     RETURNING ${LAYER_COLUMNS}`,
    [sessionId, title.slice(0, 120)],
  )).rows[0];
}

export interface BatchSource {
  origin: AnnotationOrigin;
  /** The person who asked for the analysis or uploaded the file. */
  actor: Actor;
  models?: AnalysisModels;
}

/** Add one new layer holding `annotations`. Existing layers are never touched. */
export async function insertAnnotatedLayer(client: PoolClient, sessionId: string, layer: PortableLayer, source: BatchSource): Promise<void> {
  const { id: layerId } = await insertLayer(client, sessionId, layer.title);
  const models = source.models;
  const rows = layer.annotations.map((annotation: PortableAnnotation) => ({
    start_ms: annotation.startMs, end_ms: annotation.endMs, text: annotation.text.replaceAll('\u0000', ''),
    depth: annotation.depth, author_name: source.origin === 'imported' ? annotation.claimedAuthor : null,
  }));
  await client.query(
    `INSERT INTO annotations (terminal_session_id, layer_id, start_ms, end_ms, text, depth, origin, author_name,
                              ai_backend, ai_model, boundary_backend, boundary_model)
     SELECT $1, $2, r.start_ms, r.end_ms, r.text, r.depth, $3, r.author_name, $4, $5, $6, $7
     FROM json_to_recordset($8) AS r(start_ms int, end_ms int, text text, depth int, author_name text)`,
    [sessionId, layerId, source.origin, models?.annotate?.backend ?? null, models?.annotate?.model ?? null,
      models?.boundaries?.backend ?? null, models?.boundaries?.model ?? null, JSON.stringify(rows)],
  );
  await recordRevision(client, {
    sessionId,
    action: source.origin === 'ai' ? 'ai-analysis' : 'import',
    actor: source.actor,
    summary: source.origin === 'ai'
      ? `Ran analysis (${models?.annotate?.model ?? 'model not recorded'}): ${rows.length} annotations in "${layer.title}"`
      : `Imported ${rows.length} annotations into "${layer.title}"`,
    after: source.models ?? null,
  });
}

export async function selectAnnotation(client: PoolClient, sessionId: string, annotationId: string): Promise<Annotation | null> {
  const result = await client.query<Annotation>(
    `SELECT ${ANNOTATION_COLUMNS} FROM annotations WHERE id = $1 AND terminal_session_id = $2 FOR UPDATE`,
    [annotationId, sessionId],
  );
  return result.rows[0] ?? null;
}
