import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export type EncryptedJson = { ciphertext: string; iv: string; tag: string };

/** Hash bearer credentials before using them as persistent identifiers. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Create an unguessable opaque token with an app-specific prefix. */
export function createOpaqueToken(prefix: string): string {
  if (!/^[a-z][a-z0-9-]{0,31}_$/.test(prefix)) throw new Error('Invalid token prefix');
  return `${prefix}${randomBytes(32).toString('base64url')}`;
}

/** Allow HTTPS redirects and HTTP loopback redirects for local/native clients. */
export function isSafeOAuthRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch {
    return false;
  }
}

/** Validate app-configured public URLs as HTTPS origins, with no path/query/credentials. */
export function requireHttpsOrigin(value: string | undefined, settingName: string): string {
  if (!value) throw new Error(`${settingName} is required`);
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${settingName} must be an HTTPS origin`);
  }
  return url.origin;
}

/** Normalize scopes under the calling app's allowlist and required read scope. */
export function normalizeOAuthScopes(scopes: string[] | undefined, readScope: string, allowedScopes: ReadonlySet<string>): string[] {
  const values = [...new Set(scopes?.length ? scopes : [readScope])];
  if (!values.includes(readScope) || values.some((scope) => !allowedScopes.has(scope))) throw new Error('Unsupported OAuth scope');
  return values;
}

/** Remove confidential client fields before storing or returning public metadata. */
export function publicOAuthClientMetadata<T extends Record<string, unknown>>(
  client: T,
): T & { token_endpoint_auth_method: 'none' } {
  const metadata = Object.fromEntries(Object.entries(client).filter(([key]) => key !== 'client_secret' && key !== 'client_secret_expires_at'));
  return { ...metadata, token_endpoint_auth_method: 'none' } as T & { token_endpoint_auth_method: 'none' };
}

/** Encrypt JSON using AES-256-GCM and identity-bound associated data. */
export function encryptJsonCredential(value: unknown, key: Uint8Array, associatedData: string): EncryptedJson {
  assertEncryptionKey(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(associatedData));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

/** Decrypt only when both the key and identity-bound associated data match. */
export function decryptJsonCredential<T>(stored: EncryptedJson, key: Uint8Array, associatedData: string): T {
  assertEncryptionKey(key);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(stored.iv, 'base64'));
  decipher.setAAD(Buffer.from(associatedData));
  decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(stored.ciphertext, 'base64')), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}

function assertEncryptionKey(key: Uint8Array): void {
  if (key.byteLength !== 32) throw new Error('Encryption key must be 32 bytes');
}
