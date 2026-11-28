// Ours
import type { AnnotationChanges, AnnotationInput } from '@/app/lib/annotations/types';
import { RequestError } from './errors';

const MAX_TEXT = 20_000;
const MAX_MS = 2_000_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FIELDS: { [Key in keyof AnnotationInput]: (value: unknown) => boolean } = {
  layerId: (value) => typeof value === 'string' && UUID.test(value),
  startMs: isTime,
  endMs: isTime,
  text: (value) => typeof value === 'string' && value.length <= MAX_TEXT && !value.includes('\u0000'),
  depth: (value) => value === null || (typeof value === 'number' && Number.isInteger(value) && value >= -1 && value <= 100),
};

function isTime(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_MS;
}

function pickFields(body: Record<string, unknown>): AnnotationChanges {
  const picked: Record<string, unknown> = {};
  for (const [name, valid] of Object.entries(FIELDS)) {
    if (body[name] === undefined) continue;
    if (!valid(body[name])) throw new RequestError(400, `Invalid ${name}.`);
    picked[name] = body[name];
  }
  return picked as AnnotationChanges;
}

export function parseAnnotationInput(body: Record<string, unknown>): AnnotationInput {
  const { layerId, startMs, endMs, text = '', depth = null } = pickFields(body);
  if (layerId === undefined || startMs === undefined || endMs === undefined) throw new RequestError(400, 'layerId, startMs and endMs are required.');
  if (endMs < startMs) throw new RequestError(400, 'The end cannot be before the start.');
  return { layerId, startMs, endMs, text, depth };
}

export function parseAnnotationChanges(body: Record<string, unknown>): { changes: AnnotationChanges; expectedVersion: number } {
  const expectedVersion = body.expectedVersion;
  if (typeof expectedVersion !== 'number' || !Number.isInteger(expectedVersion)) throw new RequestError(400, 'expectedVersion is required.');
  return { changes: pickFields(body), expectedVersion };
}

export function parseLayerTitle(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120 || value.includes('\u0000')) throw new RequestError(400, 'A timeline title of 1 to 120 characters is required.');
  return value.trim();
}
