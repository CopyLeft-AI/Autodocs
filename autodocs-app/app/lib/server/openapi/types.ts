/** Minimal OpenAPI 3.0 types: only what the hand-written API description uses. */

export type JsonSchema = { [keyword: string]: unknown };

export interface OpenApiOperation {
  tags: string[];
  summary: string;
  description?: string;
  parameters?: Array<Record<string, unknown>>;
  requestBody?: Record<string, unknown>;
  responses: Record<string, Record<string, unknown>>;
}

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** The operations of one URL path, keyed by lower-case HTTP method. */
export type OpenApiPathItem = Partial<Record<HttpMethod, OpenApiOperation>>;

export type OpenApiPaths = Record<string, OpenApiPathItem>;

export interface OpenApiDocument {
  openapi: '3.0.3';
  info: { title: string; version: string; description: string };
  servers: Array<{ url: string }>;
  tags: Array<{ name: string; description: string }>;
  paths: OpenApiPaths;
  components: {
    schemas: Record<string, JsonSchema>;
  };
}
