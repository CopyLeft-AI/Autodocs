// External
import { beforeEach, describe, expect, test } from 'bun:test';

// Ours
import { forwardableHeaders, hasUnsafeSegment, mlTargetUrl, rewriteMlSpec } from '../app/lib/server/ml-proxy';

beforeEach(() => {
  process.env.ML_URL = 'http://ml.internal:8500/';
});

describe('ML service proxy helpers', () => {
  test('rewriteMlSpec points Try it out at the proxy and keeps the operations', () => {
    const spec = { openapi: '3.1.0', info: { title: 'x', description: 'About.' }, paths: { '/config': { get: {} } }, servers: [{ url: 'http://private' }] };
    const rewritten = rewriteMlSpec(spec) as { servers: Array<{ url: string }>; info: { description: string }; paths: unknown };
    expect(rewritten.servers).toEqual([{ url: '/ml-service' }]);
    expect(rewritten.info.description).toContain('About.');
    expect(rewritten.info.description).toContain('administrator');
    expect(rewritten.paths).toEqual(spec.paths);
  });

  test('rewriteMlSpec copes with a spec that has no info description', () => {
    expect((rewriteMlSpec({ paths: {} }).info as { description: string }).description).toContain('administrator');
  });

  test('mlTargetUrl joins the base, the path and the query string', () => {
    expect(mlTargetUrl(['jobs', 'abc'], '?a=1')).toBe('http://ml.internal:8500/jobs/abc?a=1');
    expect(mlTargetUrl([], '')).toBe('http://ml.internal:8500/');
    expect(mlTargetUrl(['a b'], '')).toBe('http://ml.internal:8500/a%20b');
  });

  test('mlTargetUrl needs ML_URL', () => {
    delete process.env.ML_URL;
    expect(() => mlTargetUrl(['config'], '')).toThrow('ML_URL');
  });

  test('hasUnsafeSegment rejects traversal and separators', () => {
    expect(hasUnsafeSegment(['jobs', '..'])).toBe(true);
    expect(hasUnsafeSegment(['.'])).toBe(true);
    expect(hasUnsafeSegment(['a/b'])).toBe(true);
    expect(hasUnsafeSegment(['a\\b'])).toBe(true);
    expect(hasUnsafeSegment(['jobs', 'abc'])).toBe(false);
    expect(hasUnsafeSegment([])).toBe(false);
  });

  test('forwardableHeaders keeps content headers and drops credentials and headers fetch refuses', () => {
    const headers = forwardableHeaders(new Headers({
      'content-type': 'application/json', cookie: 'access_token=secret', expect: '100-continue', host: 'app', 'transfer-encoding': 'chunked', accept: '*/*',
    }));
    expect([...headers.keys()].sort()).toEqual(['accept', 'content-type']);
  });
});
