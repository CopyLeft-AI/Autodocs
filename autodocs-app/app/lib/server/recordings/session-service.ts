// External
import type { PoolClient } from 'pg';

// Ours
import { reconstructRecording, timeAnalysisEvents } from '@/app/lib/annotations/legacy';
import { readLibrecodeAnnotations, writeLibrecodeAnnotations, type ExportLayer } from '@/app/lib/annotations/librecode';
import type { Annotation, SessionDetail } from '@/app/lib/annotations/types';
import { parseCast, toVersion2, type Recording } from '@/app/lib/cast/parse';
import { db } from '@/app/lib/server/db';
import { parseSessionContent } from '@/app/lib/session-content';
import { requireAccess, transaction } from './access';
import { listLayers } from './annotation-service';
import { ANNOTATION_COLUMNS, insertAnnotatedLayer, insertLayer, type Actor } from './annotation-store';
import { RequestError } from './errors';

export const MAX_RECORDING_BYTES = 50 * 1024 * 1024;
const EMPTY_CONTENT = JSON.stringify({ version: 2, events: [] });

export interface CreatedSession {
  id: string;
  title: string;
  durationSeconds: number;
  content: string;
  createdAt: string;
}

export function readRecording(content: unknown): { text: string; recording: Recording } {
  if (typeof content !== 'string' || !content.trim()) throw new RequestError(400, 'content is required.');
  if (Buffer.byteLength(content) > MAX_RECORDING_BYTES) throw new RequestError(413, 'The recording is larger than 50 MB.');
  const parsed = parseCast(content);
  if (!parsed.ok) throw new RequestError(400, parsed.error);
  // PostgreSQL cannot store a literal NUL; valid JSON recordings only carry it escaped.
  return { text: content.replaceAll('\u0000', ''), recording: parsed.recording };
}

/**
 * Store an uploaded recording, owned by `actor`, without analysing it.
 * Annotations carried in its header are imported; otherwise it gets one empty timeline.
 */
export async function createSession(actor: Actor, input: { title: unknown; content: unknown }): Promise<CreatedSession> {
  const title = typeof input.title === 'string' ? input.title.replaceAll('\u0000', '').trim().slice(0, 300) : '';
  if (!title) throw new RequestError(400, 'title is required.');
  const { text, recording } = readRecording(input.content);
  return transaction(async (client) => {
    const session = (await client.query<CreatedSession>(
      `INSERT INTO terminal_sessions (title, duration_seconds, content, recording, legacy_imported)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING id, title, duration_seconds AS "durationSeconds", content, created_at AS "createdAt"`,
      [title, Math.round(recording.durationMs / 1000), EMPTY_CONTENT, text],
    )).rows[0];
    await client.query('INSERT INTO terminal_session_access (user_id, terminal_session_id, owner) VALUES ($1, $2, TRUE)', [actor.id, session.id]);
    const imported = readLibrecodeAnnotations(recording.header);
    for (const layer of imported) await insertAnnotatedLayer(client, session.id, layer, { origin: 'imported', actor });
    if (imported.length === 0) await insertLayer(client, session.id, 'Annotations');
    return session;
  });
}

interface SessionRow {
  id: string;
  title: string;
  durationSeconds: number;
  content: string;
  createdAt: string;
  recording: string | null;
  legacyImported: boolean;
}

async function selectSession(sessionId: string, client: PoolClient | typeof db, lock = false): Promise<SessionRow> {
  const row = (await client.query<SessionRow>(
    `SELECT id, title, duration_seconds AS "durationSeconds", content, created_at AS "createdAt", recording,
            legacy_imported AS "legacyImported"
     FROM terminal_sessions WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`,
    [sessionId],
  )).rows[0];
  if (!row) throw new RequestError(404, 'Session not found.');
  return row;
}

/** Sessions analysed before annotations became records are converted the first time they are opened. */
async function importLegacyContent(sessionId: string): Promise<void> {
  await transaction(async (client) => {
    const row = await selectSession(sessionId, client, true);
    if (row.legacyImported) return;
    const events = parseSessionContent(row.content);
    const owner = (await client.query<{ id: string; name: string }>(
      `SELECT u.id, u.name FROM terminal_session_access a JOIN users u ON u.id = a.user_id
       WHERE a.terminal_session_id = $1 AND a.owner LIMIT 1`,
      [sessionId],
    )).rows[0];
    if (events.length > 0 && owner) {
      const annotations = timeAnalysisEvents(events, row.durationSeconds * 1000);
      await insertAnnotatedLayer(client, sessionId, { title: 'AI analysis (earlier version)', annotations }, { origin: 'ai', actor: owner });
    } else {
      await insertLayer(client, sessionId, 'Annotations');
    }
    await client.query('UPDATE terminal_sessions SET legacy_imported = TRUE WHERE id = $1', [sessionId]);
  });
}

export async function getSessionDetail(userId: string, sessionId: string): Promise<SessionDetail> {
  const access = await requireAccess(userId, sessionId, 'view');
  let row = await selectSession(sessionId, db);
  if (!row.legacyImported) {
    await importLegacyContent(sessionId);
    row = await selectSession(sessionId, db);
  }
  const annotations = (await db.query<Annotation>(
    `SELECT ${ANNOTATION_COLUMNS} FROM annotations WHERE terminal_session_id = $1 ORDER BY start_ms, end_ms DESC, created_at, id`,
    [sessionId],
  )).rows;
  return {
    id: row.id, title: row.title, durationSeconds: row.durationSeconds, createdAt: row.createdAt, access,
    recordingSource: row.recording ? 'original' : reconstructRecording(parseSessionContent(row.content)) ? 'reconstructed' : 'missing',
    layers: await listLayers(sessionId),
    annotations,
  };
}

/** The recording to play: the original file, or one rebuilt from stored event XML. */
export async function loadRecordingText(userId: string, sessionId: string): Promise<{ title: string; text: string }> {
  await requireAccess(userId, sessionId, 'view');
  const row = await selectSession(sessionId, db);
  if (row.recording) return { title: row.title, text: row.recording };
  const rebuilt = reconstructRecording(parseSessionContent(row.content));
  if (!rebuilt) throw new RequestError(404, 'The original recording of this session was never stored.');
  return { title: row.title, text: toVersion2(rebuilt) };
}

/** The recording as a download, optionally with the current annotations written into its header. */
export async function exportRecording(userId: string, sessionId: string, withAnnotations: boolean): Promise<{ fileName: string; text: string }> {
  let detail: SessionDetail | null = null;
  if (withAnnotations) detail = await getSessionDetail(userId, sessionId);
  const { title, text } = await loadRecordingText(userId, sessionId);
  const fileName = `${title}${detail ? '.annotated' : ''}.cast`;
  if (!detail) return { fileName, text };
  const layers: ExportLayer[] = detail.layers.map((layer) => ({
    title: layer.title,
    annotations: detail.annotations.filter((annotation) => annotation.layerId === layer.id).map((annotation) => ({
      id: annotation.id, startMs: annotation.startMs, endMs: annotation.endMs, text: annotation.text, depth: annotation.depth,
      provenance: { origin: annotation.origin, author: annotation.authorName, model: annotation.aiModel, editedBy: annotation.editedByName },
    })),
  }));
  return { fileName, text: writeLibrecodeAnnotations(text, layers) };
}
