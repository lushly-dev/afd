/**
 * Phase 3's hosted criterion, P3-H1, P3-H3 and P3-H5 (phase 3 specification, 10.1, 10.2 and 18; step 10), on the hosted
 * lane's development profile at `/loam/`: the profile's own provider, its server kernel and its mount relay, no
 * test-only host or handler. A team instance (`audience = "team"`, its `projects` listing slugs) stands behind the relay,
 * a real AFD server that logs every request as it arrived (`relay-fixtures.ts`).
 *
 * - **P3-H1:** with a second resource configured on the same provider (`startDevHost`'s `resources`), its token is a 401
 *   at `<base>mcp` with the challenge naming the metadata; another issuer's token is a 401; the right one is a 200.
 * - **P3-H3:** a client registered by a Client ID Metadata Document, approved on the consent page in Chromium, enters its
 *   person's restricted project and not another's; an owner command is `COMMAND_NOT_FOUND`; a browser request through
 *   the relay for a project the session's person may not enter is refused before forwarding, by the instance's log. The
 *   document is served to the provider from memory (`clientMetadata`), since its transport refuses every special-use
 *   address and a suite has no public host; the provider's own CIMD validation reads it.
 * - **P3-H5:** the server enforces the trust records: a non-owner's session on 10.2 item 4's transport is
 *   `OWNER_REQUIRED`, an agent's token over MCP `HUMAN_REQUIRED` or `COMMAND_NOT_FOUND`, the owner's cookie with a
 *   foreign `Origin` or `text/plain` refused, each with the server's records unchanged; the owner's session changes them.
 *   #852 closes on this row.
 * - **Step 7's two P3-E8 cases left to the server:** a listed slug's `project-create` over MCP on a team instance
 *   (P3-H5(b)), and a real `startInstances` refresh of a mounted instance on the gated kernel, with no principal.
 */

import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	agentToken,
	type DevHost,
	type HostSend,
	startDevHost,
} from '@lushly-dev/loam-host/testing';
import { TEST_RATE_LIMIT } from '@lushly-dev/loam-identity/testing';
import type { Browser, Page, Response } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	hostedProviderDeployment,
	kernelCall,
	launchForDevHost,
	type ShellPage,
} from '../browser/harness';
import {
	baseOf,
	claimsOf,
	cookieOf,
	listWith,
	mcpClient,
	PASSWORD,
	personId,
	resourceOf,
	serverRows,
	serverStore,
	signedInShell,
	transportCall,
	WORKSPACE,
} from './identity-support';
import { type Fixture, startAfdFixture } from './relay-fixtures';
import { fixtureEntry, scoped, toolCall } from './relay-support';
import { hosted } from './support';

const REDIRECT = 'http://127.0.0.1:9/callback';
const CLIENT = 'P3 agent';
/** P3-H1's second resource, configured on the profile's own provider beside `<base>mcp`. */
const OTHER = 'https://other.example/mcp';
/** P3-H3's client: its id is its metadata document's URL. */
const DOCUMENT = 'https://agent.example/oauth/client.json';
const TEAM_TOKEN = 'team-bearer-p3-0123456789abcdef';

let host: DevHost;
let browser: Browser;
let directory: string;
let team: Fixture;
let olu: ShellPage;
let bea: ShellPage;
const ids = { olu: '', bea: '', atlas: '', citadel: '', vault: '' };
const opened: ShellPage[] = [];

beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'loam-p3-hosted-'));
	team = await startAfdFixture('hybrid');
	host = await startDevHost({
		config: hostedProviderDeployment(
			['passkey', 'password'],
			// A team instance whose `projects` list `roadmap` (not yet a project: a listed slug for #852's create) and the
			// three projects the owner makes below.
			await fixtureEntry(directory, 'team', team.url, TEAM_TOKEN, [
				'audience = "team"',
				'projects = ["atlas", "citadel", "vault", "roadmap"]',
			])
		),
		basePath: '/loam/',
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
			{
				email: 'cy@acme.example',
				name: 'Cy',
				role: 'member',
				methods: ['password'],
				password: PASSWORD,
			},
		],
		clients: [{ name: CLIENT, redirect: REDIRECT }],
		resources: [OTHER],
		clientMetadata: {
			[DOCUMENT]: {
				client_id: DOCUMENT,
				client_name: 'Field agent',
				redirect_uris: [REDIRECT],
				token_endpoint_auth_method: 'none',
				grant_types: ['authorization_code', 'refresh_token'],
				response_types: ['code'],
			},
		},
		rateLimit: TEST_RATE_LIMIT,
	});
	browser = await launchForDevHost(host);
	ids.olu = personId(host, 'olu@acme.example');
	ids.bea = personId(host, 'bea@acme.example');
	// The owner's projects, through the shell, so the server's store holds them: Atlas open, Citadel restricted to Olu and
	// Bea, Vault to Olu alone.
	olu = await signedInShell(browser, host, 'olu@acme.example', opened);
	const made = async (name: string, members?: string[]) => {
		const answer = (await kernelCall(olu.page, 'project-create', {
			name,
			...(members ? { access: { mode: 'restricted', members } } : {}),
		})) as { success: boolean; data?: { id: string }; error?: unknown };
		expect(answer.success, JSON.stringify(answer.error)).toBe(true);
		return answer.data?.id as string;
	};
	ids.atlas = await made('Atlas');
	ids.citadel = await made('Citadel', [ids.olu, ids.bea]);
	ids.vault = await made('Vault', [ids.olu]);
	bea = await signedInShell(browser, host, 'bea@acme.example', opened);
}, 240_000);

afterAll(async () => {
	await Promise.all(opened.splice(0).map((page) => page.context.close()));
	await browser?.close();
	await host?.close();
	await team?.close();
	if (directory) await rm(directory, { recursive: true, force: true });
});

const send: HostSend = (path, options) =>
	hosted(host, path, {
		method: options.method,
		headers: options.headers,
		...(options.body !== undefined ? { body: options.body } : {}),
	}) as never;

/** A person's token for the pre-registered client, approved on the consent route, for `resource`. */
async function tokenFor(email: string, resource: string = resourceOf(host)): Promise<string> {
	const made = await agentToken(send, {
		origin: host.origin,
		providerPath: `${baseOf(host)}api/auth`,
		email,
		password: PASSWORD,
		clientId: host.clients[CLIENT] as string,
		redirect: REDIRECT,
		resource,
	});
	if (!made.access) throw new Error(`No token for ${email}: ${JSON.stringify(made.refused)}`);
	return made.access;
}

const METADATA = () => `${host.origin}/.well-known/oauth-protected-resource/loam/mcp`;

describe('P3-H1: the hosted server refuses a token for the wrong audience', () => {
	it("P3-H1: a token the profile's own provider issued for its second resource is a 401 at `<base>mcp`, the challenge naming the metadata", async () => {
		const token = await tokenFor('bea@acme.example', OTHER);
		// Issued by the same provider, for the same person and client: only its audience differs.
		const claims = claimsOf(token);
		expect(claims.iss).toBe(`${host.root}api/auth`);
		expect(claims.aud).toBe(OTHER);
		const logged = host.logs().length;
		const refused = await listWith(host, token);
		expect(refused.status).toBe(401);
		expect(String(refused.headers['www-authenticate'])).toContain(
			`resource_metadata="${METADATA()}"`
		);
		// Refused for its audience (M3.1), by the rule the host logs, the issuer itself known.
		await expect
			.poll(() => host.logs().slice(logged))
			.toContain("[afd] refused a request's bearer token: rule=audience issuer=loam");
	});

	it("P3-H1: another issuer's token for the right audience is a 401", async () => {
		// Signed with a key of the test's own, the provider's issuer replaced: what another authorization server would send.
		const { privateKey } = generateKeyPairSync('ed25519');
		const now = Math.floor(Date.now() / 1000);
		const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
		const signed = `${part({ alg: 'EdDSA', typ: 'at+jwt', kid: 'elsewhere' })}.${part({
			iss: 'https://elsewhere.example/api/auth',
			sub: ids.bea,
			aud: resourceOf(host),
			client_id: host.clients[CLIENT],
			scope: 'loam:read loam:write',
			iat: now,
			exp: now + 300,
		})}`;
		const token = `${signed}.${sign(null, Buffer.from(signed), privateKey).toString('base64url')}`;
		const logged = host.logs().length;
		const refused = await listWith(host, token);
		expect(refused.status).toBe(401);
		expect(String(refused.headers['www-authenticate'])).toContain(
			`resource_metadata="${METADATA()}"`
		);
		expect(String(refused.headers['www-authenticate'])).toContain('invalid_token');
		// Refused by Loam's issuer rule (9.2's step 1), as the host logs each refused token's rule, never the token.
		await expect
			.poll(() => host.logs().slice(logged))
			.toContain("[afd] refused a request's bearer token: rule=PRINCIPAL_ISSUER_UNKNOWN issuer=-");
	});

	it('P3-H1: the right token, for `<base>mcp`, is a 200', async () => {
		const token = await tokenFor('bea@acme.example');
		expect(claimsOf(token).aud).toBe(resourceOf(host));
		const answered = await listWith(host, token);
		expect(answered.status, answered.body).toBe(200);
		expect(answered.body).toContain('"project-list"');
	});
});

/** An authorization request for the metadata document's client, with its PKCE verifier. */
function metadataAuthorize(): { url: string; verifier: string } {
	const verifier = randomBytes(32).toString('base64url');
	const query = new URLSearchParams({
		response_type: 'code',
		client_id: DOCUMENT,
		redirect_uri: REDIRECT,
		scope: 'loam:read loam:write',
		state: 'h3',
		code_challenge: createHash('sha256').update(verifier).digest('base64url'),
		code_challenge_method: 'S256',
		resource: resourceOf(host),
	});
	return { url: `${host.root}api/auth/oauth2/authorize?${query}`, verifier };
}

const oauthText = (page: Page) =>
	page.evaluate(() =>
		(document.querySelector('loam-oauth-page')?.shadowRoot?.textContent ?? '').replace(/\s+/g, ' ')
	);

async function arrive(page: Page, kind: 'login' | 'consent', go: () => Promise<unknown>) {
	const answered = page.waitForResponse(
		(response: Response) => new URL(response.url()).pathname === `${baseOf(host)}~/oauth/${kind}`
	);
	await go();
	await answered;
	await page.waitForFunction(() => document.documentElement.dataset.loamHost === 'oauth');
	await page.waitForFunction(() =>
		Boolean(document.querySelector('loam-oauth-page')?.shadowRoot?.querySelector('h1')?.textContent)
	);
}

describe('P3-H3: a connected agent acts for its person, and no more; the relay enforces', () => {
	let agent: Awaited<ReturnType<typeof mcpClient>>;
	/** The connected agent the consent made for the metadata document's client, as the provider recorded it. */
	let documentAgent: string;

	it('P3-H3: a client registered by a metadata document is approved on the consent page and gets a token for its person', async () => {
		const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		const page = await context.newPage();
		try {
			const { url, verifier } = metadataAuthorize();
			await arrive(page, 'login', () => page.goto(url));
			await page.locator('loam-oauth-page input[name="email"]').fill('bea@acme.example');
			await page.locator('loam-oauth-page input[name="password"]').fill(PASSWORD);
			await arrive(page, 'consent', () =>
				page.locator('loam-oauth-page button[type="submit"]').click()
			);
			await page.waitForFunction(() =>
				(document.querySelector('loam-oauth-page')?.shadowRoot?.textContent ?? '').includes(
					'Connect'
				)
			);
			// The client named by its document's host, in bold, as a metadata document's client is (9.4).
			expect(await page.locator('loam-oauth-page strong').first().textContent()).toBe(
				'agent.example'
			);
			expect(await oauthText(page)).toContain('Field agent');
			await page.route(`${REDIRECT}**`, (route) =>
				route.fulfill({ status: 200, contentType: 'text/plain', body: 'connected' })
			);
			const back = page.waitForRequest((request) => request.url().startsWith(REDIRECT));
			await page.locator('loam-oauth-page button', { hasText: 'Connect' }).click();
			const code = new URL((await back).url()).searchParams.get('code');
			expect(code).toBeTruthy();
			const exchanged = await hosted(host, `${baseOf(host)}api/auth/oauth2/token`, {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					grant_type: 'authorization_code',
					code: code as string,
					redirect_uri: REDIRECT,
					client_id: DOCUMENT,
					code_verifier: verifier,
					resource: resourceOf(host),
				}).toString(),
			});
			expect(exchanged.status, exchanged.body).toBe(200);
			const token = (JSON.parse(exchanged.body) as { access_token: string }).access_token;
			expect(claimsOf(token)).toMatchObject({
				sub: ids.bea,
				aud: resourceOf(host),
				client_id: DOCUMENT,
			});
			// The connection is the metadata document's client's, recorded at the provider for Bea.
			const row = host
				.db()
				.auth.prepare(
					'SELECT status, agentId FROM loam_connected_agent WHERE clientId = ? AND sponsor = ?'
				)
				.get(DOCUMENT, ids.bea) as { status: string; agentId: string } | undefined;
			expect(row?.status).toBe('active');
			documentAgent = row?.agentId as string;
			agent = await mcpClient(host, token);
		} finally {
			await context.close();
		}
	});

	it("P3-H3: it enters its person's restricted project and not another's", async () => {
		expect(agent).toBeDefined();
		const listed = await agent.call<{ projects: { id: string }[] }>('project-list');
		expect(listed.success, JSON.stringify(listed.error)).toBe(true);
		const visible = listed.data?.projects.map((project) => project.id) ?? [];
		expect(visible).toContain(ids.citadel);
		expect(visible).not.toContain(ids.vault);
		const entered = await agent.call<{ id: string }>(
			'project-get',
			{ project: ids.citadel },
			ids.citadel
		);
		expect(entered.success, JSON.stringify(entered.error)).toBe(true);
		expect(entered.data?.id).toBe(ids.citadel);
		const refused = await agent.call('project-get', { project: ids.vault }, ids.vault);
		expect(refused.success).toBe(false);
		expect(refused.error?.code).toBe('PROJECT_NOT_FOUND');
		// Journaled on the server as the connected agent acting for Bea, never as Bea herself.
		const entry = (await host.journal())
			.filter((line) => line.command === 'project-get')
			.find((line) => JSON.stringify(line.input).includes(ids.citadel)) as
			| { actor?: { kind: string; id: string; onBehalfOf?: string } }
			| undefined;
		// That very agent, the metadata document's client's, not another connection of Bea's.
		expect(documentAgent?.startsWith('agt_')).toBe(true);
		expect(entry?.actor).toMatchObject({ kind: 'agent', id: documentAgent, onBehalfOf: ids.bea });
	});

	it('P3-H3: an owner command is `COMMAND_NOT_FOUND`, and not listed', async () => {
		const names = await agent.names();
		for (const name of [
			'workspace-app-set',
			'member-remove',
			'member-invite',
			'agent-member-add',
		]) {
			expect(names, name).not.toContain(name);
			const answer = await agent.call(name, {});
			expect(answer.success, name).toBe(false);
			expect(answer.error?.code, name).toBe('COMMAND_NOT_FOUND');
		}
	});

	it("P3-H3: a browser request through the mount relay for a project the session's person may not enter is refused before forwarding, by the instance's log", async () => {
		// Sent by Bea's signed-in page itself, as the shell's transport sends it: the browser adds her cookie, the
		// origin and `Sec-Fetch-Site`. Vault is Olu's alone.
		const fromPage = (body: unknown) =>
			bea.page.evaluate(
				async ({ url, body }) => {
					const answer = await fetch(url, {
						method: 'POST',
						headers: {
							'content-type': 'application/json',
							accept: 'application/json, text/event-stream',
						},
						body: JSON.stringify(body),
						credentials: 'same-origin',
					});
					const text = await answer.text();
					let code: string | undefined;
					try {
						code = (JSON.parse(text) as { code?: string }).code;
					} catch {
						code = undefined;
					}
					return { status: answer.status, code, marked: answer.headers.get('loam-relay-refusal') };
				},
				{ url: `${host.root}mounts/team/mcp`, body }
			);
		const from = team.log.length;
		expect(await fromPage(toolCall('notes-get', {}, scoped(ids.vault)))).toEqual({
			status: 403,
			code: 'PROJECT_NOT_FOUND',
			marked: '1',
		});
		expect(team.log.length).toBe(from);
		// The same request in Citadel, which she may enter, is forwarded: the refusal was the relay's decision.
		const allowed = await fromPage(toolCall('notes-get', {}, scoped(ids.citadel)));
		expect(allowed.status).toBe(200);
		expect(allowed.marked).toBeNull();
		expect(team.log.length).toBe(from + 1);
		expect(team.ran.at(-1)).toMatchObject({
			command: 'notes-get',
			scope: { workspace: WORKSPACE, project: ids.citadel },
		});
	});

	afterAll(async () => {
		await agent?.transport.disconnect();
	});
});

describe("P3-E8: step 7's two cases left to the server, on the gated kernel", () => {
	it("P3-E8: the gated server kernel runs no instance refresh: the team instance is reached only by the relay's own discovery, with the deployer's bearer, and every entry with no actor is boot's own work", async () => {
		const entries = await host.journal();
		// The server kernel serves no app's command (`HOSTED_MCP_COMMANDS`), so it never calls `startInstances`: the
		// gated refresh under `INSTANCE_FIELDS` is the kernel's unit ("a real `startInstances` refresh ... on a gated
		// kernel", `kernel/src/apps/mounted.test.ts`), and here it has nothing to run.
		expect(entries.filter((entry) => entry.command === 'app-instance-refresh')).toEqual([]);
		const agent = await mcpClient(host, await tokenFor('bea@acme.example'));
		try {
			expect((await agent.names()).filter((name) => name.startsWith('team-'))).toEqual([]);
		} finally {
			await agent.transport.disconnect();
		}
		// What reached the instance with the deployer's bearer is discovery, and the call P3-H3 forwarded for Bea, rebuilt as `afd-call` (P3-H3's, when it ran first).
		const reached = team.log
			.filter((request) => request.method === 'POST')
			.map((request) => {
				expect(request.headers.authorization).toBe(`Bearer ${TEAM_TOKEN}`);
				const body = JSON.parse(request.body) as { method: string; params?: { name?: string } };
				return body.method === 'tools/call' ? (body.params?.name ?? '') : body.method;
			});
		for (const method of ['server/discover', 'afd-help', 'afd-detail'])
			expect(reached).toContain(method);
		for (const method of reached)
			expect(['server/discover', 'afd-help', 'afd-detail', 'afd-call']).toContain(method);
		// Nothing else ran without a principal: an entry with no actor is boot's own journaled work.
		const unowned = [
			...new Set(entries.filter((entry) => !entry.actor).map((entry) => entry.command)),
		];
		expect(unowned).toEqual(['workspace-deployment-apply']);
	});
});

describe('P3-H5: the server enforces the trust records', () => {
	const roadmap = { name: 'Roadmap', slug: 'roadmap' };
	const restrictAtlas = () => ({
		project: ids.atlas,
		access: { mode: 'restricted', members: [ids.olu, ids.bea] },
	});
	const retitle = { instance: 'team', title: 'Team notes' };

	it("P3-H5: (a) a signed-in non-owner's session on the transport: `project-create` of a listed slug, `project-update { access }` on a listed project and `workspace-app-set` each answer OWNER_REQUIRED, the records unchanged", async () => {
		const before = serverStore(host);
		const cookie = await cookieOf(host, bea);
		for (const [command, input] of [
			['project-create', roadmap],
			['project-update', restrictAtlas()],
			['workspace-app-set', retitle],
		] as const) {
			const answer = await transportCall(host, cookie, ids.bea, command, input);
			expect(answer.status, command).toBe(200);
			expect(answer.body.result?.success, command).toBe(false);
			expect(answer.body.result?.error?.code, command).toBe('OWNER_REQUIRED');
		}
		expect(serverStore(host)).toEqual(before);
	});

	it("P3-H5: P3-E8: (b) a connected agent's token over MCP: `project-create` of a listed slug and `project-update { access }` answer HUMAN_REQUIRED, `workspace-app-set` COMMAND_NOT_FOUND, the records unchanged", async () => {
		const before = serverStore(host);
		// Olu's own agent: an owner's token, so the refusals are the agent interface's, not the owner rule's.
		const agent = await mcpClient(host, await tokenFor('olu@acme.example'));
		try {
			const created = await agent.call('project-create', roadmap);
			expect(created.error?.code).toBe('HUMAN_REQUIRED');
			const updated = await agent.call('project-update', restrictAtlas());
			expect(updated.error?.code).toBe('HUMAN_REQUIRED');
			const set = await agent.call('workspace-app-set', retitle);
			expect(set.error?.code).toBe('COMMAND_NOT_FOUND');
		} finally {
			await agent.transport.disconnect();
		}
		expect(serverStore(host)).toEqual(before);
	});

	it("P3-H5: (d) the owner's cookie with a foreign `Origin`, or as `text/plain`, is refused, and the records are unchanged", async () => {
		const before = serverStore(host);
		const journaled = (await host.journal()).length;
		const cookie = await cookieOf(host, olu);
		for (const [label, headers] of [
			['a foreign Origin', { origin: 'https://evil.example' }],
			['text/plain', { 'content-type': 'text/plain' }],
		] as const) {
			for (const [command, input] of [
				['project-create', roadmap],
				['project-update', restrictAtlas()],
				['workspace-app-set', retitle],
			] as const) {
				const answer = await transportCall(host, cookie, ids.olu, command, input, headers);
				expect(answer.status, `${label} ${command}`).toBe(403);
				expect(answer.body.code, `${label} ${command}`).toBe('REQUEST_NOT_SAME_ORIGIN');
			}
		}
		expect(serverStore(host)).toEqual(before);
		// Nothing ran: no entry for any of the three commands since.
		expect(
			(await host.journal())
				.slice(journaled)
				.filter((entry) =>
					['project-create', 'project-update', 'workspace-app-set'].includes(String(entry.command))
				)
		).toEqual([]);
	});

	it("P3-H5: (c) the owner's session makes the same three calls and each succeeds, changing the records, read back from the server's store", async () => {
		const cookie = await cookieOf(host, olu);
		for (const [command, input] of [
			['project-create', roadmap],
			['project-update', restrictAtlas()],
			['workspace-app-set', retitle],
		] as const) {
			const answer = await transportCall(host, cookie, ids.olu, command, input);
			expect(answer.status, command).toBe(200);
			expect(answer.body.result?.success, JSON.stringify(answer.body.result?.error)).toBe(true);
		}
		const projects = serverRows<{ id: string; slug: string; access?: unknown }>(host, 'project');
		expect(projects.map((project) => project.slug)).toContain('roadmap');
		expect(projects.find((project) => project.id === ids.atlas)?.access).toEqual({
			mode: 'restricted',
			members: [ids.olu, ids.bea],
		});
		expect(
			serverRows<{ id: string; overrides?: { title?: string } }>(host, 'workspace-app').find(
				(row) => row.id === 'team'
			)?.overrides?.title
		).toBe('Team notes');
	});
	it("P3-H5: the refusals are the listing's and the owner rule's: the same non-owner and agent create a project of an unlisted slug", async () => {
		const cookie = await cookieOf(host, bea);
		const session = await transportCall(host, cookie, ids.bea, 'project-create', {
			name: 'Notebook',
			slug: 'notebook',
		});
		expect(session.body.result?.success, JSON.stringify(session.body.result?.error)).toBe(true);
		const agent = await mcpClient(host, await tokenFor('olu@acme.example'));
		try {
			const created = await agent.call('project-create', { name: 'Ledger', slug: 'ledger' });
			expect(created.success, JSON.stringify(created.error)).toBe(true);
		} finally {
			await agent.transport.disconnect();
		}
		const slugs = serverRows<{ slug: string }>(host, 'project').map((project) => project.slug);
		expect(slugs).toEqual(expect.arrayContaining(['notebook', 'ledger']));
	});
});
