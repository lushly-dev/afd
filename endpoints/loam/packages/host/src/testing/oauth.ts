/**
 * @fileoverview An MCP client's OAuth flow against the hosted server, for tests (phase 6 specification, P6-H4; phase 3's
 * 9.4): the deployer's pre-registration of a public native client through the provider's server API, and a person's
 * authorization code flow with PKCE S256 and the resource, approved on the consent route, as phase 3's consent page
 * sends it. Every request goes over the host's own HTTP, so each check the server makes on a real client applies.
 */

import { createHash, randomBytes } from 'node:crypto';

/** One request to the host: its path on the origin, sent as given. */
export type HostSend = (
	path: string,
	options: { method: string; headers: Record<string, string>; body?: string }
) => Promise<{
	status: number;
	headers: Record<string, string | string[] | undefined>;
	body: string;
}>;

/** A test's pre-registered client: a public native client with one loopback redirect. */
export interface TestClientV1 {
	name: string;
	redirect: string;
}

type ProviderApi = Record<string, ((input: unknown) => Promise<unknown>) | undefined>;

/**
 * Pre-registers each client through the provider's server API, as an owner of the bound organization, the one
 * principal that may manage a client (9.4's `clientPrivileges`). Returns each client's id, by name.
 */
export async function registerTestClients(
	auth: { api: unknown },
	owner: { email: string; password: string },
	clients: readonly TestClientV1[]
): Promise<Record<string, string>> {
	const ids: Record<string, string> = {};
	if (clients.length === 0) return ids;
	const api = auth.api as ProviderApi;
	const signedIn = (await api.signInEmail?.({
		body: { email: owner.email, password: owner.password },
		asResponse: true,
	})) as Response;
	if (!signedIn?.ok) throw new Error(`${owner.email} could not sign in to register a client.`);
	const cookie = signedIn.headers
		.getSetCookie()
		.map((line) => line.split(';')[0])
		.join('; ');
	for (const client of clients) {
		const made = (await api.adminCreateOAuthClient?.({
			headers: new Headers({ cookie }),
			body: {
				client_name: client.name,
				redirect_uris: [client.redirect],
				token_endpoint_auth_method: 'none',
				application_type: 'native',
				grant_types: ['authorization_code', 'refresh_token'],
				response_types: ['code'],
			},
		})) as { client_id?: string } | undefined;
		if (!made?.client_id) throw new Error(`The client ${client.name} was not registered.`);
		ids[client.name] = made.client_id;
	}
	return ids;
}

const header = (value: string | string[] | undefined): string =>
	Array.isArray(value) ? (value[0] ?? '') : (value ?? '');

const cookiesOf = (value: string | string[] | undefined): string =>
	(Array.isArray(value) ? value : value ? [value] : [])
		.map((line) => line.split(';')[0])
		.join('; ');

export interface AgentTokenOptions {
	/** The shell's origin. */
	origin: string;
	/** The provider's path on the origin, `<base><identity.path>`, as `/loam/api/auth`. */
	providerPath: string;
	email: string;
	password: string;
	clientId: string;
	redirect: string;
	/** The token's audience: the hosted server's MCP resource. `null` sends none. */
	resource: string | null;
	/** Default `loam:read loam:write`. */
	scope?: string;
}

/**
 * A person signs in with a password, authorizes `clientId` for `resource`, approves it, and the client exchanges the
 * code: the access token, or the step's answer that ended the flow.
 */
export async function agentToken(
	send: HostSend,
	options: AgentTokenOptions
): Promise<{ access?: string; refused?: { step: string; status: number; body: string } }> {
	const { origin, providerPath } = options;
	const json = (body: unknown, cookie?: string) => ({
		method: 'POST',
		headers: {
			origin,
			'content-type': 'application/json',
			...(cookie ? { cookie } : {}),
		},
		body: JSON.stringify(body),
	});
	const signedIn = await send(
		`${providerPath}/sign-in/email`,
		json({ email: options.email, password: options.password })
	);
	if (signedIn.status !== 200)
		return { refused: { step: 'sign-in', status: signedIn.status, body: signedIn.body } };
	const cookie = cookiesOf(signedIn.headers['set-cookie']);
	const verifier = randomBytes(32).toString('base64url');
	const query = new URLSearchParams({
		response_type: 'code',
		client_id: options.clientId,
		redirect_uri: options.redirect,
		scope: options.scope ?? 'loam:read loam:write',
		state: 'p6',
		code_challenge: createHash('sha256').update(verifier).digest('base64url'),
		code_challenge_method: 'S256',
		...(options.resource === null ? {} : { resource: options.resource }),
	});
	const authorized = await send(`${providerPath}/oauth2/authorize?${query}`, {
		method: 'GET',
		headers: { cookie },
	});
	const location = new URL(header(authorized.headers.location), origin);
	let redirect = location.href;
	if (!redirect.startsWith(options.redirect)) {
		// The consent page's own request: the signed query it was given, accepted.
		const consent = await send(
			`${providerPath}/oauth2/consent`,
			json({ accept: true, oauth_query: location.search.slice(1) }, cookie)
		);
		const url = (() => {
			try {
				return (JSON.parse(consent.body) as { url?: string }).url;
			} catch {
				return undefined;
			}
		})();
		if (consent.status !== 200 || !url)
			return { refused: { step: 'consent', status: consent.status, body: consent.body } };
		redirect = url;
	}
	const code = new URL(redirect).searchParams.get('code');
	if (!code) return { refused: { step: 'authorize', status: authorized.status, body: redirect } };
	const exchanged = await send(`${providerPath}/oauth2/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			redirect_uri: options.redirect,
			client_id: options.clientId,
			code_verifier: verifier,
			...(options.resource === null ? {} : { resource: options.resource }),
		}).toString(),
	});
	const tokens = (() => {
		try {
			return JSON.parse(exchanged.body) as { access_token?: string };
		} catch {
			return {};
		}
	})();
	return tokens.access_token
		? { access: tokens.access_token }
		: { refused: { step: 'token', status: exchanged.status, body: exchanged.body } };
}
