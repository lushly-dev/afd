/**
 * P3-E8: identity over MCP, and the wrong audience refused, through a test-only handler (phase 3 specification, 9.6;
 * #853).
 *
 * What this proves: a real `createMcpHandler` from afd-server, with `credentialsGate` and `createMcpAuth`, on loopback
 * `node:http`, over `createKernelParts({ gate: 'principal', auth: <a Mock>, identity: { mode: 'provider' } })`, with
 * real tokens from Better Auth 1.7.18's `oauthProvider` (a provider in this process, from `createLoamAuthOptions`).
 * **The Mock's signed-in person is an owner and a member of the restricted project; the refused tokens' people are
 * neither**, so any fallback to the adapter would turn a refusal into an allowed call. What it does not prove: the
 * hosted server, its store, its journal or its route (phase 6's step 4), or a browser's consent page (P3-E20).
 */

import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { StreamableHttpTransport } from '@lushly-dev/afd-client/streamable-http';
import { type CommandResult, MemoryJournalSink } from '@lushly-dev/afd-core';
import { createMcpHandler } from '@lushly-dev/afd-server';
import { defineCommandWithSchema } from '@lushly-dev/afd-server/define';
import { createKernelParts, type KernelParts } from '@lushly-dev/loam-kernel';
import {
	createFixedEnvironment,
	createSeededRandom,
	createSteppingClock,
	HUMAN_COMMANDS,
	OWNER_COMMANDS,
	scopedDeployment,
	scopedPorts,
	seedProjects,
} from '@lushly-dev/loam-kernel/testing';
import { MemoryAdapter } from '@lushly-dev/local-db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as z from 'zod/mini';
import { CONNECTED_AGENT_MODEL } from './connected-agents.js';
import { createMcpAuth, credentialsGate, providerKeys } from './mcp.js';
import { CLIENT_ADDRESS_HEADER } from './options.js';
import { createServerKernel } from './server.js';
import { createTestProvider } from './testing/provider.js';
import { TestBrowser } from './testing/requests.js';

const ORIGIN = 'https://acme.example';
const ISSUER = `${ORIGIN}/api/auth`;
const RESOURCE = `${ORIGIN}/mcp`;
const REDIRECT = 'http://127.0.0.1:43123/callback';
const PASSWORD = 'correct horse battery staple';
const MOCK_PERSON = 'mock-user-olu@example.com';
const database = new DatabaseSync(':memory:');
let provider: Awaited<ReturnType<typeof createTestProvider>>;
let parts: KernelParts;
let journal: MemoryJournalSink;
let mock: MockAuthAdapter;
let url: string;
let clientId: string;
let closeServer: () => Promise<void>;
/** How often anything read the Mock's session once the kernel booted. */
let sessionReads = 0;
let store: MemoryAdapter;
/** E15: every secret the session's flows made: cookie values, PKCE verifiers, codes, access and refresh tokens. */
const issued: string[] = [];

const adapter = async () => (await provider.auth.$context).adapter as never;
/** What the provider's server API answers the cases that read it. */
interface ProviderAnswer {
	client_id: string;
	token: string;
	keys: Record<string, unknown>[];
}
const api = () =>
	provider.auth.api as unknown as Record<
		'adminCreateOAuthClient' | 'getJwks' | 'signJWT',
		(input: unknown) => Promise<ProviderAnswer>
	>;

/** E15: a browser's cookie values, and a session cookie's bare token (the value is `token.signature`). */
function keepCookies(page: TestBrowser): void {
	for (const [name, value] of page.jar) {
		issued.push(value);
		if (name.endsWith('session_token'))
			issued.push(decodeURIComponent(value).split('.')[0] as string);
	}
}

/** E15: the address every sign-in comes from, as the hosted server's header gives it (A7), so sessions record one. */
const ADDRESS = '203.0.113.7';

async function as(email: string): Promise<TestBrowser> {
	const page = new TestBrowser((request) => provider.auth.handler(request), ORIGIN);
	const signed = await page.call('/sign-in/email', {
		body: { email, password: PASSWORD },
		headers: { [CLIENT_ADDRESS_HEADER]: ADDRESS },
	});
	expect(signed.status).toBe(200);
	keepCookies(page);
	return page;
}

/** The authorization code flow as an MCP client runs it, PKCE S256 and the resource, with the person's approval. */
async function token(
	email: string,
	options: { scope?: string; resource?: string | null; client?: string } = {}
): Promise<{ access?: string; consent: { status: number; body: unknown } }> {
	const page = await as(email);
	const verifier = randomBytes(32).toString('base64url');
	issued.push(verifier);
	const query = new URLSearchParams({
		response_type: 'code',
		client_id: options.client ?? clientId,
		redirect_uri: REDIRECT,
		scope: options.scope ?? 'loam:read loam:write',
		state: 's',
		code_challenge: createHash('sha256').update(verifier).digest('base64url'),
		code_challenge_method: 'S256',
		...(options.resource === null ? {} : { resource: options.resource ?? RESOURCE }),
	});
	const authorized = await page.call(`/oauth2/authorize?${query}`);
	const location = new URL(authorized.headers.get('location') ?? '', ORIGIN);
	// A consent the person gave before is kept: the provider redirects with the code at once.
	const consent = location.href.startsWith(REDIRECT)
		? { status: 200, body: { url: location.href } }
		: await page.call('/oauth2/consent', {
				body: { accept: true, oauth_query: location.search.slice(1) },
			});
	const redirect = (consent.body as { url?: string } | null)?.url;
	if (consent.status !== 200 || !redirect) return { consent };
	const code = new URL(redirect).searchParams.get('code') as string;
	issued.push(code);
	const exchanged = await provider.auth.handler(
		new Request(`${ISSUER}/oauth2/token`, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				redirect_uri: REDIRECT,
				client_id: options.client ?? clientId,
				code_verifier: verifier,
				...(options.resource === null ? {} : { resource: options.resource ?? RESOURCE }),
			}),
		})
	);
	const tokens = (await exchanged.json()) as { access_token?: string; refresh_token?: string };
	issued.push(
		...[tokens.access_token, tokens.refresh_token].filter((value) => value !== undefined)
	);
	keepCookies(page);
	return { access: tokens.access_token, consent };
}

/** A compact JWS signed with a key of the test's own: another issuer's token. */
function foreignToken(claims: Record<string, unknown>): string {
	const { privateKey } = generateKeyPairSync('ed25519');
	const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
	const head = `${part({ alg: 'EdDSA', typ: 'at+jwt', kid: 'foreign' })}.${part(claims)}`;
	return `${head}.${sign(null, Buffer.from(head), privateKey).toString('base64url')}`;
}

/** E15: every JSON-RPC answer any MCP client of this file received, results and errors, as each arrived. */
const envelopes: unknown[] = [];

/** One MCP client with a bearer token. */
async function connect(bearer: string) {
	const transport = new StreamableHttpTransport(url, {
		clientName: 'p3-e8',
		clientVersion: '0',
		mode: 'auto',
		headers: { authorization: `Bearer ${bearer}` },
	});
	await transport.connect();
	let id = 0;
	const request = async (method: string, params: unknown) => {
		const answer = (await transport.send({
			jsonrpc: '2.0',
			id: ++id,
			method,
			params,
		} as never)) as {
			result?: Record<string, unknown>;
			error?: { code: number; message: string };
		};
		envelopes.push(answer);
		return answer;
	};
	return {
		transport,
		request,
		async call<T = unknown>(
			name: string,
			args: unknown = {},
			scope?: unknown
		): Promise<CommandResult<T>> {
			const answer = await request('tools/call', {
				name,
				arguments: args,
				...(scope ? { _meta: { 'dev.loam/scope': scope } } : {}),
			});
			if (answer.error) {
				return {
					success: false,
					error: { code: String(answer.error.code), message: answer.error.message },
				} as never;
			}
			const result = answer.result as {
				structuredContent?: CommandResult<T>;
				content?: { text: string }[];
			};
			return (
				result.structuredContent ??
				(JSON.parse(result.content?.[0]?.text ?? '{}') as CommandResult<T>)
			);
		},
		async names(): Promise<string[]> {
			const listed = await request('tools/list', {});
			return ((listed.result?.tools ?? []) as { name: string }[]).map((tool) => tool.name).sort();
		},
	};
}

/** A raw POST to the MCP route, for the HTTP layer's own answers. */
const post = (headers: Record<string, string>, body: unknown) =>
	fetch(url, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			...headers,
		},
		body: JSON.stringify(body),
	});

/** The principals a test-only command saw, so a case can try one after its request has ended. */
const kept: unknown[] = [];
/** A test-only command through the whole chain: it keeps its call's principal, as a handler's kept client would. */
const keep = defineCommandWithSchema({
	name: 'test-principal-keep',
	description: "Keeps its call's principal",
	input: z.strictObject({}),
	jsonSchema: { type: 'object', properties: {}, additionalProperties: false },
	async handler(_input, context) {
		kept.push((context as { principal?: unknown }).principal);
		return { success: true, data: {} };
	},
});

const INITIALIZE = {
	jsonrpc: '2.0',
	id: 1,
	method: 'initialize',
	params: {
		protocolVersion: '2025-06-18',
		capabilities: {},
		clientInfo: { name: 'raw', version: '0' },
	},
};

let people: Record<string, string>;
const CITADEL = { workspace: 'personal', project: 'prj_citadel' };

beforeAll(async () => {
	provider = await createTestProvider({
		baseURL: ISSUER,
		secret: 'a'.repeat(32),
		database,
		// The kernel's own workspace: one binding for both halves (2.3).
		workspace: 'personal',
		organization: { slug: 'acme', name: 'Acme' },
		people: [
			{ email: 'olu@example.com', name: 'Olu', role: 'owner', password: PASSWORD },
			{ email: 'bea@example.com', name: 'Bea', role: 'member', password: PASSWORD },
			{ email: 'cy@example.com', name: 'Cy', role: 'member', password: PASSWORD },
			{ email: 'dee@example.com', name: 'Dee', role: null, password: PASSWORD },
			{ email: 'eve@example.com', name: 'Eve', role: 'member', password: PASSWORD },
			{ email: 'fay@example.com', name: 'Fay', role: 'member', password: PASSWORD },
		],
		methods: ['passkey', 'password'],
		send: async () => {},
	});
	people = provider.people;
	// The deployer's pre-registration: an owner's session, through the server API (9.4).
	const owner = await as('olu@example.com');
	const client = await api().adminCreateOAuthClient({
		headers: new Headers({ cookie: owner.cookie }),
		body: {
			client_name: 'Claude Code',
			redirect_uris: [REDIRECT],
			token_endpoint_auth_method: 'none',
			application_type: 'native',
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
		},
	});
	clientId = client.client_id;

	// Citadel restricted to Bea and to the Mock's person: a kernel that read its adapter would let the Mock's call in.
	store = new MemoryAdapter();
	const base = {
		workspace: 'personal',
		icon: 'system/folder',
		status: 'active' as const,
		memberEpoch: 0,
		updatedAt: 1,
		createdBy: 'local',
		updatedBy: 'local',
	};
	await seedProjects(store, [
		{
			...base,
			id: 'prj_atlas',
			slug: 'atlas',
			name: 'Atlas',
			access: { mode: 'workspace' },
			createdAt: 1,
		},
		{
			...base,
			id: 'prj_citadel',
			slug: 'citadel',
			name: 'Citadel',
			access: { mode: 'restricted', members: [people['bea@example.com'] as string, MOCK_PERSON] },
			createdAt: 2,
		},
	]);
	const clock = createSteppingClock();
	mock = new MockAuthAdapter({ clock: { now: clock } });
	await mock.signIn({ method: 'credentials', email: 'olu@example.com', password: 'x' } as never);
	// Counted from before the kernel is built: neither its boot nor any call may read the adapter (9.5).
	const getSession = mock.getSession.bind(mock);
	mock.getSession = () => {
		sessionReads += 1;
		return getSession();
	};
	journal = new MemoryJournalSink();
	parts = await createKernelParts({
		store,
		storeKind: 'memory',
		journal,
		auth: mock,
		environment: createFixedEnvironment(),
		host: 'test',
		clock,
		random: createSeededRandom('p3-e8'),
		deployment: scopedDeployment(),
		ports: scopedPorts(),
		identity: { mode: 'provider', organization: 'acme', path: 'api/auth', methods: ['passkey'] },
		// The Mock's person an owner, as a probe would say: a gated kernel never reads it (9.5).
		membership: { mode: 'provider', members: new Map([[MOCK_PERSON, 'owner']]), digest: 'x' },
		gate: 'principal',
	});
	const served = parts.mcpOptions();
	if (!served || !parts.admitPrincipal) throw new Error('No principal gate');
	const mutations = new Map(
		served.commands.map((command) => [command.name, command.mutation === true])
	);
	const handler = createMcpHandler({
		name: 'loam-p3-e8',
		version: '0',
		host: '127.0.0.1',
		toolStrategy: 'individual',
		commands: [...served.commands, keep as never].map((command) => ({
			...command,
			expose: { ...command.expose, mcp: true },
		})),
		middleware: [
			credentialsGate({
				adapter,
				workspace: 'personal',
				admit: parts.admitPrincipal,
				retire: parts.retirePrincipal,
			}),
			...served.middleware,
		],
		contextFields: [...served.contextFields],
		auth: createMcpAuth({
			resource: RESOURCE,
			provider: { issuer: ISSUER, keys: providerKeys(() => api().getJwks({})) },
			isMutation: (name) => mutations.get(name),
			onRefusal: () => {},
		}),
	});
	const server = createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
	closeServer = async () => {
		handler.dispose();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await parts.kernel.dispose();
	};
});
afterAll(async () => {
	await closeServer?.();
	database.close();
});

describe('P3-E8: the token layer refuses before any command (9.2, M5)', () => {
	it('P3-E8: no token is a 401', async () => {
		expect((await post({}, INITIALIZE)).status).toBe(401);
	});

	it("P3-E8: a token for another audience is a 401, and the JWT plugin's own /token route is not served", async () => {
		const signed = await api().signJWT({
			body: {
				payload: {
					sub: people['bea@example.com'],
					aud: 'https://other.example/mcp',
					client_id: clientId,
					scope: 'loam:read loam:write',
				},
			},
		});
		expect((await post({ authorization: `Bearer ${signed.token}` }, INITIALIZE)).status).toBe(401);
		const page = await as('bea@example.com');
		expect((await page.call('/token')).status).toBe(404);
	});

	it('P3-E8: an opaque token issued without `resource` is a 401', async () => {
		const issued = await token('bea@example.com', { resource: null });
		expect(issued.access).toBeTypeOf('string');
		expect(issued.access?.split('.').length).not.toBe(3);
		expect((await post({ authorization: `Bearer ${issued.access}` }, INITIALIZE)).status).toBe(401);
	});

	it("P3-E8: another issuer's token is a 401 `invalid_token`", async () => {
		const now = Math.floor(Date.now() / 1000);
		const forged = foreignToken({
			iss: 'https://elsewhere.example/api/auth',
			sub: people['bea@example.com'],
			aud: RESOURCE,
			client_id: clientId,
			scope: 'loam:read loam:write',
			iat: now,
			exp: now + 300,
		});
		const answer = await post({ authorization: `Bearer ${forged}` }, INITIALIZE);
		expect(answer.status).toBe(401);
		expect(answer.headers.get('www-authenticate')).toContain('invalid_token');
	});

	it('P3-E8: a pairwise registration is refused', async () => {
		const owner = await as('olu@example.com');
		await expect(
			api().adminCreateOAuthClient({
				headers: new Headers({ cookie: owner.cookie }),
				body: {
					client_name: 'Pairwise',
					redirect_uris: [REDIRECT],
					token_endpoint_auth_method: 'none',
					application_type: 'native',
					subject_type: 'pairwise',
				},
			})
		).rejects.toThrow();
	});

	it("P3-E8: `connectAgent` refuses a non-member's approval: no record, and no code", async () => {
		const issued = await token('dee@example.com');
		expect(issued.access).toBeUndefined();
		expect(issued.consent.status).toBe(403);
		expect((issued.consent.body as { code?: string }).code).toBe('WORKSPACE_NOT_MEMBER');
		const rows = database
			.prepare('SELECT * FROM loam_connected_agent WHERE sponsor = ?')
			.all(people['dee@example.com'] as string);
		expect(rows).toEqual([]);
	});
});

describe("P3-E8: the right token runs as the connected agent, for the token's person (9.2, 9.5)", () => {
	let bea: Awaited<ReturnType<typeof connect>>;
	let cy: Awaited<ReturnType<typeof connect>>;
	let beaAgent: string;

	beforeAll(async () => {
		bea = await connect((await token('bea@example.com')).access as string);
		cy = await connect((await token('cy@example.com')).access as string);
		beaAgent = (
			database
				.prepare('SELECT agentId FROM loam_connected_agent WHERE sponsor = ?')
				.get(people['bea@example.com'] as string) as { agentId: string }
		).agentId;
	});
	afterAll(async () => {
		await bea?.transport.disconnect();
		await cy?.transport.disconnect();
	});

	it("P3-E8: it enters its person's restricted project, never the kernel's person's", async () => {
		const listed = await bea.call<{ projects: { slug: string }[] }>('project-list');
		expect(listed.success).toBe(true);
		expect(listed.data?.projects.map((project) => project.slug).sort()).toEqual([
			'atlas',
			'citadel',
		]);
		const other = await cy.call<{ projects: { slug: string }[] }>('project-list');
		expect(other.data?.projects.map((project) => project.slug)).toEqual(['atlas']);
		const refused = await cy.call('dual-where', {}, CITADEL);
		expect(refused.error?.code).toBe('PROJECT_NOT_FOUND');
	});

	it('P3-E8: a nested read in the restricted project, allowed for its person and journaled as the `agt_` actor', async () => {
		const before = (await journal.read()).length;
		const nested = await bea.call<{ here: unknown }>('dual-nested', {}, CITADEL);
		expect(nested.success).toBe(true);
		expect(nested.data?.here).toEqual(CITADEL);
		const entries = (await journal.read()).slice(before);
		const named = entries.filter(
			(entry) => entry.command === 'dual-where' || entry.command === 'dual-nested'
		);
		expect(named.length).toBeGreaterThanOrEqual(2);
		for (const entry of named) {
			expect(entry.actor).toMatchObject({
				kind: 'agent',
				id: beaAgent,
				onBehalfOf: people['bea@example.com'],
			});
		}
		// Another person's token: refused, the nested read never made.
		expect((await cy.call('dual-nested', {}, CITADEL)).error?.code).toBe('PROJECT_NOT_FOUND');
	});

	it("P3-E8: an agent's change of a project's access is `HUMAN_REQUIRED`", async () => {
		const changed = await bea.call('project-update', {
			project: 'atlas',
			access: { mode: 'restricted', members: [people['bea@example.com']] },
		});
		expect(changed.error?.code).toBe('HUMAN_REQUIRED');
	});

	it('P3-E8: human and owner commands are not served', async () => {
		// Every one the kernel lists, not a sample: none in either token's tools, and each a name that does not exist.
		const refused = [...new Set([...HUMAN_COMMANDS, ...OWNER_COMMANDS])].sort();
		expect(refused.length).toBeGreaterThan(15);
		const names = await bea.names();
		expect(names.filter((name) => refused.includes(name))).toEqual([]);
		expect(names).toEqual(await cy.names());
		for (const name of refused) {
			const answer = await bea.call(name, {});
			expect(answer.success, name).toBe(false);
			expect(answer.error?.code, name).toBe('COMMAND_NOT_FOUND');
		}
	});

	it('P3-E8: no entry or result holds a token or `credentials`', async () => {
		const text = JSON.stringify(await journal.read());
		expect(text).not.toContain('credentials');
		expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
		expect(text).not.toContain('principal');
	});

	it('P3-E8: no call read the adapter', () => {
		expect(sessionReads).toBe(0);
	});
});

/**
 * #2784's job (`docs/phases/3-identity/scenarios/narrow-connected-agent.scenario.yaml`): the person narrows their own
 * connected agent with `account-agent-update` in their own kernel, a browser's, whose account capability is the
 * provider's routes by their session, as the web host's is; the agent's next MCP call is decided on the new record.
 */
describe('#2784: a person narrows their connected agent, and its next call reads the new record (9.2, 9.5)', () => {
	let bea: Awaited<ReturnType<typeof connect>>;
	let beaAgent: string;
	let browser: KernelParts;
	const ATLAS = { workspace: 'personal', project: 'prj_atlas' };
	const record = () =>
		database
			.prepare('SELECT * FROM loam_connected_agent WHERE agentId = ?')
			.get(beaAgent) as Record<string, unknown>;

	beforeAll(async () => {
		bea = await connect((await token('bea@example.com')).access as string);
		beaAgent = (
			database
				.prepare('SELECT agentId FROM loam_connected_agent WHERE sponsor = ?')
				.get(people['bea@example.com'] as string) as { agentId: string }
		).agentId;
		const page = await as('bea@example.com');
		const request = async (path: string, body?: unknown): Promise<never> => {
			const answer = await page.call(path, body === undefined ? {} : { body });
			if (answer.status !== 200) {
				const { code, message } = (answer.body ?? {}) as { code?: string; message?: string };
				throw Object.assign(new Error(message ?? path), { code, status: answer.status });
			}
			return answer.body as never;
		};
		// Bea's own kernel: her session's person, the provider reached by her session (the web host's `loamAccount`).
		const auth = new MockAuthAdapter();
		await auth.signIn({ method: 'credentials', email: 'bea@example.com', password: 'x' } as never);
		const session = auth.getSession.bind(auth);
		auth.getSession = () => {
			const state = session();
			return state.status === 'authenticated'
				? { ...state, user: { ...state.user, id: people['bea@example.com'] as string } }
				: state;
		};
		Object.assign(auth, {
			account: {
				get: () => request('/loam/account'),
				update: () => request('/update-user'),
				members: () => request('/loam/members'),
				invitations: async () =>
					((await request('/loam/invitations')) as { invitations: never[] }).invitations,
				agents: async () =>
					((await request('/loam/connected-agents')) as { agents: never[] }).agents,
				updateAgent: async (agent: string, access: unknown) => {
					await request('/loam/connected-agents/update', { agent, access });
				},
			},
		});
		const own = new MemoryAdapter();
		await seedProjects(own, (await store.list('project')).data as never);
		browser = await createKernelParts({
			store: own,
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth,
			environment: createFixedEnvironment(),
			host: 'test',
			clock: createSteppingClock(),
			random: createSeededRandom('p3-e8-browser'),
			deployment: scopedDeployment(),
			ports: scopedPorts(),
			identity: { mode: 'provider', organization: 'acme', path: 'api/auth', methods: ['passkey'] },
			membership: {
				mode: 'provider',
				members: new Map([[people['bea@example.com'] as string, 'member']]),
				digest: 'x',
			},
		});
	});
	afterAll(async () => {
		await bea?.transport.disconnect();
		await browser?.kernel.dispose();
	});

	it('#2784: narrowed to Atlas, its call in Citadel is refused; widened again, it is allowed, on the same token', async () => {
		const listed = await browser.kernel.call<{ agents: { agent: string; access: unknown }[] }>(
			'account-agent-list'
		);
		expect(listed.data?.agents).toEqual([
			expect.objectContaining({
				agent: beaAgent,
				access: { workspace: true, projects: 'sponsor' },
			}),
		]);
		expect((await bea.call('dual-where', {}, CITADEL)).success).toBe(true);

		const narrowed = await browser.kernel.call('account-agent-update', {
			agent: beaAgent,
			access: { workspace: true, projects: ['atlas'] },
		});
		expect(narrowed.data).toEqual({
			agent: beaAgent,
			access: { workspace: true, projects: ['prj_atlas'] },
			previous: { workspace: true, projects: 'sponsor' },
		});
		expect(JSON.parse(record().access as string)).toEqual({
			workspace: true,
			projects: ['prj_atlas'],
		});
		expect(record().updatedBy).toBe(people['bea@example.com']);
		// No token was revoked: the same one works where the record allows, and is refused elsewhere as a missing project.
		expect((await bea.call('dual-where', {}, ATLAS)).success).toBe(true);
		expect((await bea.call('project-list')).success).toBe(true);
		expect((await bea.call('dual-where', {}, CITADEL)).error?.code).toBe('PROJECT_NOT_FOUND');
		// Another member's list names none of its projects, only how many: the provider cannot tell which they may see.
		const others = (await (await as('eve@example.com')).call('/loam/connected-agents')).body as {
			agents: { id: string; access: unknown; withheldProjects?: number }[];
		};
		expect(others.agents.find((each) => each.id === beaAgent)).toMatchObject({
			access: { workspace: true, projects: [] },
			withheldProjects: 1,
		});
		expect(JSON.stringify(others)).not.toContain('prj_atlas');
		// Approving the same client again, on the consent page, keeps the narrowing: only its person widens it.
		expect(
			database
				.prepare('DELETE FROM oauthConsent WHERE userId = ?')
				.run(people['bea@example.com'] as string).changes
		).toBe(1);
		const again = await token('bea@example.com');
		expect(again.consent.status).toBe(200);
		expect(again.access).toBeTypeOf('string');
		expect(JSON.parse(record().access as string)).toEqual({
			workspace: true,
			projects: ['prj_atlas'],
		});
		// An undo of a change already replaced (another tab's) is refused, never restoring more than it replaced.
		const tabA = (await browser.kernel.call('account-agent-update', {
			agent: beaAgent,
			access: { workspace: true, projects: [] },
		})) as { success: boolean; undoCommand?: string; undoArgs?: unknown };
		expect(tabA.success).toBe(true);
		const page = await as('bea@example.com');
		const tabB = await page.call('/loam/connected-agents/update', {
			body: {
				agent: beaAgent,
				access: { workspace: false, projects: [] },
				previous: { workspace: true, projects: [] },
			},
		});
		expect(tabB.status).toBe(200);
		const undone = await browser.kernel.call(tabA.undoCommand as string, tabA.undoArgs);
		expect(undone.error?.code).toBe('AGENT_ACCESS_CHANGED');
		expect(JSON.parse(record().access as string)).toEqual({ workspace: false, projects: [] });
		// Undone at once, with nothing in between, it restores what it replaced.
		const tabC = (await browser.kernel.call('account-agent-update', {
			agent: beaAgent,
			access: { workspace: true, projects: 'sponsor' },
		})) as { undoCommand?: string; undoArgs?: unknown };
		expect((await browser.kernel.call(tabC.undoCommand as string, tabC.undoArgs)).success).toBe(
			true
		);
		expect(JSON.parse(record().access as string)).toEqual({ workspace: false, projects: [] });
		await browser.kernel.call('account-agent-update', {
			agent: beaAgent,
			access: { workspace: true, projects: 'sponsor' },
		});
		const replaced = await page.call('/loam/connected-agents/update', {
			body: {
				agent: beaAgent,
				access: { workspace: false, projects: [] },
				previous: { workspace: true, projects: ['prj_atlas'] },
			},
		});
		expect([replaced.status, (replaced.body as { code?: string }).code]).toEqual([
			409,
			'AGENT_ACCESS_CHANGED',
		]);
		expect(JSON.parse(record().access as string)).toEqual({
			workspace: true,
			projects: 'sponsor',
		});
		await browser.kernel.call('account-agent-update', {
			agent: beaAgent,
			access: { workspace: true, projects: ['atlas'] },
		});

		const widened = await browser.kernel.call('account-agent-update', {
			agent: beaAgent,
			access: { workspace: true, projects: 'sponsor' },
		});
		expect(widened.success).toBe(true);
		expect((await bea.call('dual-where', {}, CITADEL)).success).toBe(true);
	});

	it("#2784: the agent cannot reach the command, and the endpoint refuses another person's change and a malformed one", async () => {
		const answer = await bea.call('account-agent-update', {
			agent: beaAgent,
			access: { workspace: true, projects: 'sponsor' },
		});
		expect(answer.error?.code).toBe('COMMAND_NOT_FOUND');
		const held = record();
		// No one who is no member learns whether an id is someone's agent: refused before the record is read.
		const dee = await as('dee@example.com');
		for (const agent of [beaAgent, 'agt_zzzzzzzzzzzzzzzzzzzz']) {
			const outside = await dee.call('/loam/connected-agents/update', {
				body: { agent, access: { workspace: true, projects: 'sponsor' } },
			});
			expect([outside.status, (outside.body as { code?: string }).code]).toEqual([
				403,
				'WORKSPACE_NOT_MEMBER',
			]);
		}
		const eve = await as('eve@example.com');
		const other = await eve.call('/loam/connected-agents/update', {
			body: { agent: beaAgent, access: { workspace: false, projects: [] } },
		});
		expect([other.status, (other.body as { code?: string }).code]).toEqual([
			403,
			'AGENT_MEMBER_SPONSOR_ONLY',
		]);
		const page = await as('bea@example.com');
		for (const access of [
			undefined,
			{ workspace: 'yes', projects: 'sponsor' },
			{ workspace: true, projects: 'everything' },
			{ workspace: true, projects: [''] },
			{ workspace: true, projects: 'sponsor', more: true },
			{ workspace: true, projects: Array.from({ length: 201 }, (_, at) => `prj_${at}`) },
		]) {
			const malformed = await page.call('/loam/connected-agents/update', {
				body: { agent: beaAgent, access },
			});
			expect([malformed.status, (malformed.body as { code?: string }).code]).toEqual([
				400,
				'VALIDATION_ERROR',
			]);
		}
		const missing = await page.call('/loam/connected-agents/update', {
			body: { agent: 'agt_zzzzzzzzzzzzzzzzzzzz', access: { workspace: true, projects: [] } },
		});
		expect([missing.status, (missing.body as { code?: string }).code]).toEqual([
			404,
			'AGENT_MEMBER_NOT_FOUND',
		]);
		// The endpoint's write is conditional on the record as read: one that changed in between matches no row, which
		// the adapter answers with null, so the endpoint reads again and refuses (an owner's removal in between stands).
		const raced = await (
			(await adapter()) as unknown as {
				update(query: unknown): Promise<unknown>;
			}
		).update({
			model: CONNECTED_AGENT_MODEL,
			where: [
				{ field: 'id', value: held.id },
				{ field: 'access', value: '{"workspace":false,"projects":[]}' },
			],
			update: { access: '{"workspace":true,"projects":"sponsor"}' },
		});
		expect(raced).toBeNull();
		expect(record()).toEqual(held);
	});
});

describe("P3-E8: what Loam refuses after a valid token (9.2's steps 3 to 6)", () => {
	it('P3-E8: a read-only token is refused a mutation with a 403', async () => {
		const reader = await connect(
			(await token('eve@example.com', { scope: 'loam:read' })).access as string
		);
		// The client's transport surfaces the 403's step-up challenge as its own error.
		await expect(reader.call('project-create', { name: 'Nope' })).rejects.toThrow(/loam:write/);
		const raw = await post(
			{
				authorization: `Bearer ${(await token('eve@example.com', { scope: 'loam:read' })).access}`,
			},
			{
				jsonrpc: '2.0',
				id: 2,
				method: 'tools/call',
				params: { name: 'project-create', arguments: { name: 'Nope' } },
			}
		);
		expect(raw.status).toBe(403);
		expect((await reader.call('project-list')).success).toBe(true);
		await reader.transport.disconnect();
	});

	it("P3-E8: `WORKSPACE_NOT_MEMBER` once the person's member row is gone, though the token is still valid", async () => {
		const access = (await token('cy@example.com')).access as string;
		const cy = await connect(access);
		expect((await cy.call('project-list')).success).toBe(true);
		// A provider-side removal that bypassed Loam's hooks, as a deployer's direct change would.
		database.prepare('DELETE FROM member WHERE userId = ?').run(people['cy@example.com'] as string);
		expect((await cy.call('project-list')).error?.code).toBe('WORKSPACE_NOT_MEMBER');
		await cy.transport.disconnect();
	});

	it('P3-E8: a token whose client is no longer connected is `AGENT_NOT_CONNECTED`', async () => {
		const access = (await token('eve@example.com')).access as string;
		const eve = await connect(access);
		expect((await eve.call('project-list')).success).toBe(true);
		const page = await as('eve@example.com');
		const agent = (
			database
				.prepare('SELECT agentId FROM loam_connected_agent WHERE sponsor = ?')
				.get(people['eve@example.com'] as string) as { agentId: string }
		).agentId;
		expect((await page.call('/loam/connected-agents/disconnect', { body: { agent } })).status).toBe(
			200
		);
		expect((await eve.call('project-list')).error?.code).toBe('AGENT_NOT_CONNECTED');
		await eve.transport.disconnect();
	});

	it("P3-E8: a non-owner's direct removal, with and without `forget`, and a disconnect of another's agent change nothing", async () => {
		await token('bea@example.com');
		const row = () =>
			database
				.prepare('SELECT * FROM loam_connected_agent WHERE sponsor = ?')
				.get(people['bea@example.com'] as string) as Record<string, unknown>;
		const held = row();
		const evePage = await as('eve@example.com');
		for (const body of [{ agent: held.agentId }, { agent: held.agentId, forget: true }]) {
			const answer = await evePage.call('/loam/connected-agents/remove', { body });
			expect(answer.status).toBe(403);
			expect((answer.body as { code?: string }).code).toBe('OWNER_REQUIRED');
		}
		const disconnect = await evePage.call('/loam/connected-agents/disconnect', {
			body: { agent: held.agentId },
		});
		expect(disconnect.status).toBe(403);
		// Refused as the sponsor's alone (5.3): only an agent's own sponsor disconnects it, and the record is unchanged.
		expect((disconnect.body as { code?: string }).code).toBe('AGENT_MEMBER_SPONSOR_ONLY');
		expect(row()).toEqual(held);
	});

	it("P3-E8: an owner's removal keeps the record, and the same person cannot reconnect it until `forget`", async () => {
		const owner = await as('olu@example.com');
		const agent = (
			database
				.prepare('SELECT agentId FROM loam_connected_agent WHERE sponsor = ?')
				.get(people['bea@example.com'] as string) as { agentId: string }
		).agentId;
		expect((await owner.call('/loam/connected-agents/remove', { body: { agent } })).status).toBe(
			200
		);
		// Its sponsor cannot clear an owner's removal by disconnecting it (the reviews' blocker): refused, and it stays.
		const bea = await as('bea@example.com');
		const disconnect = await bea.call('/loam/connected-agents/disconnect', { body: { agent } });
		expect([disconnect.status, (disconnect.body as { code?: string }).code]).toEqual([
			403,
			'AGENT_DISCONNECTED_BY_OWNER',
		]);
		const again = await token('bea@example.com');
		expect(again.access).toBeUndefined();
		expect((again.consent.body as { code?: string }).code).toBe('AGENT_DISCONNECTED_BY_OWNER');
		expect(
			(await owner.call('/loam/connected-agents/remove', { body: { agent, forget: true } })).status
		).toBe(200);
		expect((await token('bea@example.com')).access).toBeTypeOf('string');
	});
});

describe("P3-E8: the server kernel's own calls and its construction (9.5)", () => {
	it("P3-E8: boot's own work ran with no principal, and nothing else passes without one", async () => {
		const entries = await journal.read();
		const apply = entries.find((entry) => entry.command === 'workspace-deployment-apply');
		expect(apply?.result?.success).toBe(true);
		expect(apply?.actor).toBeUndefined();
		// The browser's path and a registry call with no principal: refused, whoever the adapter has signed in.
		expect((await parts.kernel.call('project-list')).error?.code).toBe('UNAUTHORIZED');
		expect((await parts.kernel.agent.call('project-list')).error?.code).toBe('UNAUTHORIZED');
		const direct = await parts.registries.palette.execute('project-list', {}, {
			principal: { actor: { kind: 'human', id: MOCK_PERSON }, person: MOCK_PERSON },
		} as never);
		expect(direct.error?.code).toBe('UNAUTHORIZED');
	});

	it('P3-E8: `createServerKernel` refuses a `local` deployment', async () => {
		await expect(
			createServerKernel({
				store: new MemoryAdapter(),
				storeKind: 'memory',
				journal: new MemoryJournalSink(),
				environment: createFixedEnvironment(),
				host: 'test',
				identity: { mode: 'local' },
				resource: RESOURCE,
				provider: {
					issuer: ISSUER,
					keys: providerKeys(async () => ({ keys: [] })),
					adapter,
					workspace: 'acme',
				},
			} as never)
		).rejects.toMatchObject({ code: 'IDENTITY_MODE_INVALID' });
	});

	it('P3-E8: two rows for one person and client, as two racing approvals would make, admit nothing', async () => {
		const olu = await connect((await token('olu@example.com')).access as string);
		expect((await olu.call('project-list')).success).toBe(true);
		const row = database
			.prepare('SELECT * FROM loam_connected_agent WHERE sponsor = ?')
			.get(people['olu@example.com'] as string) as Record<string, string | number | null>;
		const copy = { ...row, id: 'dup-row', agentId: 'agt_zzzzzzzzzzzzzzzzzzzz' };
		const columns = Object.keys(copy);
		database
			.prepare(
				`INSERT INTO loam_connected_agent (${columns.map((name) => `"${name}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
			)
			.run(...(Object.values(copy) as never[]));
		expect((await olu.call('project-list')).error?.code).toBe('AGENT_NOT_CONNECTED');
		database.prepare("DELETE FROM loam_connected_agent WHERE id = 'dup-row'").run();
		expect((await olu.call('project-list')).success).toBe(true);
		await olu.transport.disconnect();
	});

	it("P3-E8: `createServerKernel` refuses a provider whose binding names another workspace than the kernel's", async () => {
		await expect(
			createServerKernel({
				store: new MemoryAdapter(),
				storeKind: 'memory',
				journal: new MemoryJournalSink(),
				environment: createFixedEnvironment(),
				host: 'test',
				identity: {
					mode: 'provider',
					organization: 'acme',
					path: 'api/auth',
					methods: ['passkey'],
				},
				deployment: scopedDeployment(),
				resource: RESOURCE,
				provider: {
					issuer: ISSUER,
					keys: providerKeys(async () => ({ keys: [] })),
					adapter,
					workspace: 'acme',
				},
			} as never)
		).rejects.toMatchObject({ code: 'IDENTITY_BINDING_MISMATCH' });
	});

	it("P3-E8: a principal ends with its request: one a handler kept admits nothing after (the reviews' blocker)", async () => {
		const olu = await connect((await token('olu@example.com')).access as string);
		expect((await olu.call('test-principal-keep')).success).toBe(true);
		const principal = kept.at(-1);
		expect(principal).toBeTruthy();
		const later = await parts.registries.palette.execute('project-list', {}, {
			traceId: 'kept-1',
			principal,
		} as never);
		expect(later.error?.code).toBe('UNAUTHORIZED');
		await olu.transport.disconnect();
	});

	it("P3-E8: a person's page state is not served by the server kernel (the re-check's improvement 5)", async () => {
		const olu = await connect((await token('olu@example.com')).access as string);
		const names = await olu.names();
		for (const name of [
			'layout-set',
			'appearance-set',
			'palette-search',
			'view-state-get',
			'overlay-list',
		]) {
			expect(names, name).not.toContain(name);
		}
		expect(names).toContain('project-list');
		await olu.transport.disconnect();
	});

	it('P3-E8: a consent whose record could not be written is ended, so the consent page shows again', async () => {
		const fay = people['fay@example.com'] as string;
		database.exec(
			"CREATE TRIGGER refuse_connection BEFORE INSERT ON loam_connected_agent BEGIN SELECT RAISE(ABORT, 'refused'); END;"
		);
		try {
			const refused = await token('fay@example.com');
			expect(refused.access).toBeUndefined();
		} finally {
			database.exec('DROP TRIGGER refuse_connection');
		}
		expect(database.prepare('SELECT * FROM oauthConsent WHERE userId = ?').all(fay)).toEqual([]);
		// The next authorization asks again, and connects.
		expect((await token('fay@example.com')).access).toBeTypeOf('string');
		expect(
			(
				database.prepare('SELECT status FROM loam_connected_agent WHERE sponsor = ?').get(fay) as {
					status: string;
				}
			).status
		).toBe('active');
	});

	it("P3-E8: `createServerKernel`'s `mcp()`: every served command exposed, `credentialsGate` first", async () => {
		const store = new MemoryAdapter();
		const server = await createServerKernel({
			store,
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			environment: createFixedEnvironment(),
			host: 'test',
			identity: { mode: 'provider', organization: 'acme', path: 'api/auth', methods: ['passkey'] },
			deployment: scopedDeployment(),
			ports: scopedPorts(),
			resource: RESOURCE,
			provider: {
				issuer: ISSUER,
				keys: providerKeys(() => api().getJwks({})),
				adapter,
				workspace: 'personal',
			},
		});
		try {
			const mcp = server.mcp();
			expect(mcp.commands.length).toBeGreaterThan(0);
			for (const command of mcp.commands) expect(command.expose?.mcp, command.name).toBe(true);
			const first = mcp.middleware[0];
			const answer = await first?.(
				'project-list',
				{},
				{} as never,
				async () => ({ success: true }) as CommandResult
			);
			expect(answer?.error?.code).toBe('UNAUTHORIZED');
			expect(mcp.auth.resource).toBe(RESOURCE);
		} finally {
			await server.parts.kernel.dispose();
		}
	});

	it('P3-E8: the connected-agent table holds no token or secret', () => {
		const columns = (
			database.prepare(`PRAGMA table_info(loam_connected_agent)`).all() as { name: string }[]
		).map((column) => column.name);
		expect(columns.join(' ')).not.toMatch(/token|secret|password/i);
		expect(CONNECTED_AGENT_MODEL).toBe('loamConnectedAgent');
	});
});

// Last in the file, so it reads the journal and the store after every call of E8's session above.
describe("P3-E15: no secret of E8's session in the journal or the store", () => {
	it("P3-E8: after every call of the file, its refusals and the server kernel's own included, none read the adapter", () => {
		expect(sessionReads).toBe(0);
	});

	it('P3-E15: no cookie value, PKCE verifier, code, access or refresh token, or password in any journal entry, store row or MCP answer', async () => {
		const entries = await journal.read();
		expect(entries.length).toBeGreaterThan(10);
		expect(entries.some((entry) => entry.actor?.kind === 'agent')).toBe(true);
		// MemoryAdapter keeps its rows in a private map; read whole, since a row of any table could hold one.
		const tables = (store as unknown as { tables: Map<string, Map<string, unknown>> }).tables;
		expect([...tables.values()].reduce((sum, table) => sum + table.size, 0)).toBeGreaterThan(0);
		// The MCP answers the clients received, as well as what the kernel kept. No command's answer, its text content
		// included, holds `credentials` (tool listings are left out: a description may name the word).
		expect(envelopes.length).toBeGreaterThan(10);
		const answers = envelopes.filter(
			(envelope) => !(envelope as { result?: { tools?: unknown } }).result?.tools
		);
		expect(answers.length).toBeGreaterThan(10);
		expect(JSON.stringify(answers)).not.toContain('credentials');
		const held = JSON.stringify([
			envelopes,
			entries,
			[...tables].map(([name, table]) => [name, [...table.values()]]),
		]);
		const secrets = [...new Set(issued)].filter((value) => value.length >= 8);
		expect(secrets.length).toBeGreaterThan(10);
		// Every address the provider recorded for a session, and anything shaped like one.
		const addresses = (
			database.prepare('SELECT ipAddress FROM session WHERE ipAddress IS NOT NULL').all() as {
				ipAddress: string;
			}[]
		).map((row) => row.ipAddress);
		expect(addresses).toContain(ADDRESS);
		expect(addresses.filter((value) => value.length > 0 && held.includes(value))).toEqual([]);
		expect(held).not.toMatch(/ipAddress|127\.0\.0\.1|::ffff:/);
		expect(secrets.filter((value) => held.includes(value)).length).toBe(0);
		expect(held).not.toContain(PASSWORD);
		expect(held).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
	});
});
