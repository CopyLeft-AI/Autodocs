// Ours
import type { JsonSchema } from './types';

/** Reference to a schema in components.schemas. */
export function ref(name: string): JsonSchema {
  return { $ref: `#/components/schemas/${name}` };
}

/** A JSON request body. */
export function jsonBody(schema: JsonSchema, description?: string): Record<string, unknown> {
  return { required: true, ...(description ? { description } : {}), content: { 'application/json': { schema } } };
}

/** A response with a JSON body. */
export function jsonResponse(description: string, schema: JsonSchema): Record<string, unknown> {
  return { description, content: { 'application/json': { schema } } };
}

/** A response whose body is `{ "message": "..." }`. */
export function errorResponse(description: string): Record<string, unknown> {
  return jsonResponse(description, ref('Message'));
}

/** The responses every signed-in endpoint can return. */
export const SIGNED_IN_ERRORS: Record<string, Record<string, unknown>> = {
  '401': errorResponse('Not signed in, or the session expired.'),
};

/** Signed-in errors plus the 403 returned when a right is missing. */
export const RIGHTS_ERRORS: Record<string, Record<string, unknown>> = {
  ...SIGNED_IN_ERRORS,
  '403': errorResponse('The signed-in user lacks the required right.'),
};

/** A path parameter. */
export function pathParameter(name: string, description: string): Record<string, unknown> {
  return { name, in: 'path', required: true, description, schema: { type: 'string', format: 'uuid' } };
}

export const STRING: JsonSchema = { type: 'string' };
export const BOOLEAN: JsonSchema = { type: 'boolean' };
export const UUID_STRING: JsonSchema = { type: 'string', format: 'uuid' };
