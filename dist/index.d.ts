export type EncryptedJson = {
    ciphertext: string;
    iv: string;
    tag: string;
};
/** Hash bearer credentials before using them as persistent identifiers. */
export declare function sha256(value: string): string;
/** Create an unguessable opaque token with an app-specific prefix. */
export declare function createOpaqueToken(prefix: string): string;
/** Allow HTTPS redirects and HTTP loopback redirects for local/native clients. */
export declare function isSafeOAuthRedirect(value: string): boolean;
/** Validate app-configured public URLs as HTTPS origins, with no path/query/credentials. */
export declare function requireHttpsOrigin(value: string | undefined, settingName: string): string;
/** Normalize scopes under the calling app's allowlist and required read scope. */
export declare function normalizeOAuthScopes(scopes: string[] | undefined, readScope: string, allowedScopes: ReadonlySet<string>): string[];
/** Remove confidential client fields before storing or returning public metadata. */
export declare function publicOAuthClientMetadata<T extends Record<string, unknown>>(client: T): T & {
    token_endpoint_auth_method: 'none';
};
/** Encrypt JSON using AES-256-GCM and identity-bound associated data. */
export declare function encryptJsonCredential(value: unknown, key: Uint8Array, associatedData: string): EncryptedJson;
/** Decrypt only when both the key and identity-bound associated data match. */
export declare function decryptJsonCredential<T>(stored: EncryptedJson, key: Uint8Array, associatedData: string): T;
