/**
 * @fileoverview A call's principal binding (`spec/authorization.md`, M8): who is calling, as one
 * canonical JSON text that confirmation and approval-relay `requestState` bind (#532).
 *
 * Loads no Node.js built-in: the canonical JSON is the approval tokens' (`approval-crypto.ts`),
 * which runs in the browser too.
 */

import type { Actor } from '@lushly-dev/afd-core';
import { canonicalJson } from './approval-crypto.js';

/**
 * The identity of a call's verified credentials (`spec/authorization.md`, M4): the token's issuer,
 * subject and client. A principal binding holds these three and nothing else of the credentials
 * (never scopes, times or the resource).
 *
 * TypeScript does not verify tokens yet. A host that does sets them on the context as
 * `credentials` (from `createContext`); the server binds them when the context carries them.
 */
export interface PrincipalCredentials {
	issuer: string;
	subject: string;
	clientId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The credentials' identity, or `null` without credentials.
 *
 * @throws TypeError for credentials without a non-empty string `issuer`, `subject` and
 *   `clientId`: a binding that could not tell two callers apart must not be issued
 */
function identity(credentials: unknown): Record<string, string> | null {
	if (credentials === undefined || credentials === null) return null;
	const named = (value: unknown) => typeof value === 'string' && value.length > 0;
	if (
		!isRecord(credentials) ||
		!named(credentials.issuer) ||
		!named(credentials.subject) ||
		!named(credentials.clientId)
	) {
		throw new TypeError('credentials must carry a non-empty issuer, subject and clientId');
	}
	return {
		issuer: credentials.issuer as string,
		subject: credentials.subject as string,
		clientId: credentials.clientId as string,
	};
}

/**
 * The actor's `kind`, `id` and `onBehalfOf` (never `label`), or `null` without an actor.
 *
 * @throws TypeError for an actor that is not an object
 */
function actorIdentity(actor: unknown): Record<string, unknown> | null {
	if (actor === undefined || actor === null) return null;
	if (!isRecord(actor)) throw new TypeError('actor must be an object');
	return { kind: actor.kind, id: actor.id, onBehalfOf: actor.onBehalfOf };
}

/**
 * A call's principal binding (`spec/authorization.md`, M8): the canonical JSON of
 * `{ actor, credentials }`, where the actor is its `kind`, `id` and `onBehalfOf` (never `label`)
 * and the credentials are their `issuer`, `subject` and `clientId`, each `null` when absent. Two
 * calls share a binding only when their actor and their token's issuer, subject and client are
 * the same: a different client of the same person is a different principal.
 *
 * The result names the caller: bind it (as HMAC input or associated data), never log or send it.
 *
 * @throws TypeError for an actor that is not an object, or credentials without a non-empty
 *   string `issuer`, `subject` and `clientId`
 */
export function principalBinding(
	actor: Actor | null | undefined,
	credentials?: PrincipalCredentials | null
): string {
	return canonicalJson({ actor: actorIdentity(actor), credentials: identity(credentials) });
}

/**
 * The credentials' part of a principal binding alone (relay evidence's `credentialsBinding`):
 * the canonical JSON of `{ issuer, subject, clientId }`, or `null` without credentials.
 *
 * @throws TypeError for credentials without a non-empty string `issuer`, `subject` and `clientId`
 */
export function credentialsBinding(credentials?: PrincipalCredentials | null): string {
	return canonicalJson(identity(credentials));
}
