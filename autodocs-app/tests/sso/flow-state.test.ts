import { beforeAll, describe, expect, test } from 'bun:test';
import jwt from 'jsonwebtoken';
import { createFlowState, openFlowState, sealFlowState, statesMatch } from '@/app/lib/server/sso/flow-state';
import { deriveKey } from '@/app/lib/server/sso/secret-box';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret';
});

describe('flow state', () => {
  test('creates unpredictable values and a matching S256 PKCE challenge', () => {
    const first = createFlowState('google');
    const second = createFlowState('google');
    expect(first.state).not.toBe(second.state);
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.codeVerifier.length).toBeGreaterThanOrEqual(43);
    const expected = new Bun.CryptoHasher('sha256').update(first.codeVerifier).digest('base64url');
    expect(first.codeChallenge).toBe(expected);
  });

  test('seals and opens the same state for the same provider', () => {
    const flow = createFlowState('okta');
    const opened = openFlowState(sealFlowState(flow), 'okta');
    expect(opened).toEqual({ provider: 'okta', state: flow.state, nonce: flow.nonce, codeVerifier: flow.codeVerifier });
  });

  test('refuses a cookie issued for another provider, a missing cookie and a forged one', () => {
    const sealed = sealFlowState(createFlowState('okta'));
    expect(openFlowState(sealed, 'google')).toBeNull();
    expect(openFlowState(undefined, 'okta')).toBeNull();
    expect(openFlowState('garbage', 'okta')).toBeNull();
    const forged = jwt.sign({ provider: 'okta', state: 's', nonce: 'n', verifier: 'v' }, 'wrong-key', { algorithm: 'HS256' });
    expect(openFlowState(forged, 'okta')).toBeNull();
  });

  test('refuses an expired cookie', () => {
    const expired = jwt.sign({ provider: 'okta', state: 's', nonce: 'n', verifier: 'v' }, deriveKey('flow-cookie'), { algorithm: 'HS256', expiresIn: -10 });
    expect(openFlowState(expired, 'okta')).toBeNull();
  });

  test('an access token signed with the login secret is not a flow cookie', () => {
    const accessToken = jwt.sign({ provider: 'okta', state: 's', nonce: 'n', verifier: 'v' }, 'test-jwt-secret', { algorithm: 'HS256' });
    expect(openFlowState(accessToken, 'okta')).toBeNull();
  });

  test('compares states in constant time and rejects missing or different values', () => {
    expect(statesMatch('abc', 'abc')).toBe(true);
    expect(statesMatch('abc', 'abd')).toBe(false);
    expect(statesMatch('abc', 'abcd')).toBe(false);
    expect(statesMatch('abc', null)).toBe(false);
  });
});
