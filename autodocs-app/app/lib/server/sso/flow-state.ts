// External
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
// Ours
import { deriveKey } from '@/app/lib/server/sso/secret-box';
import type { SsoProviderId } from '@/app/lib/server/sso/types';

export const SSO_FLOW_COOKIE = 'sso_flow';
export const SSO_FLOW_TTL_SECONDS = 600;
/** The flow cookie is only sent to the sign-in routes. */
export const SSO_FLOW_COOKIE_PATH = '/api/auth/sso';

/** What the server must remember between sending the browser to the provider and the provider's callback. */
export interface SsoFlowState {
  provider: SsoProviderId;
  /** Random value echoed by the provider; ties the callback to this browser (CSRF protection). */
  state: string;
  /** Random value the provider puts inside the ID token (replay protection). */
  nonce: string;
  /** PKCE secret whose SHA-256 was sent as the code challenge. */
  codeVerifier: string;
}

/** A fresh state, nonce and PKCE pair for one sign-in attempt. */
export function createFlowState(provider: SsoProviderId): SsoFlowState & { codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(48).toString('base64url');
  return {
    provider,
    state: crypto.randomBytes(24).toString('base64url'),
    nonce: crypto.randomBytes(24).toString('base64url'),
    codeVerifier,
    codeChallenge: crypto.createHash('sha256').update(codeVerifier).digest('base64url'),
  };
}

/** Sign the flow state into the value of the flow cookie. */
export function sealFlowState(flow: SsoFlowState): string {
  return jwt.sign(
    { provider: flow.provider, state: flow.state, nonce: flow.nonce, verifier: flow.codeVerifier },
    deriveKey('flow-cookie'),
    { algorithm: 'HS256', expiresIn: SSO_FLOW_TTL_SECONDS },
  );
}

/** Read the flow cookie; null when absent, forged, expired or issued for another provider. */
export function openFlowState(cookieValue: string | undefined, provider: SsoProviderId): SsoFlowState | null {
  if (!cookieValue) return null;
  try {
    const claims = jwt.verify(cookieValue, deriveKey('flow-cookie'), { algorithms: ['HS256'] }) as Record<string, unknown>;
    if (claims.provider !== provider) return null;
    if (typeof claims.state !== 'string' || typeof claims.nonce !== 'string' || typeof claims.verifier !== 'string') return null;
    return { provider, state: claims.state, nonce: claims.nonce, codeVerifier: claims.verifier };
  } catch {
    return null;
  }
}

/** Constant-time comparison of the state echoed by the provider with the remembered one. */
export function statesMatch(expected: string, received: string | null): boolean {
  if (received === null) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
