/**
 * The inbound dispatcher's units (phase 6 specification, 10.8; D138, D139): the served list, the JSON-RPC methods,
 * the proxies onto the agent interface as `loam-inbound`, the scope from `_meta`, and what an agent may not reach.
 * P6-D6 runs the same through the desktop's endpoint, in the desktop suite.
 */

import type { JournalEntry, MemoryJournalSink } from '@lushly-dev/afd-core';
import type { ManifestV3 } from '@lushly-dev/loam-manifest';
import { afterEach, describe, expect, it } from 'vitest';
import { INTERNAL_COMMANDS } from '../commands.js';
import { HUMAN_COMMANDS } from '../identity/identity-commands.js';
import { OWNER_COMMANDS } from '../identity/member-commands.js';
import { PERSON_SESSION } from '../identity/person-session.js';
import {
	createScopedWorkspace,
	DUAL_DEFINITION,
	DUAL_MANIFEST,
	type ScopedWorkspace,
	type ScopedWorkspaceOptions,
	SOLO_DEFINITION,
	SOLO_MANIFEST,
	scopedPackages,
} from '../scope/fixtures.js';
import { createFixturePorts } from '../testing-probe.js';
import {
	createInboundDispatcher,
	DESKTOP_MCP_COMMANDS,
	INBOUND_AGENT,
	INBOUND_PROTOCOL_VERSION,
	type InboundDispatcherV1,
} from './index.js';

const made: ScopedWorkspace[] = [];
afterEach(async () => {
	await Promise.all(made.splice(0).map(({ kernel }) => kernel.dispose()));
});

/** `solo` with `solo-put` exposed to MCP and asking first (`confirm_prompt`), and `solo-where` not exposed. */
const SOLO_INBOUND: ManifestV3 = {
	...SOLO_MANIFEST,
	commands: (SOLO_MANIFEST.commands ?? []).map((command) =>
		command.name === 'solo-put'
			? { ...command, expose: { mcp: true }, confirm_prompt: 'Put {key}?' }
			: command
	),
} as ManifestV3;

/** `dual` with `dual-where`, which answers the scope its call ran in, exposed to MCP. */
const DUAL_INBOUND: ManifestV3 = {
	...DUAL_MANIFEST,
	commands: (DUAL_MANIFEST.commands ?? []).map((command) =>
		command.name === 'dual-where' ? { ...command, expose: { mcp: true } } : command
	),
} as ManifestV3;

async function open(
	options: ScopedWorkspaceOptions = {}
): Promise<ScopedWorkspace & { inbound: InboundDispatcherV1 }> {
	const workspace = await createScopedWorkspace({
		ports: createFixturePorts({
			...scopedPackages(),
			'fixtures/solo/': { manifest: SOLO_INBOUND, definition: SOLO_DEFINITION },
			'fixtures/dual/': { manifest: DUAL_INBOUND, definition: DUAL_DEFINITION },
		}),
		...options,
	});
	made.push(workspace);
	await workspace.kernel.appsReady;
	const inbound = createInboundDispatcher({
		agent: workspace.kernel.agent,
		commands: () => workspace.inboundCommands(),
	});
	return { ...workspace, inbound };
}

let next = 0;
const request = (method: string, params?: unknown) => ({
	jsonrpc: '2.0',
	id: ++next,
	method,
	...(params === undefined ? {} : { params }),
});

type ToolAnswer = {
	result: {
		isError: boolean;
		structuredContent?: {
			success: boolean;
			data?: unknown;
			error?: { code: string; details?: unknown };
		};
	};
};

async function callTool(
	inbound: InboundDispatcherV1,
	name: string,
	args: Record<string, unknown> = {},
	meta?: Record<string, unknown>
) {
	const answer = (await inbound.handle(
		request('tools/call', { name, arguments: args, ...(meta ? { _meta: meta } : {}) })
	)) as unknown as ToolAnswer;
	return answer.result;
}

const journalOf = (journal: MemoryJournalSink) => journal.read() as Promise<JournalEntry[]>;

describe('DESKTOP_MCP_COMMANDS (D138)', () => {
	it('holds no page state and no human, owner, session or internal command', () => {
		const never = new Set([
			...HUMAN_COMMANDS,
			...OWNER_COMMANDS,
			...PERSON_SESSION,
			...INTERNAL_COMMANDS,
			'document-open',
		]);
		expect(DESKTOP_MCP_COMMANDS.filter((name) => never.has(name))).toEqual([]);
		expect(new Set(DESKTOP_MCP_COMMANDS).size).toBe(DESKTOP_MCP_COMMANDS.length);
	});
});

describe('the dispatcher (10.8)', () => {
	it('answers initialize, ping and notifications, and method-not-found for the rest, server/discover included', async () => {
		const { inbound } = await open();
		expect(await inbound.handle(request('initialize', { protocolVersion: '2025-06-18' }))).toEqual({
			jsonrpc: '2.0',
			id: next,
			result: {
				protocolVersion: INBOUND_PROTOCOL_VERSION,
				capabilities: { tools: {} },
				serverInfo: { name: 'loam-desktop', version: '0.1.0' },
			},
		});
		expect(await inbound.handle(request('ping'))).toEqual({ jsonrpc: '2.0', id: next, result: {} });
		for (const method of ['server/discover', 'resources/list', 'prompts/list', 'tools/listx']) {
			const answer = await inbound.handle(request(method));
			expect(answer, method).toMatchObject({ id: next, error: { code: -32601 } });
		}
		expect(
			await inbound.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })
		).toBeUndefined();
		expect(await inbound.handle({ jsonrpc: '2.0', id: 3 })).toMatchObject({
			id: 3,
			error: { code: -32600 },
		});
		expect(await inbound.handle({ jsonrpc: '2.0', id: true, method: 'ping' })).toMatchObject({
			id: null,
			error: { code: -32600 },
		});
		for (const params of [undefined, { name: 1 }, { name: 'project-list', arguments: [] }]) {
			expect(await inbound.handle(request('tools/call', params))).toMatchObject({
				error: { code: -32602 },
			});
		}
	});

	it('lists DESKTOP_MCP_COMMANDS that are registered, the apps’ MCP-exposed commands and the meta-tools', async () => {
		const workspace = await open();
		const answer = (await workspace.inbound.handle(request('tools/list'))) as {
			result: { tools: Array<{ name: string; inputSchema?: unknown; description?: string }> };
		};
		const names = answer.result.tools.map((tool) => tool.name);
		const served = workspace.inbound.served();
		// The shell's served commands are the list's names the kernel registers for agents; then the one app command.
		const registered = new Set(workspace.registries.agent.listCommandNames());
		const apps = ['dual-where', 'solo-put'];
		expect(served.filter((name) => !apps.includes(name)).sort()).toEqual(
			DESKTOP_MCP_COMMANDS.filter((name) => registered.has(name)).sort()
		);
		expect(served.filter((name) => apps.includes(name)).sort()).toEqual(apps);
		for (const name of ['project-create', 'project-list', 'document-list', 'confirmation-get'])
			expect(served).toContain(name);
		expect(names).toEqual(
			expect.arrayContaining([
				...served,
				'afd-call',
				'afd-batch',
				'afd-pipe',
				'afd-discover',
				'afd-detail',
			])
		);
		for (const name of [
			'document-open',
			'member-invite',
			'autonomy-set',
			'layout-set',
			'auth-sign-in',
			'solo-where',
			'dual-put',
		])
			expect(names, name).not.toContain(name);
		// The kernel's own descriptions and schemas.
		const create = answer.result.tools.find((tool) => tool.name === 'project-create');
		expect(create?.description).toBe(
			workspace.registries.agent.listCommands().find((command) => command.name === 'project-create')
				?.description
		);
		expect(create?.inputSchema).toMatchObject({ type: 'object' });
	});

	it('runs a call on the agent interface as loam-inbound, journaled, and refuses what it does not serve', async () => {
		const { inbound, kernel, journal } = await open({ agentsAct: true });
		const created = await callTool(inbound, 'project-create', { name: 'Inbound' });
		expect(created.isError).toBe(false);
		expect(created.structuredContent?.success).toBe(true);
		const entry = (await journalOf(journal)).findLast((each) => each.command === 'project-create');
		expect(entry?.actor).toMatchObject({ kind: 'agent', id: INBOUND_AGENT });
		expect((await kernel.call('project-get', { project: 'inbound' })).success).toBe(true);
		// `access` is the person's to set (phase 3's 3.4).
		const restricted = await callTool(inbound, 'project-create', {
			name: 'Vault',
			access: { mode: 'restricted', members: ['mock-user-someone@example.com'] },
		});
		expect(restricted.structuredContent?.error?.code).toBe('HUMAN_REQUIRED');
		// A command it does not serve, by name and through the meta-tools, runs nothing.
		const before = (await journalOf(journal)).length;
		for (const [name, args] of [
			['document-open', { document: 'x' }],
			['member-invite', { email: 'a@example.com' }],
			['afd-call', { command: 'document-open', input: { document: 'x' } }],
			['afd-call', { command: 'layout-set', input: {} }],
			['afd-batch', { commands: [{ command: 'autonomy-set', input: {} }] }],
		] as const) {
			const refused = await callTool(inbound, name, args);
			// A batch answers as AFD's server does, its step refused inside it.
			if (name === 'afd-batch') expect(JSON.stringify(refused), name).toMatch(/"success":false/);
			else expect(refused.isError, name).toBe(true);
		}
		expect(JSON.stringify((await journalOf(journal)).slice(before))).not.toMatch(
			/document-open|member-invite|layout-set|autonomy-set/
		);
	});

	it('reads the scope from _meta, never from what the person has open', async () => {
		const { inbound, kernel, scopes } = await open({ agentsAct: true });
		// The person is in Atlas; an inbound call with no scope runs at workspace level.
		await kernel.call('scope-set', { project: 'atlas' });
		const where = async (meta?: Record<string, unknown>) =>
			(
				(await callTool(inbound, 'dual-where', {}, meta)).structuredContent?.data as {
					scope?: unknown;
				}
			)?.scope;
		expect(await where()).toEqual({ workspace: scopes.atlas.workspace });
		expect(await where({ 'dev.loam/scope': scopes.beacon })).toEqual(scopes.beacon);
		const invalid = await callTool(inbound, 'dual-where', {}, { 'dev.loam/scope': { nope: 1 } });
		expect(invalid.isError).toBe(true);
	});

	it('answers CONFIRMATION_PENDING for a command that asks, which confirmation-get then reads', async () => {
		const { inbound } = await open();
		// The workspace's default asks an agent first (phase 5's 6.1).
		const asked = await callTool(inbound, 'project-create', { name: 'Asked' });
		expect(asked.structuredContent?.error?.code).toBe('CONFIRMATION_PENDING');
		const { notification } = (asked.structuredContent?.error?.details ?? {}) as {
			notification: string;
		};
		const read = await callTool(inbound, 'confirmation-get', { notification });
		expect(read.structuredContent).toMatchObject({ success: true, data: { state: 'pending' } });
		// An app's own `confirm_prompt` asks even where agents act.
		const { inbound: acting } = await open({ agentsAct: true });
		const put = await callTool(acting, 'solo-put', { key: 'k', value: 'v' });
		expect(put.structuredContent?.error?.code).toBe('CONFIRMATION_PENDING');
	});

	it('marks a pipeline with a failed step as an error, as AFD’s router does', async () => {
		const { inbound } = await open({ agentsAct: true });
		const piped = await callTool(inbound, 'afd-pipe', {
			steps: [{ command: 'project-get', input: { project: 'nowhere' } }],
		});
		expect(JSON.stringify(piped.structuredContent)).toContain('"status":"failure"');
		expect(piped.isError).toBe(true);
		const fine = await callTool(inbound, 'afd-pipe', {
			steps: [{ command: 'project-list', input: {} }],
		});
		expect(fine.isError).toBe(false);
	});

	it('answers a request whose handling throws with an internal error, never silence', async () => {
		const workspace = await open();
		const inbound = createInboundDispatcher({
			agent: workspace.kernel.agent,
			commands: () => {
				throw new Error('no commands');
			},
		});
		expect(await inbound.handle(request('tools/list'))).toMatchObject({
			id: next,
			error: { code: -32603, data: { code: 'COMMAND_FAILED', suggestion: expect.any(String) } },
		});
	});

	it('builds its registry again when the kernel’s command set changes', async () => {
		const workspace = await open();
		const first = workspace.inboundCommands();
		expect(workspace.inboundCommands()).toBe(first);
		workspace.setAppCommands([]);
		expect(workspace.inboundCommands()).not.toBe(first);
		expect(workspace.inbound.served()).not.toContain('solo-put');
	});
});
