"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toAssistantModelMessages = exports.textHistoryToModelMessages = exports.serializeAssistantParts = exports.boundAssistantContext = exports.HarnessRuntimeError = exports.runCodexHarness = void 0;
exports.sha256 = sha256;
exports.createOpaqueToken = createOpaqueToken;
exports.isSafeOAuthRedirect = isSafeOAuthRedirect;
exports.requireHttpsOrigin = requireHttpsOrigin;
exports.normalizeOAuthScopes = normalizeOAuthScopes;
exports.publicOAuthClientMetadata = publicOAuthClientMetadata;
exports.createOAuthTokenResponse = createOAuthTokenResponse;
exports.encryptJsonCredential = encryptJsonCredential;
exports.decryptJsonCredential = decryptJsonCredential;
const node_crypto_1 = require("node:crypto");
var harness_1 = require("./harness");
Object.defineProperty(exports, "runCodexHarness", { enumerable: true, get: function () { return harness_1.runCodexHarness; } });
Object.defineProperty(exports, "HarnessRuntimeError", { enumerable: true, get: function () { return harness_1.HarnessRuntimeError; } });
var chat_1 = require("./chat");
Object.defineProperty(exports, "boundAssistantContext", { enumerable: true, get: function () { return chat_1.boundAssistantContext; } });
Object.defineProperty(exports, "serializeAssistantParts", { enumerable: true, get: function () { return chat_1.serializeAssistantParts; } });
Object.defineProperty(exports, "textHistoryToModelMessages", { enumerable: true, get: function () { return chat_1.textHistoryToModelMessages; } });
Object.defineProperty(exports, "toAssistantModelMessages", { enumerable: true, get: function () { return chat_1.toAssistantModelMessages; } });
/** Hash bearer credentials before using them as persistent identifiers. */
function sha256(value) {
    return (0, node_crypto_1.createHash)('sha256').update(value).digest('hex');
}
/** Create an unguessable opaque token with an app-specific prefix. */
function createOpaqueToken(prefix) {
    if (!/^[a-z][a-z0-9-]{0,31}_$/.test(prefix))
        throw new Error('Invalid token prefix');
    return `${prefix}${(0, node_crypto_1.randomBytes)(32).toString('base64url')}`;
}
/** Allow HTTPS redirects and HTTP loopback redirects for local/native clients. */
function isSafeOAuthRedirect(value) {
    try {
        const url = new URL(value);
        if (url.username || url.password || url.hash)
            return false;
        return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
    }
    catch {
        return false;
    }
}
/** Validate app-configured public URLs as HTTPS origins, with no path/query/credentials. */
function requireHttpsOrigin(value, settingName) {
    if (!value)
        throw new Error(`${settingName} is required`);
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        throw new Error(`${settingName} must be an HTTPS origin`);
    }
    return url.origin;
}
/** Normalize scopes under the calling app's allowlist and required read scope. */
function normalizeOAuthScopes(scopes, readScope, allowedScopes) {
    const values = [...new Set(scopes?.length ? scopes : [readScope])];
    if (!values.includes(readScope) || values.some((scope) => !allowedScopes.has(scope)))
        throw new Error('Unsupported OAuth scope');
    return values;
}
/** Remove confidential client fields before storing or returning public metadata. */
function publicOAuthClientMetadata(client) {
    const metadata = Object.fromEntries(Object.entries(client).filter(([key]) => key !== 'client_secret' && key !== 'client_secret_expires_at'));
    return { ...metadata, token_endpoint_auth_method: 'none' };
}
/** Builds the consistent OAuth bearer response while leaving token lifetimes app-configurable. */
function createOAuthTokenResponse(accessToken, refreshToken, scopes, accessTokenTtlMs) {
    return {
        access_token: accessToken,
        ...(refreshToken ? { refresh_token: refreshToken } : {}),
        token_type: 'Bearer',
        expires_in: accessTokenTtlMs / 1000,
        scope: scopes.join(' '),
    };
}
/** Encrypt JSON using AES-256-GCM and identity-bound associated data. */
function encryptJsonCredential(value, key, associatedData) {
    assertEncryptionKey(key);
    const iv = (0, node_crypto_1.randomBytes)(12);
    const cipher = (0, node_crypto_1.createCipheriv)('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(associatedData));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}
/** Decrypt only when both the key and identity-bound associated data match. */
function decryptJsonCredential(stored, key, associatedData) {
    assertEncryptionKey(key);
    const decipher = (0, node_crypto_1.createDecipheriv)('aes-256-gcm', key, Buffer.from(stored.iv, 'base64'));
    decipher.setAAD(Buffer.from(associatedData));
    decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(stored.ciphertext, 'base64')), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
}
function assertEncryptionKey(key) {
    if (key.byteLength !== 32)
        throw new Error('Encryption key must be 32 bytes');
}
