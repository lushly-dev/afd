/**
 * P2-E6: the scope reaches a mounted instance, through a test-only relay (phase 2 specification, 9.2; D55,
 * D65). A stock `umbel`, built from `endpoints/umbel` and not changed, and a fixture AFD server that
 * declares `dev.loam/scope` (`scope-server.ts`), each behind the relay, whose log shows what each request
 * asked and carried.
 *
 * Proved: a command's call carries its effective scope's ids in `_meta`, through a first-class tool and
 * through `afd-call`, and discovery carries none; a server that declares the field reads it, and a stock
 * `umbel`, which does not, answers the same with it; a project's mapped space is pinned and another refused;
 * a project outside the instance's `projects`, the workspace level and a non-member's restricted project are
 * each refused with no request; and the journal keeps the call's scope. Not proved: a hosted server, its
 * auth, membership or limits, or more than one person (D64; phase 2 specification, 3.3 and 9.1).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StreamableHttpTransport } from '@lushly-dev/afd-client/streamable-http';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	type DeploymentSite,
	deploymentFile,
	journal,
	kernelCall,
	openShell,
	type ShellPage,
	serveDeployment,
	settle,
} from '../browser/harness';
import type { RelayedCall, RelayedRequest } from './mount-relay';
import { type ScopeServer, startScopeServer } from './scope-server';
import { packUmbel, untilInstance } from './support';
import { createUmbelWorkspace, startUmbel, type UmbelInstance } from './umbel-fixture';

const WORKSPACE = 'personal';
const PERSON = 'mock-user-person@example.com';

let browser: Browser;
let directory: string;
let umbel: UmbelInstance;
let fixture: ScopeServer;
let site: DeploymentSite;
let shell: ShellPage;
const ids: { atlas: string; beacon: string; vault: string } = { atlas: '', beacon: '', vault: '' };

/** A deployment table, with `projects` and `space` written as TOML's own array and table. */
function entry(instance: string, packageDirectory: string, lines: string[]): string {
	return [
		`[apps.${instance}]`,
		'app = "umbel"',
		`package = ${JSON.stringify(packageDirectory)}`,
		'transport = "http"',
		`prefix = ${JSON.stringify(instance)}`,
		...lines,
	].join('\n');
}

beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'loam-mounted-scope-'));
	const workspace = join(directory, 'work');
	await createUmbelWorkspace(workspace);
	umbel = await startUmbel(workspace);
	fixture = await startScopeServer();
	const umbelPackage = await packUmbel();
	site = await serveDeployment({
		mounts: true,
		config: deploymentFile(
			entry('work', umbelPackage, [
				`url = ${JSON.stringify(umbel.url)}`,
				`bearer_file = ${JSON.stringify(umbel.tokenFile)}`,
				'audience = "team"',
				'projects = ["atlas", "vault"]',
				'space = { atlas = "main" }',
			]),
			entry('probe', umbelPackage, [`url = ${JSON.stringify(fixture.url)}`, 'audience = "person"'])
		),
	});
	browser = await chromium.launch();
	shell = await openShell(browser, site.origin);
	const { page } = shell;
	await untilInstance(page, 'work', 'ready');
	await untilInstance(page, 'probe', 'ready');
	const create = async (input: Record<string, unknown>) =>
		((await kernelCall(page, 'project-create', input)) as { data: { id: string } }).data.id;
	ids.atlas = await create({ name: 'Atlas' });
	ids.beacon = await create({ name: 'Beacon' });
	// Vault is restricted to the person, who signs out, so the page's actor is no member of it.
	await kernelCall(page, 'auth-sign-in', {
		method: 'credentials',
		email: 'person@example.com',
		password: 'x',
	});
	ids.vault = await create({ name: 'Vault', access: { mode: 'restricted', members: [PERSON] } });
	await kernelCall(page, 'auth-sign-out');
}, 180_000);

afterAll(async () => {
	await shell?.context.close();
	await browser?.close();
	await site?.close();
	await fixture?.close();
	await umbel?.stop();
	await rm(directory, { recursive: true, force: true });
});

interface Answer {
	success: boolean;
	data?: Record<string, unknown>;
	error?: { code?: string; message?: string; suggestion?: string };
}

/** A call in `project`, or at workspace level, on the person's interface or the agent's. */
function callIn(
	page: Page,
	name: string,
	input: unknown,
	project: string | undefined,
	agent = false
): Promise<Answer> {
	return page.evaluate(
		async ({ name, input, scope, agent }) => {
			const { kernel } = document.querySelector('loam-shell') as unknown as {
				kernel: {
					call(name: string, input: unknown, options: unknown): Promise<unknown>;
					agent: { call(name: string, input: unknown, options: unknown): Promise<unknown> };
				};
			};
			return (agent ? kernel.agent : kernel).call(name, input, { scope }) as Promise<never>;
		},
		{
			name,
			input,
			scope: project === undefined ? { workspace: WORKSPACE } : { workspace: WORKSPACE, project },
			agent,
		}
	);
}

/** What the relay sent on to `instance` from log position `from`. */
const relayed = (instance: string, from: number): RelayedRequest[] =>
	(site.relay as NonNullable<DeploymentSite['relay']>).log
		.slice(from)
		.filter((request) => request.instance === instance);

const logLength = () => (site.relay as NonNullable<DeploymentSite['relay']>).log.length;

/**
 * The `_meta` a request carried, once the relay read its body, without the MCP SDK's own protocol keys
 * (`io.modelcontextprotocol/*`, which the 2026-07-28 era sends on every request): what Loam added.
 */
function metaOf(call: RelayedCall | undefined): Record<string, unknown> | undefined {
	const kept = Object.entries(call?.meta ?? {}).filter(
		([key]) => !key.startsWith('io.modelcontextprotocol/')
	);
	return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}

describe('P2-E6: scope reaches a mounted instance, through a test-only relay', () => {
	it("pins Atlas's space on a real umbel, which answers with it, and journals the call's scope", async () => {
		const { page } = shell;
		const from = logLength();
		const answered = await callIn(page, 'work-hello-greet', { name: 'Ada' }, ids.atlas);
		expect(answered.success).toBe(true);
		expect(answered.data).toMatchObject({ greeting: 'Hello, Ada!', space: 'main' });
		const calls = relayed('work', from).filter(({ rpc }) => rpc?.method === 'tools/call');
		expect(calls).toHaveLength(1);
		// What the relay sent on: the key, which a stock `umbel` declares no field for (the last case here
		// shows it answers the same with it as without it).
		expect(metaOf(calls[0]?.rpc)).toEqual({
			'dev.loam/scope': { workspace: WORKSPACE, project: ids.atlas },
		});
		await settle(page);
		const entry = (await journal(page)).findLast(({ command }) => command === 'work-hello-greet');
		expect(entry?.context).toMatchObject({
			scope: { workspace: WORKSPACE, project: ids.atlas },
			instance: 'work',
			replay: 'recorded',
		});
	});

	it('refuses another space as MOUNT_SPACE_PINNED, and it never reaches umbel', async () => {
		const from = logLength();
		const refused = await callIn(shell.page, 'work-hello-greet', { space: 'other' }, ids.atlas);
		expect(refused.error?.code).toBe('MOUNT_SPACE_PINNED');
		expect(relayed('work', from)).toEqual([]);
	});

	it('refuses a project outside `projects`, and the workspace level, with no request', async () => {
		const { page } = shell;
		const from = logLength();
		const beacon = await callIn(page, 'work-hello-greet', {}, ids.beacon);
		expect(beacon.error).toMatchObject({
			code: 'MOUNT_PROJECT_NOT_LISTED',
			// Vault is listed too, and restricted to a person this page's actor is not: it is not named (B2).
			suggestion: 'Switch to a project this instance serves: atlas',
		});
		const agent = await callIn(page, 'work-workspace-show', {}, ids.beacon, true);
		expect(agent.error?.code).toBe('MOUNT_PROJECT_NOT_LISTED');
		// Deviation 1 (the spec's Status block): 3.4's line 3 runs before the instance's own check, so a
		// project-only instance at workspace level is SCOPE_PROJECT_REQUIRED, journaled, with no request.
		const workspace = await callIn(page, 'work-hello-greet', { name: 'nowhere' }, undefined);
		expect(workspace.error?.code).toBe('SCOPE_PROJECT_REQUIRED');
		expect(relayed('work', from)).toEqual([]);
		await settle(page);
		const entry = (await journal(page)).find(
			({ command, error }) =>
				command === 'work-hello-greet' && error?.code === 'MOUNT_PROJECT_NOT_LISTED'
		);
		expect(entry?.context).toMatchObject({
			scope: { workspace: WORKSPACE, project: ids.beacon },
			instance: 'work',
			replay: 'recorded',
		});
		const required = (await journal(page)).findLast(
			({ command, error }) =>
				command === 'work-hello-greet' && error?.code === 'SCOPE_PROJECT_REQUIRED'
		);
		expect(required).toMatchObject({
			input: { name: 'nowhere' },
			success: false,
			context: { scope: { workspace: WORKSPACE }, instance: 'work', replay: 'recorded' },
		});
		expect(required?.context?.scope).toEqual({ workspace: WORKSPACE });
	});

	it('refuses a non-member in a restricted project it lists as PROJECT_NOT_FOUND, with no request', async () => {
		const from = logLength();
		const refused = await callIn(shell.page, 'work-hello-greet', {}, ids.vault);
		expect(refused.error).toMatchObject({
			code: 'PROJECT_NOT_FOUND',
			message: 'No project with that name is available to you',
		});
		expect(relayed('work', from)).toEqual([]);
	});

	it('gives a server that declares the field the scope, through a first-class tool and afd-call', async () => {
		const { page } = shell;
		const from = logLength();
		const seenFrom = fixture.seen.length;
		const atlas = { workspace: WORKSPACE, project: ids.atlas };
		const first = await callIn(page, 'probe-scope-echo', {}, ids.atlas);
		expect(first.data).toEqual({ scope: atlas, space: null });
		const lazy = await callIn(page, 'probe-scope-whisper', {}, ids.atlas, true);
		expect(lazy.data).toEqual({ scope: atlas, space: null });
		const workspace = await callIn(page, 'probe-scope-echo', {}, undefined);
		expect(workspace.data).toEqual({ scope: { workspace: WORKSPACE }, space: null });
		expect(fixture.seen.slice(seenFrom)).toEqual([
			{ tool: 'scope-echo', scope: atlas },
			{ tool: 'scope-whisper', scope: atlas },
			{ tool: 'scope-echo', scope: { workspace: WORKSPACE } },
		]);
		expect(
			relayed('probe', from)
				.filter(({ rpc }) => rpc?.method === 'tools/call')
				.map(({ rpc }) => [rpc?.name, metaOf(rpc)])
		).toEqual([
			['scope-echo', { 'dev.loam/scope': atlas }],
			['afd-call', { 'dev.loam/scope': atlas }],
			['scope-echo', { 'dev.loam/scope': { workspace: WORKSPACE } }],
		]);
	});

	it('carries nothing on discovery, whose catalog is one set for every scope', async () => {
		const { page } = shell;
		const commandsIn = async (project: string | undefined) =>
			((await callIn(page, 'app-command-list', { instance: 'probe' }, project)) as Answer).data;
		const before = await commandsIn(undefined);
		const from = logLength();
		await callIn(page, 'app-instance-refresh', { instance: 'probe' }, ids.atlas);
		expect(await commandsIn(ids.atlas)).toEqual(before);
		const discovery = (site.relay as NonNullable<DeploymentSite['relay']>).log.filter(
			({ rpc }) => rpc?.name === 'afd-help' || rpc?.name === 'afd-detail'
		);
		expect(relayed('probe', from).some(({ rpc }) => rpc?.name === 'afd-help')).toBe(true);
		expect(new Set(discovery.map(({ instance }) => instance))).toEqual(new Set(['work', 'probe']));
		expect(discovery.filter(({ rpc }) => metaOf(rpc) !== undefined)).toEqual([]);
		// Discovery reads `afd-help`, never `tools/list` (phase 1 specification, 9.9).
		expect(
			(site.relay as NonNullable<DeploymentSite['relay']>).log.filter(
				({ rpc }) => rpc?.method === 'tools/list'
			)
		).toEqual([]);
		expect(shell.violations).toEqual([]);
	});

	it('carries the scope on a command call alone: no other request of either instance has it', async () => {
		const log = (site.relay as NonNullable<DeploymentSite['relay']>).log;
		const commandCall = (request: RelayedRequest) =>
			request.rpc?.method === 'tools/call' &&
			request.rpc.name !== 'afd-help' &&
			request.rpc.name !== 'afd-detail';
		// Every other request, `initialize` or `server/discover`, notifications, discovery and any batch,
		// whose requests are read one by one.
		const others = log.filter((request) => !commandCall(request));
		const calls = others.flatMap(({ instance, rpc }) =>
			(rpc?.batch ?? (rpc ? [rpc] : [])).map((call) => ({ instance, call }))
		);
		expect(calls.filter(({ call }) => metaOf(call) !== undefined)).toEqual([]);
		// Not vacuous: the connections' own requests are among them, for both instances.
		const handshakes = calls.filter(({ call }) => call.method !== 'tools/call');
		expect(new Set(handshakes.map(({ instance }) => instance))).toEqual(new Set(['work', 'probe']));
		// And every command call there was carried it.
		expect(log.filter(commandCall).every(({ rpc }) => metaOf(rpc)?.['dev.loam/scope'])).toBe(true);
	});

	it('finds a stock umbel answers the same with the key present as without it', async () => {
		const transport = new StreamableHttpTransport(umbel.url, {
			clientName: 'loam-test',
			clientVersion: '0',
			mode: 'auto',
			headers: { authorization: `Bearer ${await umbel.token()}` },
		});
		await transport.connect();
		let id = 0;
		const greet = async (meta?: Record<string, unknown>) => {
			const response = await transport.send({
				jsonrpc: '2.0',
				id: ++id,
				method: 'tools/call',
				params: {
					name: 'afd-call',
					arguments: { command: 'hello-greet', input: { name: 'Ada', space: 'main' } },
					...(meta ? { _meta: meta } : {}),
				},
			} as never);
			const result = response.result as { structuredContent?: Answer };
			const { at: _at, ...rest } = result.structuredContent?.data ?? {};
			return { success: result.structuredContent?.success, data: rest };
		};
		try {
			const without = await greet();
			expect(without).toEqual({
				success: true,
				data: { greeting: 'Hello, Ada!', space: 'main' },
			});
			expect(
				await greet({ 'dev.loam/scope': { workspace: WORKSPACE, project: ids.atlas } })
			).toEqual(without);
		} finally {
			transport.disconnect();
		}
	});
});
