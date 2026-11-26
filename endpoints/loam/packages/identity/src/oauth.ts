/**
 * @fileoverview The provider as the authorization server (phase 3 specification, 9.4; step 7): Better Auth's
 * `oauthProvider` with its JWT plugin and Client ID Metadata Documents, configured so that every token names a person,
 * is bound to the hosted server's one MCP resource, lives 10 minutes, and was issued only after the person approved a
 * connection on Loam's consent page.
 *
 * - **One resource**, the hosted server's canonical MCP URI, so every token's `aud` is exactly it (M3.1). The JWT
 *   plugin's own `/token` route is disabled (`LOAM_DISABLED_PATHS`), and a token issued without `resource` is opaque,
 *   which `createMcpAuth`'s JWT-only verifier refuses.
 * - **Grants:** `authorization_code` and `refresh_token`, so `client_credentials` is off and every token has a person.
 * - **PKCE S256 for every client**, confidential ones included: Better Auth's default, and a `before` hook refuses
 *   `require_pkce: false` on every registration and admin client route, and `skip_consent`, so no client skips the
 *   consent page, the one place a connected agent is made.
 * - **No pairwise subjects:** no `pairwiseSecret` is configured, so Better Auth refuses `subject_type: "pairwise"`.
 * - **Registration:** pre-registration by the deployer (the server API); Client ID Metadata Documents through
 *   `@better-auth/cimd` with MCP 2026-07-28's profile, over the host's resolve-once transport; dynamic registration
 *   off unless the deployer turns it on.
 */

import { cimd } from '@better-auth/cimd';
import { fetchClientMetadataResource as nodeMetadataFetch } from '@better-auth/cimd/node';
import { type ClientMetadataResourceFetch, oauthProvider } from '@better-auth/oauth-provider';
import { APIError } from 'better-auth/api';
import { jwt } from 'better-auth/plugins/jwt';

/** Loam's two scopes (9.3), and `offline_access` for a refresh token. */
export const LOAM_SCOPES = Object.freeze(['loam:read', 'loam:write'] as const);
/** What a client may ask for: Loam's scopes and a refresh token, and nothing that releases an ID token's claims. */
export const OAUTH_SCOPES: readonly string[] = Object.freeze([...LOAM_SCOPES, 'offline_access']);

/** An access token's lifetime, in seconds (9.4): JWT access tokens cannot be revoked (S86). */
export const ACCESS_TOKEN_SECONDS = 600;
/** A refresh token's lifetime, in seconds: 30 days, rotating on use. */
export const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;

/** The OAuth pages under the shell (9.4): top-level pages the `account` chunk renders. */
export const OAUTH_LOGIN_PATH = '~/oauth/login';
export const OAUTH_CONSENT_PATH = '~/oauth/consent';

export interface LoamOAuthConfig {
	/**
	 * The hosted server's canonical MCP URI, `https://<host><base_path>mcp`: the one resource, every token's audience.
	 * Default the shell's address and `mcp`.
	 */
	resource?: string;
	/**
	 * The transport for Client ID Metadata Documents: it must resolve a host once, refuse special-use addresses, pin
	 * the address and follow no redirect. Default `@better-auth/cimd/node`'s, which does.
	 */
	fetchClientMetadataResource?: ClientMetadataResourceFetch;
	/** Dynamic Client Registration, which MCP 2026-07-28 deprecates: off unless the deployer turns it on. */
	allowDynamicClientRegistration?: boolean;
	/**
	 * Tests only (phase 3's P3-H1): further resources the provider issues tokens for, beside `resource`, each linked to
	 * every client as `resource` is, so a token for another audience comes from this provider itself and the hosted
	 * server must refuse it. A deployment passes none: `loam-host` sets it only from `startDevHost`.
	 */
	otherResources?: readonly string[];
	/**
	 * Tests only (phase 3's P3-H4): an access token's lifetime in seconds, shorter than {@link ACCESS_TOKEN_SECONDS}, so a
	 * suite sees a person's last token refused once it expires. Never longer: a whole number from 1 to 600.
	 */
	accessTokenSeconds?: number;
}

/** The resources `oauthPlugins` configures: the one resource first, then a test's others, each once and absolute. */
export function oauthResources(resource: string, config: LoamOAuthConfig): string[] {
	const others = config.otherResources ?? [];
	for (const other of others) {
		if (!URL.canParse(other) || other === resource)
			throw new Error('Each of `otherResources` is an absolute URI other than `resource`');
	}
	if (new Set(others).size !== others.length)
		throw new Error('`otherResources` names a resource twice');
	return [resource, ...others];
}

/** An access token's lifetime: {@link ACCESS_TOKEN_SECONDS}, or a test's shorter one (never longer). */
export function accessTokenSecondsOf(config: LoamOAuthConfig): number {
	const seconds = config.accessTokenSeconds;
	if (seconds === undefined) return ACCESS_TOKEN_SECONDS;
	if (!Number.isInteger(seconds) || seconds < 1 || seconds > ACCESS_TOKEN_SECONDS)
		throw new Error(`\`accessTokenSeconds\` is a whole number from 1 to ${ACCESS_TOKEN_SECONDS}`);
	return seconds;
}

/** Every route that registers or changes a client: none may turn PKCE off or skip consent. */
const CLIENT_PATHS = new Set([
	'/oauth2/register',
	'/oauth2/create-client',
	'/oauth2/update-client',
	'/admin/oauth2/create-client',
	'/admin/oauth2/update-client',
]);

/** A client body, flat or as an update's `{ update }`. */
const clientFields = (body: unknown): Record<string, unknown>[] => {
	if (typeof body !== 'object' || body === null) return [];
	const record = body as Record<string, unknown>;
	const update = record.update;
	return typeof update === 'object' && update !== null
		? [record, update as Record<string, unknown>]
		: [record];
};

/**
 * Refuse a client that turns PKCE off or skips consent, on every route that registers or updates one, the deployer's
 * admin routes included (9.4). Run by `createLoamAuthOptions`' `before` hook on every request.
 */
export function refuseClientPolicy(ctx: { path?: string; body?: unknown }): void {
	if (!CLIENT_PATHS.has(ctx.path ?? '')) return;
	for (const fields of clientFields(ctx.body)) {
		if (fields.require_pkce === false || fields.requirePKCE === false) {
			throw APIError.from('BAD_REQUEST', {
				code: 'PKCE_REQUIRED',
				message: 'Every client uses PKCE with S256: require_pkce cannot be false',
			});
		}
		if (fields.skip_consent === true || fields.skipConsent === true) {
			throw APIError.from('BAD_REQUEST', {
				code: 'CONSENT_REQUIRED',
				message: "No client skips consent: connecting an agent is the person's own approval",
			});
		}
	}
}

/**
 * Better Auth's routes by which a signed-in person registers or changes a client from a page: not served (9.4), so a
 * client comes only from the deployer's pre-registration (the server API, an owner's), a metadata document, or dynamic
 * registration where the deployer turned it on. A consent is changed only by connecting or disconnecting (5.3).
 */
export const OAUTH_DISABLED_PATHS: readonly string[] = Object.freeze([
	'/oauth2/create-client',
	'/oauth2/update-client',
	'/oauth2/delete-client',
	'/oauth2/client/rotate-secret',
	'/oauth2/client/rotate-keys',
	'/oauth2/update-consent',
	// Deleting a consent is disconnecting, which ends the record and the refresh tokens with it (5.3).
	'/oauth2/delete-consent',
]);

/**
 * The plugins `oauthPlugins` returns. Named rather than inferred: the inferred type reaches `jose`'s
 * `JWTPayload` through the JWT plugin's types, which this package cannot name in its declarations (TS2883 from
 * better-auth 1.7.26 on).
 */
export type OAuthPlugins = [
	ReturnType<typeof jwt>,
	ReturnType<typeof oauthProvider>,
	ReturnType<typeof cimd>,
];

/** The plugins that make the provider Loam's authorization server (9.4), in order: the JWT plugin first. */
export function oauthPlugins(options: {
	shell: string;
	resource: string;
	config: LoamOAuthConfig;
	/** Whether a person is an owner of the bound organization: only an owner's session manages clients. */
	isOwner(userId: string): Promise<boolean>;
}): OAuthPlugins {
	const { shell, resource, config } = options;
	const resources = oauthResources(resource, config);
	return [
		jwt({ jwks: { keyPairConfig: { alg: 'EdDSA', crv: 'Ed25519' } } }),
		oauthProvider({
			scopes: [...OAUTH_SCOPES],
			clientRegistrationDefaultScopes: [...OAUTH_SCOPES],
			clientRegistrationAllowedScopes: [...OAUTH_SCOPES],
			resources: resources.map((identifier) => ({
				identifier,
				allowedScopes: [...OAUTH_SCOPES],
			})),
			resourceSeedMode: 'overwrite',
			// Every client, however registered, is linked to the one resource and no other (a test's others beside it).
			clientRegistrationDefaultResources: resources,
			clientRegistrationAllowedResources: resources,
			accessTokenExpiresIn: accessTokenSecondsOf(config),
			refreshTokenExpiresIn: REFRESH_TOKEN_SECONDS,
			allowDynamicClientRegistration: config.allowDynamicClientRegistration === true,
			allowUnauthenticatedClientRegistration: false,
			clientRegistrationRequirePKCE: true,
			grantTypes: ['authorization_code', 'refresh_token'],
			// The deployer's pre-registration, through the server API, is an owner's; no one else manages a client.
			clientPrivileges: async ({ user }) => (user ? options.isOwner(user.id) : false),
			loginPage: `${shell}${OAUTH_LOGIN_PATH}`,
			consentPage: `${shell}${OAUTH_CONSENT_PATH}`,
		}),
		cimd({
			fetchClientMetadataResource: config.fetchClientMetadataResource ?? nodeMetadataFetch,
			metadataProfile: 'mcp-2026-07-28',
		}),
	];
}
