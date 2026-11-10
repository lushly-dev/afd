/**
 * @fileoverview Transport-free entry point: `@lushly-dev/afd-server/credentials`
 *
 * `isVerifiedCredentials` alone, so a host can tell afd-auth's middleware which `credentials`
 * afd-server verified without loading the server, the MCP SDK or a Node.js builtin.
 *
 * @example
 * ```typescript
 * import { createAuthMiddleware } from '@lushly-dev/afd-auth';
 * import { isVerifiedCredentials } from '@lushly-dev/afd-server/credentials';
 *
 * const auth = createAuthMiddleware(adapter, { isVerifiedCredentials });
 * ```
 */

export type { Credentials } from './mcp-auth-rules.js';
export { isVerifiedCredentials } from './verified-credentials.js';
