// External
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

// Ours
import { OPENAPI_DOCUMENT } from '../app/lib/server/openapi/document';

const API_ROOT = join(import.meta.dir, '..', 'app', 'api');
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

interface RouteOperation {
  path: string;
  method: string;
}

/** Every `route.ts` under app/api with the HTTP methods it exports, as OpenAPI paths. */
async function readRouteOperations(): Promise<RouteOperation[]> {
  const operations: RouteOperation[] = [];
  for await (const file of new Bun.Glob('**/route.ts').scan({ cwd: API_ROOT })) {
    const source = await Bun.file(join(API_ROOT, file)).text();
    const directory = file.replace(/\/?route\.ts$/, '');
    const path = `/api/${directory}`.replace(/\[(\w+)\]/g, '{$1}');
    for (const method of HTTP_METHODS) {
      if (new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`).test(source)) operations.push({ path, method: method.toLowerCase() });
    }
  }
  return operations;
}

function describedOperations(): RouteOperation[] {
  return Object.entries(OPENAPI_DOCUMENT.paths).flatMap(([path, item]) => Object.keys(item).map((method) => ({ path, method })));
}

const key = (operation: RouteOperation): string => `${operation.method.toUpperCase()} ${operation.path}`;

describe('the app API description matches the route files', () => {
  test('every route handler is described', async () => {
    const described = new Set(describedOperations().map(key));
    const missing = (await readRouteOperations()).map(key).filter((operation) => !described.has(operation));
    expect(missing).toEqual([]);
  });

  test('every described operation has a route handler', async () => {
    const existing = new Set((await readRouteOperations()).map(key));
    const stale = describedOperations().map(key).filter((operation) => !existing.has(operation));
    expect(stale).toEqual([]);
  });

  test('path parameters are declared for every {placeholder}', () => {
    for (const [path, item] of Object.entries(OPENAPI_DOCUMENT.paths)) {
      const placeholders = [...path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
      for (const [method, operation] of Object.entries(item)) {
        const declared = (operation.parameters ?? []).map((parameter) => parameter.name);
        expect({ operation: `${method} ${path}`, declared: [...declared].sort() }).toEqual({ operation: `${method} ${path}`, declared: [...placeholders].sort() });
      }
    }
  });

  test('every operation has a declared tag, a summary and a response', () => {
    const tags = new Set(OPENAPI_DOCUMENT.tags.map((tag) => tag.name));
    for (const [path, item] of Object.entries(OPENAPI_DOCUMENT.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        expect(operation.summary.length).toBeGreaterThan(0);
        expect(Object.keys(operation.responses).length).toBeGreaterThan(0);
        for (const tag of operation.tags) expect({ at: `${method} ${path}`, known: tags.has(tag) }).toEqual({ at: `${method} ${path}`, known: true });
      }
    }
  });

  test('every $ref points to a defined schema', () => {
    const text = JSON.stringify(OPENAPI_DOCUMENT);
    const names = new Set(Object.keys(OPENAPI_DOCUMENT.components.schemas));
    const referenced = [...text.matchAll(/#\/components\/schemas\/(\w+)/g)].map((match) => match[1]);
    expect(referenced.filter((name) => !names.has(name))).toEqual([]);
    expect(referenced.length).toBeGreaterThan(0);
  });

  test('the document survives a JSON round trip (it is served as JSON)', () => {
    expect(JSON.parse(JSON.stringify(OPENAPI_DOCUMENT)).openapi).toBe('3.0.3');
  });
});
