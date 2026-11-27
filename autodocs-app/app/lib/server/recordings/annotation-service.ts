// External
import type { PoolClient } from 'pg';

// Ours
import type { Annotation, AnnotationChanges, AnnotationInput, AnnotationLayer, AnnotationRevision } from '@/app/lib/annotations/types';
import { db } from '@/app/lib/server/db';
import { requireAccess, transaction } from './access';
import { ANNOTATION_COLUMNS, insertLayer, LAYER_COLUMNS, recordRevision, selectAnnotation, type Actor } from './annotation-store';
import { RequestError } from './errors';
import { parseAnnotationChanges, parseAnnotationInput, parseLayerTitle } from './validation';

async function requireLayer(client: PoolClient, sessionId: string, layerId: string): Promise<AnnotationLayer> {
  const layer = (await client.query<AnnotationLayer>(
    `SELECT ${LAYER_COLUMNS} FROM annotation_layers WHERE id = $1 AND terminal_session_id = $2 FOR UPDATE`,
    [layerId, sessionId],
  )).rows[0];
  if (!layer) throw new RequestError(404, 'Timeline not found.');
  return layer;
}

const excerpt = (text: string): string => `"${text.length > 60 ? `${text.slice(0, 57)}...` : text}"`;

export async function createAnnotation(actor: Actor, sessionId: string, body: Record<string, unknown>): Promise<Annotation> {
  const input: AnnotationInput = parseAnnotationInput(body);
  return transaction(async (client) => {
    await requireAccess(actor.id, sessionId, 'annotate', client);
    await requireLayer(client, sessionId, input.layerId);
    const annotation = (await client.query<Annotation>(
      `INSERT INTO annotations (terminal_session_id, layer_id, start_ms, end_ms, text, depth, origin, author_user_id, author_name)
       VALUES ($1, $2, $3, $4, $5, $6, 'human', $7, $8) RETURNING ${ANNOTATION_COLUMNS}`,
      [sessionId, input.layerId, input.startMs, input.endMs, input.text, input.depth, actor.id, actor.name],
    )).rows[0];
    await recordRevision(client, { sessionId, annotationId: annotation.id, action: 'create', actor, summary: `Created ${excerpt(annotation.text)}`, after: annotation });
    return annotation;
  });
}

/**
 * Change an annotation. `expectedVersion` must match the stored one, so two
 * people editing the same annotation cannot silently overwrite each other.
 */
export async function updateAnnotation(actor: Actor, sessionId: string, annotationId: string, body: Record<string, unknown>): Promise<Annotation> {
  const { changes, expectedVersion } = parseAnnotationChanges(body);
  return transaction(async (client) => {
    await requireAccess(actor.id, sessionId, 'annotate', client);
    const before = await selectAnnotation(client, sessionId, annotationId);
    if (!before) throw new RequestError(404, 'Annotation not found.');
    if (before.version !== expectedVersion) throw new RequestError(409, 'Someone else changed this annotation. Reload to see the current version.');
    const next: AnnotationChanges = { ...changes };
    const merged = { ...before, ...next };
    if (merged.endMs < merged.startMs) throw new RequestError(400, 'The end cannot be before the start.');
    const changed = (Object.keys(next) as (keyof AnnotationChanges)[]).filter((key) => next[key] !== before[key]);
    if (changed.length === 0) return before;
    if (next.layerId) await requireLayer(client, sessionId, next.layerId);
    const after = (await client.query<Annotation>(
      `UPDATE annotations SET layer_id = $2, start_ms = $3, end_ms = $4, text = $5, depth = $6,
              edited_by_user_id = $7, edited_by_name = $8, edited_at = NOW(), version = version + 1
       WHERE id = $1 RETURNING ${ANNOTATION_COLUMNS}`,
      [annotationId, merged.layerId, merged.startMs, merged.endMs, merged.text, merged.depth, actor.id, actor.name],
    )).rows[0];
    await recordRevision(client, { sessionId, annotationId, action: 'update', actor, summary: `Changed ${changed.join(', ')} of ${excerpt(after.text)}`, before, after });
    return after;
  });
}

export async function deleteAnnotation(actor: Actor, sessionId: string, annotationId: string): Promise<void> {
  await transaction(async (client) => {
    await requireAccess(actor.id, sessionId, 'annotate', client);
    const before = await selectAnnotation(client, sessionId, annotationId);
    if (!before) throw new RequestError(404, 'Annotation not found.');
    await client.query('DELETE FROM annotations WHERE id = $1', [annotationId]);
    await recordRevision(client, { sessionId, annotationId, action: 'delete', actor, summary: `Deleted ${excerpt(before.text)}`, before });
  });
}

export async function createLayer(actor: Actor, sessionId: string, body: Record<string, unknown>): Promise<AnnotationLayer> {
  const title = parseLayerTitle(body.title);
  return transaction(async (client) => {
    await requireAccess(actor.id, sessionId, 'annotate', client);
    const layer = await insertLayer(client, sessionId, title);
    await recordRevision(client, { sessionId, action: 'layer-create', actor, summary: `Added timeline "${layer.title}"`, after: layer });
    return layer;
  });
}

/** Rename a timeline and/or move it to another position among its siblings. */
export async function updateLayer(actor: Actor, sessionId: string, layerId: string, body: Record<string, unknown>): Promise<AnnotationLayer[]> {
  const title = body.title === undefined ? undefined : parseLayerTitle(body.title);
  const position = body.position;
  if (position !== undefined && (typeof position !== 'number' || !Number.isInteger(position) || position < 0)) throw new RequestError(400, 'position must be a non-negative integer.');
  return transaction(async (client) => {
    await requireAccess(actor.id, sessionId, 'annotate', client);
    const before = await requireLayer(client, sessionId, layerId);
    if (title !== undefined) await client.query('UPDATE annotation_layers SET title = $2 WHERE id = $1', [layerId, title]);
    if (position !== undefined) {
      const ids = (await client.query<{ id: string }>('SELECT id FROM annotation_layers WHERE terminal_session_id = $1 ORDER BY position, created_at FOR UPDATE', [sessionId])).rows.map((row) => row.id);
      const order = ids.filter((id) => id !== layerId);
      order.splice(position, 0, layerId);
      for (const [index, id] of order.entries()) await client.query('UPDATE annotation_layers SET position = $2 WHERE id = $1', [id, index]);
    }
    await recordRevision(client, { sessionId, action: 'layer-update', actor, summary: title !== undefined ? `Renamed timeline "${before.title}" to "${title}"` : `Moved timeline "${before.title}"`, before });
    return listLayers(sessionId, client);
  });
}

/** Delete a timeline and its annotations; their content stays in the history. */
export async function deleteLayer(actor: Actor, sessionId: string, layerId: string): Promise<void> {
  await transaction(async (client) => {
    await requireAccess(actor.id, sessionId, 'annotate', client);
    const layer = await requireLayer(client, sessionId, layerId);
    const removed = (await client.query<Annotation>(`SELECT ${ANNOTATION_COLUMNS} FROM annotations WHERE layer_id = $1`, [layerId])).rows;
    await client.query('DELETE FROM annotation_layers WHERE id = $1', [layerId]);
    await recordRevision(client, { sessionId, action: 'layer-delete', actor, summary: `Deleted timeline "${layer.title}" with ${removed.length} annotations`, before: { layer, annotations: removed } });
  });
}

export async function listLayers(sessionId: string, client: PoolClient | typeof db = db): Promise<AnnotationLayer[]> {
  return (await client.query<AnnotationLayer>(`SELECT ${LAYER_COLUMNS} FROM annotation_layers WHERE terminal_session_id = $1 ORDER BY position, created_at`, [sessionId])).rows;
}

const HISTORY_LIMIT = 500;

export async function listHistory(userId: string, sessionId: string): Promise<AnnotationRevision[]> {
  await requireAccess(userId, sessionId, 'view');
  return (await db.query<AnnotationRevision>(
    `SELECT id::text AS id, annotation_id AS "annotationId", action, actor_name AS "actorName", summary, created_at AS "createdAt"
     FROM annotation_revisions WHERE terminal_session_id = $1 ORDER BY annotation_revisions.id DESC LIMIT $2`,
    [sessionId, HISTORY_LIMIT],
  )).rows;
}
