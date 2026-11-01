const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../dist/index.js');

test('hashes and generates prefixed opaque tokens', () => {
  assert.equal(core.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.match(core.createOpaqueToken('fitpal_'), /^fitpal_[A-Za-z0-9_-]{43}$/);
});

test('validates OAuth redirects and public origins', () => {
  assert.equal(core.isSafeOAuthRedirect('https://client.example/callback'), true);
  assert.equal(core.isSafeOAuthRedirect('http://localhost:3000/callback'), true);
  assert.equal(core.isSafeOAuthRedirect('https://user:pass@example.com/callback'), false);
  assert.equal(core.isSafeOAuthRedirect('http://evil.example/callback'), false);
  assert.equal(core.requireHttpsOrigin('https://app.example/', 'APP_URL'), 'https://app.example');
  assert.throws(() => core.requireHttpsOrigin('https://app.example/path', 'APP_URL'));
});

test('normalizes scopes and strips confidential metadata', () => {
  assert.deepEqual(core.normalizeOAuthScopes(['app:read', 'app:read'], 'app:read', new Set(['app:read'])), ['app:read']);
  assert.throws(() => core.normalizeOAuthScopes(['app:write'], 'app:read', new Set(['app:read', 'app:write'])));
  assert.deepEqual(core.publicOAuthClientMetadata({ client_id: 'id', client_secret: 'secret', client_secret_expires_at: 1 }), { client_id: 'id', token_endpoint_auth_method: 'none' });
});

test('formats bearer token responses consistently', () => {
  assert.deepEqual(core.createOAuthTokenResponse('access', undefined, ['app:read'], 3600000), {
    access_token: 'access', token_type: 'Bearer', expires_in: 3600, scope: 'app:read',
  });
});

test('encrypts credentials and binds ciphertext to identity', () => {
  const key = Buffer.alloc(32, 7);
  const encrypted = core.encryptJsonCredential({ access: 'secret' }, key, 'uid:codex');
  assert.deepEqual(core.decryptJsonCredential(encrypted, key, 'uid:codex'), { access: 'secret' });
  assert.throws(() => core.decryptJsonCredential(encrypted, key, 'other-user:codex'));
});
