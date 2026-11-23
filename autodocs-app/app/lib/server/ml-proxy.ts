// External
import type { NextRequest } from 'next/server';

// Ours
import { mlServiceUrl } from '@/app/lib/server/ml-jobs';

/** Public path under which the app exposes the ML service. */
export const ML_PROXY_PREFIX = '/ml-service';

/** Request headers that must not be forwarded to the ML service. */
const DROPPED_REQUEST_HEADERS = [
  'host', 'cookie', 'connection', 'keep-alive', 'upgrade', 'te', 'transfer-encoding', 'content-length', 'accept-encoding',
  // fetch refuses to forward "Expect: 100-continue", which curl sends for large uploads.
  'expect', 'x-forwarded-for', 'x-forwarded-host',
];

/** Response headers that describe a body encoding fetch has already undone. */
const DROPPED_RESPONSE_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding', 'connection'];

/**
 * Point an OpenAPI document from the ML service at the proxy, so that
 * "Try it out" in Swagger UI calls /ml-service/... on this app instead of the
 * ML service's private address.
 */
export function rewriteMlSpec(spec: Record<string, unknown>): Record<string, unknown> {
  const info = (spec.info ?? {}) as Record<string, unknown>;
  return {
    ...spec,
    info: { ...info, description: `${info.description ?? ''}\n\nCalls made from this page go through the AutoDocs app and require an administrator session.`.trim() },
    servers: [{ url: ML_PROXY_PREFIX }],
  };
}

/** Target URL on the ML service for a request path under the proxy prefix. */
export function mlTargetUrl(segments: readonly string[], search: string): string {
  const path = segments.map((segment) => encodeURIComponent(segment)).join('/');
  return `${mlServiceUrl()}/${path}${search}`;
}

/** True when a path segment could climb out of the ML service's URL space. */
export function hasUnsafeSegment(segments: readonly string[]): boolean {
  return segments.some((segment) => segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\'));
}

/** Fetch the ML service's own OpenAPI document and rewrite it for the proxy. */
export async function readMlOpenApi(): Promise<Record<string, unknown>> {
  const response = await fetch(`${mlServiceUrl()}/openapi.json`, { signal: AbortSignal.timeout(15_000), cache: 'no-store' });
  if (!response.ok) throw new Error(`ML service returned status ${response.status} for its OpenAPI document`);
  return rewriteMlSpec((await response.json()) as Record<string, unknown>);
}

/** The request headers worth sending to the ML service: no credentials, no hop-by-hop headers. */
export function forwardableHeaders(incoming: Headers): Headers {
  const headers = new Headers(incoming);
  for (const name of DROPPED_REQUEST_HEADERS) headers.delete(name);
  return headers;
}

/** Forward one request to the ML service and stream its answer back. */
export async function forwardToMl(request: NextRequest, segments: readonly string[]): Promise<Response> {
  const headers = forwardableHeaders(request.headers);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const upstream = await fetch(mlTargetUrl(segments, request.nextUrl.search), {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    // Required by fetch when the body is a stream.
    ...(hasBody ? { duplex: 'half' } : {}),
    redirect: 'manual',
    signal: request.signal,
  } as RequestInit);
  const responseHeaders = new Headers(upstream.headers);
  for (const name of DROPPED_RESPONSE_HEADERS) responseHeaders.delete(name);
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
}
