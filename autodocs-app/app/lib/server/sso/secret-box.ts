// External
import crypto from 'crypto';

const FORMAT_VERSION = 'v1';
const KEY_SALT = 'autodocs-sso';

/**
 * Derive a 32-byte key for one purpose from the deployment secret.
 * `SSO_SECRET_KEY` is used when set, otherwise `JWT_SECRET`. Distinct purposes give unrelated keys, so a
 * signed-cookie key can never decrypt a stored client secret. Changing the base secret makes stored client
 * secrets unreadable: administrators then enter them again.
 */
export function deriveKey(purpose: string): Buffer {
  const base = process.env.SSO_SECRET_KEY || process.env.JWT_SECRET;
  if (!base) throw new Error('Neither SSO_SECRET_KEY nor JWT_SECRET is set');
  return Buffer.from(crypto.hkdfSync('sha256', base, KEY_SALT, purpose, 32));
}

/**
 * Encrypt a client secret with AES-256-GCM. `context` (the provider id) is authenticated but not stored, so a
 * ciphertext copied to another provider's row fails to decrypt.
 */
export function encryptSecret(plaintext: string, context: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey('client-secret'), iv);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [FORMAT_VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join(':');
}

/** Decrypt a value made by encryptSecret; null when it is malformed, was made with another key or another context. */
export function decryptSecret(stored: string, context: string): string | null {
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey('client-secret'), Buffer.from(parts[1], 'base64url'));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
