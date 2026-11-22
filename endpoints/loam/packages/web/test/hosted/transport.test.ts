/**
 * P6-H5, P6-H8 and P6-E9's hosted row (phase 6 specification, sections 6 and 19; step 5): the
 * trust-record transport on the development profile at `/loam/`, with the built shell in Chromium. A signed-in owner's
 * writes from the shell land in `loam.sqlite`; a second person's tab sees them after its refresh; both journals hold
 * `trust-record-settle`; with the server stopped a write is `SERVER_UNAVAILABLE` and the copy unchanged; each of 6.2's
 * refusals runs nothing; `/organization/leave` is 404 and `member-leave` runs the server's `agent-member-settle` once;
 * a crash mid-burst restarts at once with every journaled project in the store; and `scanSecrets` finds nothing.
 * P6-H7, on one host with its MCP token and relay calls too, is `relay.test.ts`'s.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FileJournalSink } from '@lushly-dev/afd-core/journal-file';
import { type DevHost, scanSecrets, startDevHost } from '@lushly-dev/loam-host/testing';
import { TEST_RATE_LIMIT } from '@lushly-dev/loam-identity/testing';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	deploymentEntry,
	hostedProviderDeployment,
	journal,
	kernelCall,
	launchForDevHost,
	openShell,
	packApp,
	type ShellPage,
} from '../browser/harness';
import { hosted } from './support';

const BASE = '/loam/';
const PASSWORD = 'correct horse battery staple';

let host: DevHost;
let browser: Browser;
const opened: ShellPage[] = [];
/** Every request a page made, by page, for P6-E9's chunk row. */
const requested = new Map<ShellPage, string[]>();

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
		rateLimit: TEST_RATE_LIMIT,
	});
	browser = await launchForDevHost(host);
}, 120_000);
afterAll(async () => {
	await Promise.all(opened.splice(0).map((page) => page.context.close()));
	await browser?.close();
	await host?.close();
});

/** Every cookie value any page held, read as each signs in: a session that later ends is scanned for too (P6-H5). */
const seenSecrets = new Set<string>();

/** A shell signed in as `email`, its requests recorded from before the first byte. */
async function signedIn(email: string): Promise<ShellPage> {
	const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	const urls: string[] = [];
	context.on('request', (request) => urls.push(request.url()));
	const page = await openShell(browser, host.root, {}, context);
	requested.set(page, urls);
	opened.push(page);
	const answer = (await kernelCall(page.page, 'auth-sign-in', {
		method: 'credentials',
		email,
		password: PASSWORD,
	})) as { success: boolean; error?: unknown };
	expect(answer.success, JSON.stringify(answer.error)).toBe(true);
	for (const cookie of await page.context.cookies(host.origin))
		if (cookie.value.length >= 16) seenSecrets.add(cookie.value);
	return page;
}

const call = async <T = unknown>(page: ShellPage, name: string, input: unknown = {}) =>
	(await kernelCall(page.page, name, input)) as {
		success: boolean;
		data?: T;
		error?: { code: string; suggestion?: string };
	};

const cookieOf = async (page: ShellPage) =>
	(await page.context.cookies(host.origin)).map(({ name, value }) => `${name}=${value}`).join('; ');

/** The rows of one table of the server's store. */
const rows = <T>(table: string): T[] =>
	(
		host.db().loam.prepare('SELECT value FROM records WHERE tbl = ?').all(table) as Array<{
			value: string;
		}>
	).map((row) => JSON.parse(row.value) as T);

/** The server's journal, its last partial line dropped as a reader drops it (P6-H8). */
function serverJournal(): Array<{
	command: string;
	actor?: unknown;
	input?: unknown;
	result?: { success?: boolean; data?: unknown };
}> {
	const lines = readFileSync(join(host.data, 'journal.jsonl'), 'utf8').split('\n');
	return lines.flatMap((line, index) => {
		if (!line.trim()) return [];
		try {
			return [JSON.parse(line)];
		} catch (cause) {
			// Only the last line may be torn, by a crash mid-append; any other is a journal that lost an entry.
			if (lines.slice(index + 1).some((rest) => rest.trim())) throw cause;
			return [];
		}
	});
}

const projectNames = async (page: ShellPage) =>
	(
		(await call<{ projects: Array<{ name: string }> }>(page, 'project-list', { status: 'all' }))
			.data?.projects ?? []
	).map((project) => project.name);

let owner: ShellPage;
let ownerId: string;

describe('P6-H5: the trust-record transport', () => {
	it('P6-E9: a hosted provider shell requests late-hosted once, in stage B', async () => {
		owner = await signedIn('olu@acme.example');
		const account = await call<{ id: string }>(owner, 'account-get');
		ownerId = account.data?.id as string;
		const chunks = (requested.get(owner) ?? []).filter((url) =>
			/\/late-hosted-[^/]+\.js$/.test(url)
		);
		expect(chunks).toHaveLength(1);
	});

	it("an owner's project-create, workspace-app-set and agent-member-add each land in loam.sqlite", async () => {
		const created = await call<{ id: string }>(owner, 'project-create', { name: 'Delta' });
		expect(created.success, JSON.stringify(created.error)).toBe(true);
		expect(rows<{ name: string }>('project').map((row) => row.name)).toContain('Delta');
		const set = await call(owner, 'workspace-app-set', { instance: 'hello', title: 'Hi there' });
		expect(set.success, JSON.stringify(set.error)).toBe(true);
		expect(
			rows<{ id: string; overrides?: { title?: string } }>('workspace-app').find(
				(row) => row.id === 'hello'
			)?.overrides?.title
		).toBe('Hi there');
		const added = await call(owner, 'agent-member-add', {
			name: 'Reviewer',
			sponsor: ownerId,
			access: { workspace: true, projects: [] },
		});
		expect(added.success, JSON.stringify(added.error)).toBe(true);
		expect(rows<{ name: string }>('agent-member').map((row) => row.name)).toContain('Reviewer');
		// The copy follows: the shell's own project list holds Delta, from the settle after the call.
		await expect.poll(() => projectNames(owner)).toContain('Delta');
	});

	it("a second person's tab sees the project after its refresh, and both journals hold trust-record-settle", async () => {
		const bea = await signedIn('bea@acme.example');
		await expect.poll(() => projectNames(bea)).toContain('Delta');
		expect((await call(owner, 'project-create', { name: 'Echo' })).success).toBe(true);
		expect(await projectNames(bea)).not.toContain('Echo');
		// Phase 3's 4.3 refresh: `online` reads the session again, and the copy with it.
		await bea.page.evaluate(() => window.dispatchEvent(new Event('online')));
		await expect.poll(() => projectNames(bea), { timeout: 10_000 }).toContain('Echo');
		for (const page of [owner, bea]) {
			const settles = (await journal(page.page)).filter(
				(entry) => entry.command === 'trust-record-settle'
			);
			expect(settles.length).toBeGreaterThanOrEqual(1);
			expect(settles[0]?.input).toMatchObject({ reason: 'boot' });
		}
		// The agent interface's writes are a person's (A6): refused before any request reaches the server.
		const before = rows('project').length;
		const agent = await bea.page.evaluate(async () => {
			const shell = document.querySelector('loam-shell') as unknown as {
				kernel: {
					agent: { call(name: string, input: unknown): Promise<{ error?: { code: string } }> };
				};
			};
			return shell.kernel.agent.call('project-create', { name: 'Fox' });
		});
		expect(agent.error?.code).toBe('HUMAN_REQUIRED');
		expect(rows('project').length).toBe(before);
	});

	it("refuses each of 6.2's cases before anything runs, the store unchanged", async () => {
		const cookie = await cookieOf(owner);
		const before = rows('project').length;
		const body = JSON.stringify({
			command: 'project-create',
			input: { name: 'X' },
			scope: { workspace: 'acme' },
		});
		const json = { 'content-type': 'application/json' };
		const cases: Array<[string, Parameters<typeof hosted>[2], number, string]> = [
			[
				'GET',
				{ method: 'GET', headers: { origin: host.origin, cookie } },
				403,
				'REQUEST_NOT_SAME_ORIGIN',
			],
			[
				'text/plain',
				{
					method: 'POST',
					body,
					headers: {
						origin: host.origin,
						cookie,
						'loam-person': ownerId,
						'content-type': 'text/plain',
					},
				},
				403,
				'REQUEST_NOT_SAME_ORIGIN',
			],
			[
				'a foreign Origin',
				{
					method: 'POST',
					body,
					headers: { origin: 'https://evil.example', cookie, 'loam-person': ownerId, ...json },
				},
				403,
				'REQUEST_NOT_SAME_ORIGIN',
			],
			[
				'cross-site',
				{
					method: 'POST',
					body,
					headers: {
						origin: host.origin,
						cookie,
						'loam-person': ownerId,
						'sec-fetch-site': 'cross-site',
						...json,
					},
				},
				403,
				'REQUEST_NOT_SAME_ORIGIN',
			],
			[
				'an oversized body',
				{
					method: 'POST',
					body: JSON.stringify({
						command: 'project-create',
						input: { name: 'x'.repeat(2_000_000) },
						scope: { workspace: 'acme' },
					}),
					headers: { origin: host.origin, cookie, 'loam-person': ownerId, ...json },
				},
				413,
				'REQUEST_TOO_LARGE',
			],
			[
				'no session',
				{ method: 'POST', body, headers: { origin: host.origin, ...json } },
				401,
				'UNAUTHORIZED',
			],
			[
				'another workspace',
				{
					method: 'POST',
					body: body.replace('"acme"', '"other"'),
					headers: { origin: host.origin, cookie, 'loam-person': ownerId, ...json },
				},
				400,
				'REQUEST_INVALID',
			],
			[
				'an unserved command',
				{
					method: 'POST',
					body: body.replace('project-create', 'member-invite'),
					headers: { origin: host.origin, cookie, 'loam-person': ownerId, ...json },
				},
				404,
				'SERVER_COMMAND_NOT_SERVED',
			],
		];
		for (const [label, options, status, code] of cases) {
			const answer = await hosted(host, `${BASE}api/kernel/call`, options);
			expect(answer.status, label).toBe(status);
			expect(JSON.parse(answer.body).code, label).toBe(code);
		}
		expect(rows('project').length).toBe(before);
	});

	it("/organization/leave is 404, and member-leave runs the server's agent-member-settle exactly once", async () => {
		const bea = opened.find((page) => page !== owner) as ShellPage;
		const beaId = (await call<{ id: string }>(bea, 'account-get')).data?.id as string;
		const sponsored = await call<{ id: string }>(owner, 'agent-member-add', {
			name: 'Bea’s helper',
			sponsor: beaId,
			access: { workspace: true, projects: [] },
		});
		expect(sponsored.success, JSON.stringify(sponsored.error)).toBe(true);
		const cookie = await cookieOf(bea);
		const leave = await hosted(host, `${BASE}api/auth/organization/leave`, {
			method: 'POST',
			body: '{}',
			headers: { origin: host.origin, cookie, 'content-type': 'application/json' },
		});
		expect(leave.status).toBe(404);
		const settlesBefore = serverJournal().filter(
			(entry) => entry.command === 'agent-member-settle'
		).length;
		const left = await call(bea, 'member-leave');
		expect(left.success, JSON.stringify(left.error)).toBe(true);
		const settles = serverJournal().filter((entry) => entry.command === 'agent-member-settle');
		expect(settles.length - settlesBefore).toBe(1);
		expect(settles.at(-1)?.actor).toMatchObject({ kind: 'human', id: beaId });
		// Their sessions went with it (revoke-person's part of removal's path).
		const who = await hosted(host, `${BASE}api/auth/loam/whoami`, {
			headers: { origin: host.origin, cookie },
		});
		expect(JSON.parse(who.body)).toBeNull();
	});

	it('with the server stopped, project-create is SERVER_UNAVAILABLE and the copy is unchanged', async () => {
		const names = await projectNames(owner);
		await host.kill();
		const refused = await call(owner, 'project-create', { name: 'Ghost' });
		expect(refused.error?.code).toBe('SERVER_UNAVAILABLE');
		expect(refused.error?.suggestion).toBeTruthy();
		expect(await projectNames(owner)).toEqual(names);
		const entries = await journal(owner.page);
		expect(entries.findLast((entry) => entry.command === 'project-create')?.error?.code).toBe(
			'SERVER_UNAVAILABLE'
		);
		await host.restart();
	});

	it('P6-H5: scanSecrets finds no cookie value or session id in the served files, either journal, the logs or any store row', async () => {
		// After every case of the scenario, the stopped server's refusal in the browser's journal included.
		const cookies = (
			await Promise.all(opened.map((page) => page.context.cookies(host.origin)))
		).flat();
		// Every cookie value as it went over the wire and decoded: each page's at its sign-in (a session that ended
		// since included) and each page's now.
		const known = [
			...new Set(
				[...seenSecrets, ...cookies.map((cookie) => cookie.value)]
					.flatMap((value) => [value, decodeURIComponent(value)])
					.filter((value) => value.length >= 16)
			),
		];
		expect(known.length).toBeGreaterThan(0);
		const scan = await scanSecrets(
			host,
			opened.map((page) => page.page),
			known
		);
		expect(scan.found).toEqual([]);
	});
});

describe('P6-H8: a crash', () => {
	it('restarts at once after SIGKILL mid-burst, every journaled project in the store, at most the in-flight beyond', async () => {
		const cookie = await cookieOf(owner);
		const path = join(host.data, 'journal.jsonl');
		const create = (name: string) =>
			hosted(host, `${BASE}api/kernel/call`, {
				method: 'POST',
				body: JSON.stringify({
					command: 'project-create',
					input: { name },
					scope: { workspace: 'acme' },
				}),
				headers: {
					origin: host.origin,
					cookie,
					'loam-person': ownerId,
					'content-type': 'application/json',
				},
			});
		// The store's projects before the burst, so what the burst added is told by id.
		const baseline = new Set(rows<{ id: string }>('project').map((row) => row.id));
		// A burst of at most `concurrency` requests in flight at once, each worker sending its next as its last is
		// answered, until the kill is about to come. Each request records how it ended: answered, failed before the
		// signal was sent, or cut by it.
		const concurrency = 4;
		const burst = 400;
		const sent: Array<{ name: string; state: 'pending' | 'answered' | 'failed' | 'cut' }> = [];
		let stopping = false;
		let signalled = false;
		let created = 0;
		const worker = async () => {
			while (!stopping && sent.length < burst) {
				const request = {
					name: `Burst ${sent.length}`,
					state: 'pending' as (typeof sent)[number]['state'],
				};
				sent.push(request);
				try {
					const answer = await create(request.name);
					request.state = 'answered';
					// Only a create that succeeded counts toward the burst being under way: a 200 whose result succeeded.
					const ran = (() => {
						try {
							return (JSON.parse(answer.body) as { result?: { success?: boolean } }).result
								?.success;
						} catch {
							return false;
						}
					})();
					if (answer.status === 200 && ran === true) created += 1;
				} catch {
					request.state = signalled ? 'cut' : 'failed';
				}
			}
		};
		const workers = Array.from({ length: concurrency }, worker);
		await expect
			.poll(() => created, {
				timeout: 10_000,
				interval: 5,
			})
			.toBeGreaterThan(4);
		// No request is sent after this, and at least one is outstanding as the signal goes.
		stopping = true;
		const outstanding = sent.filter((request) => request.state === 'pending').length;
		expect(outstanding).toBeGreaterThan(0);
		signalled = true;
		await host.kill();
		await Promise.all(workers);
		expect(sent.filter((request) => request.state === 'failed').map(({ name }) => name)).toEqual(
			[]
		);
		const cut = sent.filter((request) => request.state === 'cut').map(({ name }) => name);
		expect(cut.length).toBeLessThanOrEqual(outstanding);
		// The journal's last line is a partial one, as a kill mid-append leaves it: torn here if the kill left none.
		const TORN = '{"seq":';
		const killed = readFileSync(path, 'utf8');
		const tail = killed.slice(killed.lastIndexOf('\n') + 1);
		const whole = (() => {
			try {
				return tail !== '' && JSON.parse(tail) !== undefined;
			} catch {
				return false;
			}
		})();
		// A complete entry the kill left without its newline is kept by the reader, so the torn line goes after it.
		if (tail === '') appendFileSync(path, TORN);
		else if (whole) appendFileSync(path, `\n${TORN}`);
		expect(readFileSync(path, 'utf8').endsWith('\n')).toBe(false);
		// AFD's own reader, the server's journal sink, reads it with that line dropped.
		const before = await new FileJournalSink(path).read();
		const complete = readFileSync(path, 'utf8').split('\n').slice(0, -1);
		expect(before.map((entry) => entry.seq)).toEqual(
			complete.map((line) => (JSON.parse(line) as { seq: number }).seq)
		);
		const started = Date.now();
		await host.restart();
		expect(Date.now() - started).toBeLessThan(15_000);
		// Every project-create the journal holds as a success is in the store: the scenario's earlier ones too.
		const creates = before.filter(
			(entry) => entry.command === 'project-create' && entry.result?.success
		);
		const ids = creates.flatMap(
			(entry) => (entry.result?.data as { id?: string } | undefined)?.id ?? []
		);
		expect(ids.length).toBe(creates.length);
		expect(ids.length).toBeGreaterThan(0);
		const stored = rows<{ id: string; name: string }>('project');
		for (const id of ids)
			expect(
				stored.some((row) => row.id === id),
				id
			).toBe(true);
		// Beyond the journal, the store holds only projects of requests the kill cut, one each, whose creates the journal
		// lost: every id the burst added that the journal does not hold is a distinct cut request's.
		const journaledIds = new Set(ids);
		const journaledNames = new Set(
			creates.map((entry) => String((entry.input as { name?: string } | undefined)?.name))
		);
		expect([...journaledNames].some((name) => name.startsWith('Burst '))).toBe(true);
		const excess = stored
			.filter((row) => !baseline.has(row.id) && !journaledIds.has(row.id))
			.map((row) => row.name);
		expect(new Set(excess).size).toBe(excess.length);
		for (const name of excess) {
			expect(cut, name).toContain(name);
			expect(journaledNames.has(name), name).toBe(false);
		}
		expect(excess.length).toBeLessThanOrEqual(cut.length);
		// The restarted server's journal drops the torn line on its first append and continues after the last whole entry:
		// every line of the file is whole, and the entries before the crash are unchanged.
		const after = await create('After the crash');
		expect(after.status, after.body).toBe(200);
		const lines = readFileSync(path, 'utf8').split('\n');
		expect(lines.at(-1)).toBe('');
		const entries = lines.slice(0, -1).map((line) => JSON.parse(line) as { seq: number });
		expect(entries.slice(0, before.length)).toEqual(
			before.map((entry) => JSON.parse(JSON.stringify(entry)))
		);
		const seqs = entries.map((entry) => entry.seq);
		expect(seqs).toEqual(seqs.map((_, index) => (seqs[0] as number) + index));
		expect(
			(await new FileJournalSink(path).read()).findLast(
				(entry) => entry.command === 'project-create'
			)?.input
		).toEqual({ name: 'After the crash' });
	});
});
