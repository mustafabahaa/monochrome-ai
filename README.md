# Monochrome AI Core

App-neutral security primitives shared by Monochrome applications that expose AI and MCP integrations.

The package deliberately does not own product behavior. Apps retain their OAuth scopes, token prefixes, resource URLs, Firebase identity checks, storage collections, AI provider choices, tool registries, and user-facing errors. This package centralizes cryptographic and OAuth validation mechanics so those implementations cannot drift independently.

Included primitives: SHA-256 identifiers and opaque token generation; safe OAuth redirect and HTTPS-origin validation; scope normalization and public client metadata; AES-256-GCM JSON credential encryption with identity-bound associated data.

```sh
npm install
npm test
```

Node.js 20 or newer is required. Consumers must provide a 32-byte encryption key for credential encryption.
