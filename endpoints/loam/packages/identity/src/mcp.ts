/**
 * @fileoverview Identity over MCP (phase 3 specification, 9.2 and 9.3; step 7): the token layer the hosted server puts
 * in front of its kernel, in two places, so that a refusal about the token is an HTTP 401 and one about Loam is a tool
 * error.
 *
 * - **`createMcpAuth`** gives `createMcpHandler` its `auth`: AFD's `JwtVerifier` on the provider's own keys, the
 *   audience the one MCP resource, and 9.2's verifier steps around it: the issuer exactly the provider's
 *   (`PRINCIPAL_ISSUER_UNKNOWN`, 401 `invalid_token`) and the subject a person's (`AGENT_CANNOT_SIGN_IN`, 401). Its
 *   scopes are 9.3's: `loam:read` for every request, and `loam:write` for every mutation, a command the registry does
 *   not know counting as one (D65).
 * - **`credentialsGate`**, the MCP handler's first middleware, before the kernel's chain: it refuses a call with no
 *   verified credentials (the fail-closed backstop of the 401), maps them with {@link principalOf} (9.2's steps 3 to 6)
 *   and puts the principal on the call, which the kernel's `principalGate` trusts because its kernel minted it.
 */

import { type CommandMiddleware, failure } from '@lushly-dev/afd-core';
import {
	type Credentials,
	type JwtIssuer,
	JwtVerifier,
	jwksKeySource,
	type KeySource,
	type McpAuthOptions,
	type ScopeResolver,
	staticDecision,
	type TokenVerifier,
} from '@lushly-dev/afd-server';
import { isVerifiedCredentials } from '@lushly-dev/afd-server/credentials';
import type { KernelPrincipalV1, PrincipalInputV1 } from '@lushly-dev/loam-kernel';
import { membershipOf } from './binding.js';
import {
	type ConnectedAgentV1,
	type ConnectionAdapter,
	connectedAgentOf,
	connectionOf,
} from './connected-agents.js';
import { ACCESS_TOKEN_SECONDS, LOAM_SCOPES } from './oauth.js';

/** No person's id may start with it (3.2): a token whose subject does is refused. */
const AGENT_PREFIX = 'agt_';

/** What the token layer reads of the provider: its issuer, its keys and its database. */
export interface McpProviderV1 {
	/** The provider's exact `iss`: Better Auth's base URL and path, as `https://acme.example/api/auth`. */
	issuer: string;
	/** The provider's signing keys: in process, `auth.api.getJwks()`'s document. */
	keys: KeySource;
	/** The provider's database adapter, once Better Auth has initialized it. */
	adapter(): Promise<ConnectionAdapter>;
	/** The workspace whose binding names the organization (2.3). */
	workspace: string;
}

/**
 * A key source over the JWKS document the provider answers in process (`auth.api.getJwks()`): AFD's `jwksKeySource`,
 * which reloads on an unknown `kid` at most once in a while, bounds how long loaded keys are used, so a key the provider
 * retires stops verifying, and shares a reload among concurrent requests. Nothing is fetched over a network.
 */
export function providerKeys(load: () => Promise<unknown>): KeySource {
	return jwksKeySource(load);
}

/** 9.2's verifier steps 1 and 2 around AFD's own: the issuer exactly the provider's, and the subject a person. */
export function loamVerifier(inner: TokenVerifier, issuer: string): TokenVerifier {
	return {
		...(inner.rules ? { rules: inner.rules } : {}),
		issuers: [issuer],
		async verify(token, request) {
			const verified = await inner.verify(token, request);
			if (!verified.ok) {
				// Another issuer's token is Loam's own code, still a 401 `invalid_token` (M5): fail closed.
				return verified.rule === 'unknown-issuer' || verified.rule === 'issuer'
					? { ok: false, rule: 'PRINCIPAL_ISSUER_UNKNOWN' }
					: verified;
			}
			const { credentials } = verified;
			if (credentials.issuer !== issuer) return { ok: false, rule: 'PRINCIPAL_ISSUER_UNKNOWN' };
			if (credentials.subject.startsWith(AGENT_PREFIX))
				return { ok: false, rule: 'AGENT_CANNOT_SIGN_IN' };
			return verified;
		},
	};
}

/** AFD's own discovery tools, which read only the served list: the only names outside the registry that are reads. */
export const DISCOVERY_TOOLS: ReadonlySet<string> = new Set([
	'afd-discover',
	'afd-detail',
	'afd-help',
	'afd-docs',
	'afd-schema',
]);

/** 9.3's resolver: `loam:write` for every mutation; a command the registry does not hold counts as one (D65). */
export function loamScopes(isMutation: (command: string) => boolean | undefined): ScopeResolver {
	const required = ['loam:read'];
	return {
		resolve(command, _input, credentials: Credentials) {
			// AFD's discovery tools read the list alone; any other name the registry does not hold is a mutation.
			const mutation = isMutation(command) ?? !DISCOVERY_TOOLS.has(command);
			return staticDecision(required, mutation ? ['loam:write'] : [], credentials.scopes);
		},
		visible: () => true,
	};
}

export interface McpAuthConfig {
	/** The hosted server's canonical MCP URI, `https://<host><base_path>mcp`: the one audience accepted. */
	resource: string;
	provider: Pick<McpProviderV1, 'issuer' | 'keys'>;
	/** The registry's `mutation` flag by name, undefined for a command it does not hold. */
	isMutation(command: string): boolean | undefined;
	/** The metadata's `resource_name`. */
	resourceName?: string;
	/** Receives each refused token's rule code, never the token. Default AFD's warning line. */
	onRefusal?: McpAuthOptions['onRefusal'];
}

/**
 * `createMcpHandler`'s `auth` for the hosted server (9.2, 9.3): the provider the one authorization server, its keys
 * verifying `EdDSA` JWT access tokens whose audience is `resource` exactly and whose lifetime is at most 10 minutes,
 * one `tools/list` for everyone (`filterToolsByScope: false`).
 */
export function createMcpAuth(config: McpAuthConfig): McpAuthOptions {
	const issuer: JwtIssuer = {
		issuer: config.provider.issuer,
		algorithms: ['EdDSA'],
		keys: config.provider.keys,
		alias: 'loam',
	};
	const inner = new JwtVerifier({
		rules: { resource: config.resource, maxTokenLifetimeS: ACCESS_TOKEN_SECONDS },
		issuers: [issuer],
	});
	return {
		resource: config.resource,
		authorizationServers: [config.provider.issuer],
		verifier: loamVerifier(inner, config.provider.issuer),
		scopesSupported: [...LOAM_SCOPES],
		requiredScopes: ['loam:read'],
		resolver: loamScopes(config.isMutation),
		filterToolsByScope: false,
		...(config.resourceName ? { resourceName: config.resourceName } : {}),
		...(config.onRefusal ? { onRefusal: config.onRefusal } : {}),
	};
}

/** A tool error about Loam, after a valid token (9.2): its code and its suggestion. */
const refused = (code: string, message: string, suggestion: string) =>
	failure({ code, message, suggestion, retryable: false });

/** The kernel's minting of a principal, `KernelParts.admitPrincipal`. */
export type AdmitPrincipal = (input: PrincipalInputV1) => KernelPrincipalV1;
/** The kernel's ending of one, `KernelParts.retirePrincipal`: no call made after its request runs under it. */
export type RetirePrincipal = (principal: KernelPrincipalV1) => void;

/**
 * `principalOf(credentials, server)` (9.2's steps 3 to 6): the connected agent whose client is the token's and whose
 * sponsor is its subject, `active`, else `AGENT_NOT_CONNECTED`; the actor that agent acting for the subject; the
 * subject's member row alone, read for this request with no cache (7.6), so a removed member's next call is refused by
 * line 0 though their token is still valid.
 */
export async function principalOf(
	credentials: Credentials,
	server: Pick<McpProviderV1, 'adapter' | 'workspace'> & { admit: AdmitPrincipal }
): Promise<KernelPrincipalV1 | ReturnType<typeof refused>> {
	const adapter = await server.adapter();
	const row = await connectionOf(
		adapter,
		server.workspace,
		credentials.clientId,
		credentials.subject
	);
	if (!row || row.status !== 'active') {
		return refused(
			'AGENT_NOT_CONNECTED',
			'This app is not connected to the workspace for you',
			'Connect it again from the app, and approve it on the consent page; the account section’s agents tab lists what is connected'
		);
	}
	const agent: ConnectedAgentV1 = connectedAgentOf(row);
	const membership = await membershipOf(adapter, server.workspace, credentials.subject);
	const { scopes: _scopes, ...record } = agent;
	return server.admit({
		actor: { kind: 'agent', id: agent.id, label: agent.name, onBehalfOf: credentials.subject },
		person: credentials.subject,
		role: membership?.role ?? null,
		digest: membership?.digest ?? '',
		agent: record,
	});
}

/**
 * `credentialsGate` (9.5): the MCP handler's own first middleware. A call with no verified credentials is refused
 * `UNAUTHORIZED` (the HTTP layer has answered 401 already; this is the backstop); otherwise its principal, from
 * {@link principalOf}, goes on the call for the kernel's `principalGate`. The credentials stay on the context, never
 * journaled or in a result (M4).
 */
export function credentialsGate(
	server: Pick<McpProviderV1, 'adapter' | 'workspace'> & {
		admit: AdmitPrincipal;
		retire?: RetirePrincipal;
	}
): CommandMiddleware {
	return async (_name, _input, context, next) => {
		const call = context as typeof context & { principal?: unknown };
		delete call.principal;
		const credentials = context.credentials;
		if (!isVerifiedCredentials(credentials)) {
			return refused(
				'UNAUTHORIZED',
				'This call has no verified token',
				'Send the request with a bearer token the hosted server accepts'
			);
		}
		const principal = await principalOf(credentials as Credentials, server);
		if ('success' in principal) return principal;
		call.principal = principal;
		try {
			return await next();
		} finally {
			// The request is over: a nested client a handler kept refuses from now on, and a membership read for this request
			// never decides a later call.
			server.retire?.(principal);
		}
	};
}
