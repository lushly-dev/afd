/**
 * The trust-record transport (phase 6 specification, 6.2; step 5), proved against the real host on the development
 * profile in this process, over TLS, with real sessions from the provider it mounts, never mocks: each of 6.2's refusals
 * before anything runs, the store unchanged; a person's routed write on the server kernel, journaled as the person, with
 * the snapshot's digest; and the provider's removal hook settling the removed sponsor's agent members once (A4, A8). The
 * hosted suite's P6-H5 repeats the shell's half in Chromium.
 */

import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { seedTestPeople, TEST_RATE_LIMIT } from '@lushly-dev/loam-identity/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { restrictAcls } from './acl.js';
import { runBootstrap, withBootstrapProvider } from './bootstrap.js';
import { type DevProfile, runDev } from './dev.js';
import { INERT_POLICY } from './headers.js';
import { createKernelCall, requestOf, sameOriginJson } from './kernel-call.js';
import { KERNEL_DATABASE, KERNEL_JOURNAL } from './mcp.js';
import { deploymentFile, fixtureDist, raw } from './test-support.js';
import { hostedMcpOf } from './testing-only.js';

const BASE = '/loam/';
const PASSWORD = 'correct horse battery staple';
const PROVIDER = `[workspace]\nid = "acme"\n\n[identity]\nmode = "provider"\norganization = "acme"\nmethods = ["passkey", "password"]\n\n[site]\nbase_path = "${BASE}"\n\n`;

let profile: DevProfile;
let suiteRoot: string;

const request = (
	path: string,
	options: { method?: string; headers?: Record<string, string>; body?: string } = {}
) => {
	const url = new URL(profile.origin);
	return raw(Number(url.port), path, {
		tls: true,
		host: url.host,
		method: options.method ?? 'POST',
		headers: {
			...options.headers,
			...(options.body !== undefined
				? { 'content-length': String(Buffer.byteLength(options.body)) }
				: {}),
		},
		...(options.body !== undefined ? { body: options.body } : {}),
	});
};

/** A session cookie for `email`, from a password sign-in at the provider. */
async function cookieFor(email: string): Promise<string> {
	const body = JSON.stringify({ email, password: PASSWORD });
	const answer = await request(`${BASE}api/auth/sign-in/email`, {
		headers: { origin: profile.origin, 'content-type': 'application/json' },
		body,
	});
	expect(answer.status).toBe(200);
	const set = [answer.headers['set-cookie'] ?? []].flat();
	return set.map((cookie) => cookie.split(';')[0]).join('; ');
}

const SHELL = () => ({ origin: profile.origin, 'content-type': 'application/json' });
/** Each cookie's person, whom the shell names in `Loam-Person` beside the body (step 5's trust review). */
const personOf = new Map<string, string>();
const kernelCall = (
	cookie: string | undefined,
	body: unknown,
	headers: Record<string, string> = SHELL()
) => {
	const person = cookie ? personOf.get(cookie) : undefined;
	return request(`${BASE}api/kernel/call`, {
		headers: {
			...headers,
			...(cookie ? { cookie } : {}),
			...(person ? { 'loam-person': person } : {}),
		},
		body: typeof body === 'string' ? body : JSON.stringify(body),
	});
};
const projectCount = () => {
	const database = new DatabaseSync(join(profile.data, KERNEL_DATABASE), { readOnly: true });
	try {
		return (
			database.prepare("SELECT COUNT(*) AS n FROM records WHERE tbl = 'project'").get() as {
				n: number;
			}
		).n;
	} finally {
		database.close();
	}
};

let owner: string;
let member: string;
let ids: Record<string, string>;
let organizationId: string;

beforeAll(async () => {
	suiteRoot = await realpath(await mkdtemp(join(tmpdir(), 'loam-host-call-')));
	if (process.platform === 'win32') restrictAcls([suiteRoot]);
	const deployment = await deploymentFile(suiteRoot, PROVIDER);
	const dist = await fixtureDist(suiteRoot);
	const report = await runBootstrap({
		form: 'dev',
		deployment,
		slug: 'acme',
		name: 'Acme',
		ownerEmail: 'first@acme.example',
	});
	organizationId = report.organization.id;
	await withBootstrapProvider({ form: 'dev', deployment }, async ({ provider }) => {
		ids = await seedTestPeople(provider.auth, report.organization.id, [
			{ email: 'olu@acme.example', name: 'Olu', role: 'owner', password: PASSWORD },
			{ email: 'bea@acme.example', name: 'Bea', role: 'member', password: PASSWORD },
		]);
	});
	profile = await runDev({ deployment, dist, rateLimit: TEST_RATE_LIMIT });
	owner = await cookieFor('olu@acme.example');
	member = await cookieFor('bea@acme.example');
	personOf.set(owner, ids['olu@acme.example'] as string);
	personOf.set(member, ids['bea@acme.example'] as string);
}, 120_000);
afterAll(async () => {
	await profile?.host.close();
	if (suiteRoot) await rm(suiteRoot, { recursive: true, force: true });
});

const CREATE = {
	command: 'project-create',
	input: { name: 'Delta' },
	scope: { workspace: 'acme' },
};

describe('6.2: the transport refuses before anything runs', () => {
	it.each([
		['GET', { method: 'GET' }, 403, 'REQUEST_NOT_SAME_ORIGIN'],
		[
			'text/plain',
			{ headers: { origin: 'ORIGIN', 'content-type': 'text/plain' } },
			403,
			'REQUEST_NOT_SAME_ORIGIN',
		],
		[
			'a foreign Origin',
			{ headers: { origin: 'https://evil.example', 'content-type': 'application/json' } },
			403,
			'REQUEST_NOT_SAME_ORIGIN',
		],
		[
			'no Origin',
			{ headers: { 'content-type': 'application/json' } },
			403,
			'REQUEST_NOT_SAME_ORIGIN',
		],
		[
			'Sec-Fetch-Site: cross-site',
			{
				headers: {
					origin: 'ORIGIN',
					'content-type': 'application/json',
					'sec-fetch-site': 'cross-site',
				},
			},
			403,
			'REQUEST_NOT_SAME_ORIGIN',
		],
	] as const)(
		'refuses %s 403 REQUEST_NOT_SAME_ORIGIN, the store unchanged',
		async (_label, options, status, code) => {
			const before = projectCount();
			const headers = Object.fromEntries(
				Object.entries((options as { headers?: Record<string, string> }).headers ?? SHELL()).map(
					([name, value]) => [name, value === 'ORIGIN' ? profile.origin : value]
				)
			);
			const answer = await request(`${BASE}api/kernel/call`, {
				method: (options as { method?: string }).method ?? 'POST',
				headers: { ...headers, cookie: owner },
				...((options as { method?: string }).method === 'GET'
					? {}
					: { body: JSON.stringify(CREATE) }),
			});
			expect(answer.status).toBe(status);
			expect(JSON.parse(answer.body)).toMatchObject({ code, suggestion: expect.any(String) });
			expect(answer.headers['access-control-allow-origin']).toBeUndefined();
			expect(answer.headers['cache-control']).toBe('no-store');
			expect(answer.headers['content-security-policy']).toBe(INERT_POLICY);
			expect(projectCount()).toBe(before);
		}
	);

	it('refuses an oversized body 413, a malformed one 400, no session 401, a foreign workspace 400, an unserved command 404', async () => {
		const before = projectCount();
		const big = await kernelCall(owner, { ...CREATE, input: { name: 'x'.repeat(2_000_000) } });
		expect([big.status, JSON.parse(big.body).code]).toEqual([413, 'REQUEST_TOO_LARGE']);
		const extra = await kernelCall(owner, { ...CREATE, actor: { kind: 'agent' } });
		expect([extra.status, JSON.parse(extra.body).code]).toEqual([400, 'REQUEST_INVALID']);
		const garbled = await kernelCall(owner, '{not json');
		expect(garbled.status).toBe(400);
		const none = await kernelCall(undefined, CREATE);
		expect([none.status, JSON.parse(none.body).code]).toEqual([401, 'UNAUTHORIZED']);
		const foreign = await kernelCall(owner, { ...CREATE, scope: { workspace: 'other' } });
		expect([foreign.status, JSON.parse(foreign.body).code]).toEqual([400, 'REQUEST_INVALID']);
		const unserved = await kernelCall(owner, { ...CREATE, command: 'member-invite' });
		expect([unserved.status, JSON.parse(unserved.body).code]).toEqual([
			404,
			'SERVER_COMMAND_NOT_SERVED',
		]);
		expect(projectCount()).toBe(before);
	});

	it('refuses a call naming no person 400, and one naming another than the session 409 SESSION_CHANGED', async () => {
		const before = projectCount();
		const unnamed = await request(`${BASE}api/kernel/call`, {
			headers: { ...SHELL(), cookie: owner },
			body: JSON.stringify(CREATE),
		});
		expect([unnamed.status, JSON.parse(unnamed.body).code]).toEqual([400, 'REQUEST_INVALID']);
		const other = await request(`${BASE}api/kernel/call`, {
			headers: { ...SHELL(), cookie: owner, 'loam-person': ids['bea@acme.example'] as string },
			body: JSON.stringify(CREATE),
		});
		expect([other.status, JSON.parse(other.body).code]).toEqual([409, 'SESSION_CHANGED']);
		expect(JSON.parse(other.body).suggestion).toBeTruthy();
		expect(projectCount()).toBe(before);
	});

	it('reads the rule and the shape as 6.2 has them', () => {
		const incoming = (headers: Record<string, string | string[]>, method = 'POST') =>
			({ method, headers, headersDistinct: undefined }) as never;
		expect(
			sameOriginJson(
				incoming({ origin: 'https://a', 'content-type': 'application/json; charset=utf-8' }),
				'https://a'
			)
		).toBe(true);
		expect(
			sameOriginJson(
				incoming({
					origin: 'https://a',
					'content-type': 'application/json',
					'sec-fetch-site': 'same-site',
				}),
				'https://a'
			)
		).toBe(false);
		expect(requestOf('{"command":"project-list","input":{},"scope":{"workspace":"w"}}')).toEqual({
			command: 'project-list',
			input: {},
			scope: { workspace: 'w' },
		});
		expect(requestOf('{"command":"x","scope":{"workspace":"w"}}')).toBeUndefined();
		expect(
			requestOf('{"command":"x","input":1,"scope":{"workspace":"w","extra":1}}')
		).toBeUndefined();
		expect(requestOf('[]')).toBeUndefined();
	});
});

describe('6.2: a routed call runs on the server kernel as the person', () => {
	it("lands an owner's project-create in loam.sqlite, journaled as them, answering the snapshot's digest", async () => {
		const before = projectCount();
		const answer = await kernelCall(owner, CREATE);
		expect(answer.status).toBe(200);
		const body = JSON.parse(answer.body) as {
			result: { success: boolean; metadata?: Record<string, unknown> };
			generation: string;
		};
		expect(body.result.success).toBe(true);
		expect(body.result.metadata?.['dev.loam/seq']).toBeUndefined();
		expect(body.generation).toMatch(/^sha256:/);
		expect(projectCount()).toBe(before + 1);
		const journal = hostedMcpOf(profile.host).kernel;
		expect(journal).toBeDefined();
		const { readFileSync } = await import('node:fs');
		const lines = readFileSync(join(profile.data, KERNEL_JOURNAL), 'utf8').trim().split('\n');
		const entry = lines
			.map((line) => JSON.parse(line) as { command: string; actor?: { kind: string; id: string } })
			.find((each) => each.command === 'project-create');
		expect(entry?.actor).toMatchObject({ kind: 'human', id: ids['olu@acme.example'] });
		// The snapshot answers the same digest the call did, for the same person.
		const snapshot = JSON.parse(
			(
				await kernelCall(owner, {
					command: 'trust-record-snapshot',
					input: {},
					scope: { workspace: 'acme' },
				})
			).body
		) as { result: { data: { generation: string } } };
		expect(snapshot.result.data.generation).toBe(body.generation);
	});

	it("answers a refusal 200 with the server's code: a member's workspace-app-set", async () => {
		const answer = await kernelCall(member, {
			command: 'workspace-app-set',
			input: { instance: 'hello', enabled: false },
			scope: { workspace: 'acme' },
		});
		expect(answer.status).toBe(200);
		expect(JSON.parse(answer.body).result.error.code).toBe('OWNER_REQUIRED');
	});
});

describe("A4 and A8: the provider's removal settles the removed sponsor's agent members on the server", () => {
	it("an owner's removal of a sponsor suspends their agent, journaled once as that owner", async () => {
		const added = await kernelCall(owner, {
			command: 'agent-member-add',
			input: {
				name: 'Helper',
				sponsor: ids['bea@acme.example'],
				access: { workspace: true, projects: [] },
			},
			scope: { workspace: 'acme' },
		});
		const agent = JSON.parse(added.body).result as { success: boolean; data: { id: string } };
		expect(agent.success, added.body).toBe(true);
		const removed = await request(`${BASE}api/auth/organization/remove-member`, {
			headers: { ...SHELL(), cookie: owner },
			body: JSON.stringify({ organizationId, memberIdOrEmail: 'bea@acme.example' }),
		});
		expect(removed.status, removed.body).toBe(200);
		const { readFileSync } = await import('node:fs');
		const settles = readFileSync(join(profile.data, KERNEL_JOURNAL), 'utf8')
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as { command: string; actor?: unknown; input?: unknown })
			.filter((each) => each.command === 'agent-member-settle');
		expect(settles).toHaveLength(1);
		// The remover, read from the role paths' hook, which has the request's session (A8).
		expect(settles[0]?.actor).toEqual({ kind: 'human', id: ids['olu@acme.example'] });
		expect(settles[0]?.input).toEqual({
			agents: [{ agent: agent.data.id, suspended: 'sponsor-left' }],
		});
		const database = new DatabaseSync(join(profile.data, KERNEL_DATABASE), { readOnly: true });
		try {
			const row = database
				.prepare("SELECT value FROM records WHERE tbl = 'agent-member' AND id = ?")
				.get(agent.data.id) as { value: string };
			expect(JSON.parse(row.value)).toMatchObject({
				status: 'suspended',
				suspended: 'sponsor-left',
			});
		} finally {
			database.close();
		}
	});
});

describe('6.2 row 3 over stubs: what the session read answers', () => {
	const stubbed = (getSession: () => Promise<unknown>) => {
		const sent: { status?: number; body?: string } = {};
		const outgoing = {
			headersSent: false,
			writeHead(status: number) {
				sent.status = status;
			},
			end(body: string) {
				sent.body = body;
			},
		};
		const call = createKernelCall({
			origin: 'https://loam.example',
			maxBodyBytes: 10_000,
			kernel: { parts: {} } as never,
			provider: { workspace: 'acme', auth: { api: { getSession } } } as never,
		});
		const body = Buffer.from(JSON.stringify(CREATE));
		const incoming = Object.assign([body], {
			method: 'POST',
			headers: {
				origin: 'https://loam.example',
				'content-type': 'application/json',
				'content-length': String(body.length),
				'loam-person': 'agt_aaaaaaaaaaaaaaaaaaaa',
			},
		});
		return { run: () => call(incoming as never, outgoing as never), sent };
	};

	it('answers an agent member’s session 401 AGENT_CANNOT_SIGN_IN', async () => {
		const { run, sent } = stubbed(async () => ({ user: { id: 'agt_aaaaaaaaaaaaaaaaaaaa' } }));
		await run();
		expect([sent.status, JSON.parse(sent.body as string).code]).toEqual([
			401,
			'AGENT_CANNOT_SIGN_IN',
		]);
	});

	it('answers a session read that failed 503 SERVER_UNAVAILABLE, never a sign-in prompt', async () => {
		const { run, sent } = stubbed(async () => {
			throw new Error('database is locked');
		});
		await run();
		expect([sent.status, JSON.parse(sent.body as string).code]).toEqual([
			503,
			'SERVER_UNAVAILABLE',
		]);
	});
});
