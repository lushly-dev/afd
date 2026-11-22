/**
 * @fileoverview A test's OAuth connection at a provider from `createLoamAuthOptions` (9.4): a native client the
 * deployer registers, and a person's authorization of it, as an MCP client runs it (PKCE S256, the resource and the
 * person's consent), exchanged for tokens. Used by units that need a person's consents, refresh tokens and connected
 * agent to exist; not exported from `testing/index.ts`.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { TestBrowser } from './requests.js';

/** What a provider instance offers the helpers: its request handler and its server API. */
export interface OAuthTestProvider {
	auth: { handler(request: Request): Promise<Response>; api: unknown };
}

/** Registers a native, public client as the deployer does, through an owner's session; returns its id. */
export async function registerTestClient(
	provider: OAuthTestProvider,
	owner: TestBrowser,
	redirect: string,
	name = 'Test client'
): Promise<string> {
	const create = (
		provider.auth.api as Record<
			'adminCreateOAuthClient',
			(input: unknown) => Promise<{ client_id: string }>
		>
	).adminCreateOAuthClient;
	return (
		await create({
			headers: new Headers({ cookie: owner.cookie }),
			body: {
				client_name: name,
				redirect_uris: [redirect],
				token_endpoint_auth_method: 'none',
				application_type: 'native',
				grant_types: ['authorization_code', 'refresh_token'],
				response_types: ['code'],
			},
		})
	).client_id;
}

/**
 * The signed-in `page`'s person authorizes `clientId` (consenting when asked) and the code is exchanged for tokens,
 * `offline_access` included unless `scope` says otherwise, so the provider holds a consent and a refresh token.
 */
export async function connectTestClient(
	provider: OAuthTestProvider,
	page: TestBrowser,
	options: { origin: string; clientId: string; redirect: string; scope?: string }
): Promise<{ access?: string; refresh?: string }> {
	const issuer = `${options.origin}/api/auth`;
	const resource = `${options.origin}/mcp`;
	const verifier = randomBytes(32).toString('base64url');
	const query = new URLSearchParams({
		response_type: 'code',
		client_id: options.clientId,
		redirect_uri: options.redirect,
		scope: options.scope ?? 'loam:read loam:write offline_access',
		state: 's',
		code_challenge: createHash('sha256').update(verifier).digest('base64url'),
		code_challenge_method: 'S256',
		resource,
	});
	const location = new URL(
		(await page.call(`/oauth2/authorize?${query}`)).headers.get('location') ?? '',
		options.origin
	);
	const back = location.href.startsWith(options.redirect)
		? location.href
		: (
				(
					await page.call('/oauth2/consent', {
						body: { accept: true, oauth_query: location.search.slice(1) },
					})
				).body as { url: string }
			).url;
	const code = new URL(back).searchParams.get('code');
	if (!code) throw new Error('No code returned to the client');
	const exchanged = await provider.auth.handler(
		new Request(`${issuer}/oauth2/token`, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				redirect_uri: options.redirect,
				client_id: options.clientId,
				code_verifier: verifier,
				resource,
			}),
		})
	);
	const tokens = (await exchanged.json()) as { access_token?: string; refresh_token?: string };
	return { access: tokens.access_token, refresh: tokens.refresh_token };
}
