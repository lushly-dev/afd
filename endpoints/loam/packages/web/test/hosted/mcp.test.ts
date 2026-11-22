/**
 * P6-H4 (phase 6 specification, section 19): the MCP route and the well-known documents, on the development profile
 * at `/loam/`, with the server kernel behind it; and P6-H3's case for the OAuth pages, which exist from phase 3's step 7
 * and so close here (5.3). Real tokens: an MCP client's authorization code flow with PKCE against the dev host's own
 * provider, for a client the deployer pre-registered, approved on the consent page in Chromium or on its route.
 */

import { readFileSync } from 'node:fs';
import { StreamableHttpTransport } from '@lushly-dev/afd-client/streamable-http';
import { AFD_META_TOOL_NAMES, type CommandResult } from '@lushly-dev/afd-core';
import {
	agentToken,
	type DevHost,
	HOSTED_MCP_COMMANDS,
	type HostSend,
	scanSecrets,
	startDevHost,
	trustingFetch,
} from '@lushly-dev/loam-host/testing';
import { TEST_RATE_LIMIT } from '@lushly-dev/loam-identity/testing';
import type { Browser, Page, Response } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	axe,
	deploymentEntry,
	hostedProviderDeployment,
	launchForDevHost,
	openPage,
	packApp,
	type ShellPage,
} from '../browser/harness';
import { hosted, writtenPolicy } from './support';

const BASE = '/loam/';
const PASSWORD = 'correct horse battery staple';
const REDIRECT = 'http://127.0.0.1:9/callback';
const CLIENT = 'P6 agent';
/** The inert policy the host gives every answer on the shell's origin that is no page, script or style. */
const INERT = "sandbox; default-src 'none'; frame-ancestors 'none'";

/**
 * Section 14's `tools/list` row: p95 over 200 requests, enforced in `loam.yml`'s `Hosted development profile` job
 * (`CI=true`), the place section 14 measures; elsewhere, on a shared machine under any load, the measurement is logged.
 */
const TOOLS_LIST_P95_MS = process.env.CI === 'true' ? 50 : 500;
const TOOLS_LIST_REQUESTS = 200;

let host: DevHost;
let browser: Browser;
const opened: ShellPage[] = [];
/** Every token this suite was given, for the secrets scan. */
const tokens: string[] = [];

beforeAll(async () => {
	host = await startDevHost({
		config: hostedProviderDeployment(
			['passkey', 'password'],
			deploymentEntry('hello', await packApp('hello'))
		),
		basePath: BASE,
		organization: { slug: 'acme', name: 'Acme' },
		people: [
			{
				email: 'olu@acme.example',
				name: 'Olu',
				role: 'owner',
				methods: ['password'],
				password: PASSWORD,
			},
			{
				email: 'bea@acme.example',
				name: 'Bea',
				role: 'member',
				methods: ['password'],
				password: PASSWORD,
			},
		],
		clients: [{ name: CLIENT, redirect: REDIRECT }],
		// Every sign-in of the flows below, and 200 `tools/list` reads, from one address: raised, never off (5.8).
		rateLimit: TEST_RATE_LIMIT,
	});
	browser = await launchForDevHost(host);
}, 120_000);
afterAll(async () => {
	await Promise.all(opened.splice(0).map((page) => page.context.close()));
	await browser?.close();
	await host?.close();
});

const resource = () => `${host.root}mcp`;
const issuer = () => `${host.root}api/auth`;

const send: HostSend = (path, options) =>
	hosted(host, path, {
		method: options.method,
		headers: options.headers,
		...(options.body !== undefined ? { body: options.body } : {}),
	}) as never;

async function tokenFor(email: string, scope?: string): Promise<string> {
	const made = await agentToken(send, {
		origin: host.origin,
		providerPath: `${BASE}api/auth`,
		email,
		password: PASSWORD,
		clientId: host.clients[CLIENT] as string,
		redirect: REDIRECT,
		resource: resource(),
		...(scope ? { scope } : {}),
	});
	if (!made.access) throw new Error(`No token for ${email}: ${JSON.stringify(made.refused)}`);
	tokens.push(made.access);
	return made.access;
}

/** An MCP client over the dev host's TLS, trusting only its certificate, on the era `mode` names. */
async function connect(bearer: string, mode: 'modern' | 'legacy' | 'auto' = 'auto') {
	const transport = new StreamableHttpTransport(resource(), {
		clientName: 'p6-h4',
		clientVersion: '0',
		mode,
		headers: { authorization: `Bearer ${bearer}` },
		fetch: trustingFetch(readFileSync(host.certificate)),
	});
	await transport.connect();
	let id = 0;
	const request = async (method: string, params: unknown) =>
		(await transport.send({ jsonrpc: '2.0', id: ++id, method, params } as never)) as {
			result?: Record<string, unknown>;
			error?: { code: number; message: string };
		};
	return {
		transport,
		request,
		async names(): Promise<string[]> {
			const listed = await request('tools/list', {});
			return ((listed.result?.tools ?? []) as { name: string }[]).map((tool) => tool.name).sort();
		},
		async call<T = unknown>(name: string, args: unknown = {}): Promise<CommandResult<T>> {
			const answer = await request('tools/call', { name, arguments: args });
			if (answer.error) throw new Error(`${name}: ${answer.error.message}`);
			const result = answer.result as {
				structuredContent?: CommandResult<T>;
				content?: { text: string }[];
			};
			return (
				result.structuredContent ??
				(JSON.parse(result.content?.[0]?.text ?? '{}') as CommandResult<T>)
			);
		},
	};
}

/** The claims of a compact JWS, unverified: only to read what the provider wrote. */
const claimsOf = (token: string) =>
	JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<
		string,
		unknown
	>;

const postList = (headers: Record<string, string>) =>
	hosted(host, `${BASE}mcp`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			...headers,
		},
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
	});

/** An MCP client's authorization request, for one of Loam's OAuth pages in a browser. */
const authorize = () =>
	`${host.root}api/auth/oauth2/authorize?${new URLSearchParams({
		response_type: 'code',
		client_id: host.clients[CLIENT] as string,
		redirect_uri: REDIRECT,
		scope: 'loam:read loam:write',
		state: 'h3',
		code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
		code_challenge_method: 'S256',
		resource: resource(),
	})}`;

const pageText = (page: Page) =>
	page.evaluate(() =>
		(document.querySelector('loam-oauth-page')?.shadowRoot?.textContent ?? '').replace(/\s+/g, ' ')
	);

async function arrive(page: Page, kind: 'login' | 'consent', go?: () => Promise<unknown>) {
	const answered = page.waitForResponse(
		(response: Response) => new URL(response.url()).pathname === `${BASE}~/oauth/${kind}`
	);
	await (go ? go() : page.goto(authorize()));
	const response = await answered;
	await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'oauth');
	await page.waitForFunction(() =>
		Boolean(document.querySelector('loam-oauth-page')?.shadowRoot?.querySelector('h1')?.textContent)
	);
	return response.headers()['content-security-policy'] ?? null;
}

describe("P6-H3: the OAuth pages, built in phase 3's step 7, on the hosted server", () => {
	it("P6-H3: the login and consent pages render with 3.5's policy and `form-action 'self'`, with no violation, and Connect returns a code", async () => {
		// Opened on the shell, so its violations are watched from the first page on.
		const shell = await openPage(browser, host.root);
		opened.push(shell);
		const { page } = shell;
		const policy = `${writtenPolicy(host)}; frame-ancestors 'none'; form-action 'self'`;
		expect(await arrive(page, 'login')).toBe(policy);
		expect((await page.locator('loam-oauth-page button').allTextContents())[0]).toBe(
			'Sign in with a passkey'
		);
		expect(await axe(page)).toEqual([]);
		await page.locator('loam-oauth-page input[name="email"]').fill('bea@acme.example');
		await page.locator('loam-oauth-page input[name="password"]').fill(PASSWORD);
		expect(
			await arrive(page, 'consent', () =>
				page.locator('loam-oauth-page button[type="submit"]').click()
			)
		).toBe(policy);
		await page.waitForFunction(() =>
			(document.querySelector('loam-oauth-page')?.shadowRoot?.textContent ?? '').includes(
				'Connect P6 agent'
			)
		);
		expect(await pageText(page)).toContain('Connect P6 agent to Acme?');
		expect(await axe(page)).toEqual([]);
		// The client's own redirect answered here, as a loopback client would, so the page never shows an error page.
		await page.route(`${REDIRECT}**`, (route) =>
			route.fulfill({ status: 200, contentType: 'text/plain', body: 'connected' })
		);
		const back = page.waitForRequest((request) => request.url().startsWith(REDIRECT));
		await page.locator('loam-oauth-page button', { hasText: 'Connect' }).click();
		expect(new URL((await back).url()).searchParams.get('code')).toBeTruthy();
		expect(shell.violations).toEqual([]);
		// Back on the shell, so the scan reads the shell's own storage.
		await page.waitForURL(`${REDIRECT}**`);
		await page.goto(host.root);
		await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'web');
		const rows = host.db().auth.prepare('SELECT status FROM loam_connected_agent').all();
		expect(rows).toContainEqual({ status: 'active' });
	});
});

describe('P6-H4: the MCP route and the well-known documents', () => {
	it('P6-H4: no token is 401, naming the path-inserted metadata, which answers, as does the root form', async () => {
		const refused = await postList({});
		expect(refused.status).toBe(401);
		expect(String(refused.headers['www-authenticate'])).toContain(
			`resource_metadata="${host.origin}/.well-known/oauth-protected-resource/loam/mcp"`
		);
		for (const path of [
			'/.well-known/oauth-protected-resource/loam/mcp',
			'/.well-known/oauth-protected-resource',
		]) {
			const answer = await hosted(host, path);
			expect(answer.status, path).toBe(200);
			const metadata = JSON.parse(answer.body) as {
				resource: string;
				authorization_servers: string[];
			};
			expect(metadata.resource, path).toBe(resource());
			expect(metadata.authorization_servers, path).toEqual([issuer()]);
		}
	});

	it("P6-H4: `/.well-known/oauth-authorization-server/loam/api/auth` names the issuer `<origin>/loam/api/auth`, the provider's own, as its tokens carry", async () => {
		const answer = await hosted(host, '/.well-known/oauth-authorization-server/loam/api/auth');
		expect(answer.status, answer.body).toBe(200);
		const metadata = JSON.parse(answer.body) as Record<string, unknown>;
		expect(metadata.issuer).toBe(issuer());
		expect(metadata.token_endpoint).toBe(`${issuer()}/oauth2/token`);
		// Better Auth's OpenID discovery is not served over HTTP (phase 3's step 7); its tokens name the same issuer.
		const claims = claimsOf(await tokenFor('bea@acme.example'));
		expect(claims.iss).toBe(issuer());
		expect(claims.aud).toBe(resource());
	});

	it("P6-H4: `tools/list` with a valid token is `HOSTED_MCP_COMMANDS` and AFD's meta-tools, for every token, on both eras through `<base>mcp`", async () => {
		const expected = [...HOSTED_MCP_COMMANDS, ...AFD_META_TOOL_NAMES].sort();
		for (const mode of ['modern', 'legacy'] as const) {
			const owner = await connect(await tokenFor('olu@acme.example'), mode);
			const member = await connect(await tokenFor('bea@acme.example', 'loam:read'), mode);
			expect(owner.transport.protocolEra, mode).toBe(mode);
			expect(await owner.names(), mode).toEqual(expected);
			expect(await member.names(), mode).toEqual(expected);
			await owner.transport.disconnect();
			await member.transport.disconnect();
		}
	});

	it("P6-H4: a connected agent's calls run on the server kernel: its store and journal hold them, and an app is listed", async () => {
		const bea = await connect(await tokenFor('bea@acme.example'));
		const info = await bea.call<{ host: string; store: string }>('shell-info-get');
		expect(info.data).toMatchObject({ host: 'hosted', store: 'sqlite' });
		const apps = await bea.call('app-list');
		expect(apps.success, JSON.stringify(apps.error)).toBe(true);
		expect(JSON.stringify(apps.data)).toContain('hello');
		const created = await bea.call('project-create', { name: 'Field notes', slug: 'field-notes' });
		expect(created.success, JSON.stringify(created.error)).toBe(true);
		await bea.transport.disconnect();
		const rows = host
			.db()
			.loam.prepare("SELECT value FROM records WHERE tbl = 'project'")
			.all() as {
			value: string;
		}[];
		expect(rows.map((row) => (JSON.parse(row.value) as { slug: string }).slug)).toContain(
			'field-notes'
		);
		const entry = (await host.journal()).find((line) => line.command === 'project-create') as
			| { actor?: { kind: string } }
			| undefined;
		expect(entry?.actor?.kind).toBe('agent');
	});

	it('P6-H4: a foreign `Origin` is 403', async () => {
		const bearer = await tokenFor('bea@acme.example');
		const answer = await postList({
			origin: 'https://evil.example',
			authorization: `Bearer ${bearer}`,
		});
		expect(answer.status).toBe(403);
		expect(answer.headers['access-control-allow-origin']).toBeUndefined();
	});

	it("P6-H4: AFD's other routes, under `/loam/` and at the root, are 404", async () => {
		for (const route of ['sse', 'message', 'rpc', 'batch', 'stream/x', 'health']) {
			for (const path of [`${BASE}${route}`, `/${route}`]) {
				for (const method of ['GET', 'POST']) {
					const answer = await hosted(host, path, { method, accept: 'application/json' });
					expect(answer.status, `${method} ${path}`).toBe(404);
				}
			}
		}
	});

	it("P6-H4: 3.5's headers and `Cache-Control: no-store` on `<base>mcp`'s answers", async () => {
		const bearer = await tokenFor('bea@acme.example');
		const answers = [
			await postList({}),
			await postList({ authorization: `Bearer ${bearer}`, 'mcp-protocol-version': '2025-11-25' }),
			await hosted(host, `${BASE}mcp`, { headers: { authorization: `Bearer ${bearer}` } }),
		];
		for (const answer of answers) {
			expect(answer.headers['cache-control']).toBe('no-store');
			expect(answer.headers['x-content-type-options']).toBe('nosniff');
			expect(answer.headers['referrer-policy']).toBe('no-referrer');
			expect(answer.headers['cross-origin-opener-policy']).toBe('same-origin');
			expect(answer.headers['content-security-policy']).toBe(INERT);
		}
	});

	it("P6-H4: section 14's `tools/list` row: p95 over 200 requests", async () => {
		// Raw requests over the profile's TLS, each a whole round trip through the bearer layer and the handler, so no
		// client's cache answers one.
		const bearer = await tokenFor('bea@acme.example');
		const times: number[] = [];
		for (let request = 0; request < TOOLS_LIST_REQUESTS; request++) {
			const started = performance.now();
			const answer = await postList({
				authorization: `Bearer ${bearer}`,
				'mcp-protocol-version': '2025-11-25',
			});
			times.push(performance.now() - started);
			if (answer.status !== 200 || !answer.body.includes('"project-list"'))
				throw new Error(`tools/list answered ${answer.status}: ${answer.body.slice(0, 200)}`);
		}
		const p95 = [...times].sort((a, b) => a - b)[
			Math.ceil(TOOLS_LIST_REQUESTS * 0.95) - 1
		] as number;
		// The line section 14's sample is read from in the `Hosted development profile` job.
		console.log(
			`P6-H4 measurement: tools/list p95 ${p95.toFixed(1)} ms over ${TOOLS_LIST_REQUESTS} requests`
		);
		expect(p95).toBeLessThanOrEqual(TOOLS_LIST_P95_MS);
	}, 120_000);

	it('P6-H4: scanSecrets finds no token, session cookie or auth secret in the files, the stores, the journal, the logs or the pages', async () => {
		expect(tokens.length).toBeGreaterThan(0);
		const cookies = (
			await Promise.all(opened.map(({ context }) => context.cookies(host.origin)))
		).flatMap((list) => list.map(({ value }) => value));
		const { found } = await scanSecrets(
			host,
			opened.map(({ page }) => page),
			[...tokens, ...cookies]
		);
		expect(found).toEqual([]);
	});
});
