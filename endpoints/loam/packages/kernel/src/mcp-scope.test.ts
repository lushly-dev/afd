/**
 * P2-E5: the scope travels in `_meta` over MCP, through a test-only handler (phase 2 specification, 3.3).
 *
 * What this proves: a real `createMcpHandler` from `@lushly-dev/afd-server`, given `mcpOptions()`, takes
 * `dev.loam/scope` as the one declared context field, and the kernel's own middleware runs on it, so the
 * journal holds each call's scope and a restricted project is refused. What it does not prove: anything
 * only `run` does (a default scope from the active one, the wait for stage B, the event, `dev.loam/seq`),
 * identity over MCP, which is phase 3's (a server's actor has no id, and reads as `local`), or a hosted
 * server, which is phase 6's.
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { StreamableHttpTransport } from '@lushly-dev/afd-client/streamable-http';
import { type CommandResult, success } from '@lushly-dev/afd-core';
import { createMcpHandler } from '@lushly-dev/afd-server';
import { defineCommandWithSchema } from '@lushly-dev/afd-server/define';
import { afterEach, describe, expect, it } from 'vitest';
import * as z from 'zod/mini';
import { BOOT_ONLY, INTERNAL_COMMANDS } from './commands.js';
import { PERSON_SESSION } from './late/index.js';
import {
	createScopedWorkspace,
	documentsDeployment,
	documentsPorts,
	type ScopedWorkspace,
} from './testing.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

/**
 * A command of the test's own, through the kernel's chain: it answers what its context holds of the
 * fields only trusted code sets, so a test sees that a client's `_meta` reached none of them.
 */
const contextEcho = defineCommandWithSchema({
	name: 'test-context-echo',
	description: 'Answers the trusted fields its context holds',
	input: z.strictObject({}),
	jsonSchema: { type: 'object', properties: {}, additionalProperties: false },
	async handler(_input, context) {
		const held = context as Record<string, unknown>;
		return success(
			Object.fromEntries(
				['caller', 'app', 'instance', 'replay', 'parent', 'scope'].map((key) => [
					key,
					held[key] ?? null,
				])
			)
		);
	},
});

async function serve(workspace: ScopedWorkspace): Promise<string> {
	const options = workspace.mcpOptions();
	// Stage B has run inside `createKernelParts`, so `late/` has built them.
	if (!options) throw new Error('mcpOptions() before late/ loaded');
	const handler = createMcpHandler({
		name: 'loam-test',
		version: '0.0.0',
		// Phase 6 decides `expose.mcp`; this test sets it on all.
		commands: [...options.commands, contextEcho as never].map((command) => ({
			...command,
			expose: { ...command.expose, mcp: true },
		})),
		middleware: [...options.middleware],
		contextFields: [...options.contextFields],
		host: '127.0.0.1',
		toolStrategy: 'individual',
		bootstrap: true,
	});
	const server = createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	cleanups.push(async () => {
		handler.dispose();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await workspace.kernel.dispose();
	});
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
}

async function connect(url: string, mode: 'auto' | 'legacy') {
	const transport = new StreamableHttpTransport(url, {
		clientName: 'loam-test',
		clientVersion: '0',
		mode,
	});
	await transport.connect();
	cleanups.push(async () => transport.disconnect());
	let id = 0;
	const request = async (method: string, params: unknown) => {
		const response = await transport.send({ jsonrpc: '2.0', id: ++id, method, params } as never);
		return response.result as Record<string, unknown>;
	};
	return {
		request,
		async call<T = unknown>(name: string, args: unknown = {}, meta?: Record<string, unknown>) {
			const result = await request('tools/call', {
				name,
				arguments: args,
				...(meta ? { _meta: meta } : {}),
			});
			const structured = result.structuredContent as CommandResult<T> | undefined;
			if (structured) return structured;
			const content = result.content as Array<{ text: string }> | undefined;
			return JSON.parse(content?.[0]?.text ?? '{}') as CommandResult<T>;
		},
		async names(): Promise<string[]> {
			const listed = await request('tools/list', {});
			return (listed.tools as Array<{ name: string }>).map((tool) => tool.name).sort();
		},
	};
}

describe.each(['auto', 'legacy'] as const)('P2-E5: the scope over MCP (%s)', (mode) => {
	it('delivers each call its own scope, absent as the workspace, and journals each', async () => {
		const workspace = await createScopedWorkspace();
		const { atlas, beacon } = workspace.scopes;
		const client = await connect(await serve(workspace), mode);
		const listed = await client.names();
		const seen: unknown[] = [];
		for (const scope of [atlas, beacon, undefined]) {
			const result = await client.call<{ scope: unknown }>(
				'dual-where',
				{},
				scope ? { 'dev.loam/scope': scope } : undefined
			);
			expect(result.success).toBe(true);
			seen.push(result.data?.scope);
		}
		expect(seen).toEqual([atlas, beacon, { workspace: 'personal' }]);
		const journaled = (await workspace.journal.read())
			.filter((entry) => entry.command === 'dual-where')
			.map((entry) => entry.context?.scope);
		expect(journaled).toEqual(seen);
		// A declared field never changes `tools/list`.
		expect(await client.names()).toEqual(listed);
	});

	it('serves no boot-only or internal command: neither listed nor callable', async () => {
		const workspace = await createScopedWorkspace();
		const client = await connect(await serve(workspace), mode);
		const listed = await client.names();
		expect(listed).toContain('dual-where');
		for (const name of [...BOOT_ONLY, ...INTERNAL_COMMANDS]) {
			expect(listed, name).not.toContain(name);
			const result = await client.call(name, { generation: 'forged', workspace: {}, entries: [] });
			expect(result.error?.code, name).toBe('COMMAND_NOT_FOUND');
		}
	});

	it("P2-D6: answers a restricted project's document as a missing one, and another scope's as SCOPE_MISMATCH", async () => {
		const workspace = await createScopedWorkspace({
			deployment: documentsDeployment(),
			ports: documentsPorts(),
		});
		const { kernel, scopes } = workspace;
		await kernel.call('auth-sign-in', {
			method: 'credentials',
			email: 'someone@example.com',
			password: 'x',
		});
		const vault = (
			await kernel.call<{ id: string }>(
				'document-create',
				{ type: 'probe' },
				{ scope: scopes.citadel }
			)
		).data?.id;
		await kernel.call('auth-sign-out');
		const beacon = (
			await kernel.call<{ id: string }>(
				'document-create',
				{ type: 'probe' },
				{ scope: scopes.beacon }
			)
		).data?.id;
		const client = await connect(await serve(workspace), mode);
		// A server's actor has no id, and reads as `local`, which Citadel does not list (3.3).
		const restricted = await client.call('document-get', { document: vault });
		const missing = await client.call('document-get', { document: 'doc_nowhere00000' });
		expect(missing.error?.code).toBe('DOCUMENT_NOT_FOUND');
		expect(JSON.stringify(restricted.error)).toBe(JSON.stringify(missing.error));
		const crossed = await client.call(
			'probe-content-set',
			{ document: beacon, text: 'x' },
			{ 'dev.loam/scope': scopes.atlas }
		);
		expect(crossed.error?.code).toBe('SCOPE_MISMATCH');
		expect((await workspace.journal.read()).at(-1)?.result.error?.code).toBe('SCOPE_MISMATCH');
	});

	it("P2-D6: decides the call's own scope for document-list, -create and -import, writing nothing", async () => {
		const workspace = await createScopedWorkspace({
			deployment: documentsDeployment(),
			ports: documentsPorts(),
		});
		const { scopes, store } = workspace;
		const client = await connect(await serve(workspace), mode);
		const before = (await store.list('document')).data.length;
		for (const [name, input] of [
			['document-list', {}],
			['document-create', { type: 'probe' }],
			[
				'document-import',
				{
					type: 'probe',
					envelope: { loam_document: 1, type: 'probe', content_version: 1, content: { text: 'x' } },
				},
			],
		] as const) {
			const restricted = await client.call(name, input, { 'dev.loam/scope': scopes.citadel });
			const missing = await client.call(name, input, {
				'dev.loam/scope': { workspace: 'personal', project: 'prj_nowhere' },
			});
			expect(restricted.error?.code, name).toBe('PROJECT_NOT_FOUND');
			expect(JSON.stringify(restricted.error), name).toBe(JSON.stringify(missing.error));
		}
		expect((await store.list('document')).data.length).toBe(before);
	});

	it('runs the middleware: a project restricted to a named member is refused, as a missing one', async () => {
		const workspace = await createScopedWorkspace();
		const client = await connect(await serve(workspace), mode);
		const restricted = await client.call(
			'dual-where',
			{},
			{
				'dev.loam/scope': workspace.scopes.citadel,
			}
		);
		const missing = await client.call(
			'dual-where',
			{},
			{
				'dev.loam/scope': { workspace: 'personal', project: 'prj_nowhere' },
			}
		);
		expect(restricted.error?.code).toBe('PROJECT_NOT_FOUND');
		expect(JSON.stringify(restricted.error)).toBe(JSON.stringify(missing.error));
		expect((await workspace.journal.read()).at(-1)?.result.error?.code).toBe('PROJECT_NOT_FOUND');
	});

	it('reads none of the fields only trusted code sets', async () => {
		const workspace = await createScopedWorkspace();
		const client = await connect(await serve(workspace), mode);
		const claimed = {
			'dev.loam/caller': 'tasks',
			'dev.loam/app': 'tasks',
			'dev.loam/instance': 'tasks',
			'dev.loam/replay': 'recorded',
			'dev.loam/parent': 'loam-x-1',
		};
		// The kernel's auth middleware gates a command it does not hold, so this one needs a session.
		await workspace.kernel.call('auth-sign-in', {
			method: 'credentials',
			email: 'person@example.com',
			password: 'x',
		});
		const echoed = await client.call('test-context-echo', {}, claimed);
		expect(echoed.data).toEqual({
			caller: null,
			app: null,
			instance: null,
			replay: null,
			parent: null,
			scope: { workspace: 'personal' },
		});
		const result = await client.call('dual-where', {}, claimed);
		expect(result.success).toBe(true);
		const entry = (await workspace.journal.read()).at(-1);
		expect(entry?.context).toEqual({ scope: { workspace: 'personal' } });
	});

	it("never moves a person's active scope: a server's call has no active scope", async () => {
		const workspace = await createScopedWorkspace();
		const { kernel } = workspace;
		await kernel.call('auth-sign-in', {
			method: 'credentials',
			email: 'person@example.com',
			password: 'x',
		});
		const vault = await kernel.call<{ id: string }>('project-create', {
			name: 'Vault',
			access: { mode: 'restricted', members: ['mock-user-person@example.com'] },
		});
		await kernel.call('scope-set', { project: 'vault' });
		const client = await connect(await serve(workspace), mode);
		// The server's actor is an agent with no id, read as `local`, which Vault refuses.
		expect((await client.call('dual-where')).success).toBe(true);
		const active = await kernel.call<{ scope: { project?: string } }>('scope-get');
		expect(active.data?.scope.project).toBe(vault.data?.id);
	});

	it("serves no command that moves a person's scope or session, and an archive moves none", async () => {
		const workspace = await createScopedWorkspace();
		const { kernel } = workspace;
		const client = await connect(await serve(workspace), mode);
		const listed = await client.names();
		for (const name of PERSON_SESSION) {
			expect(listed, name).not.toContain(name);
			expect((await client.call(name, {})).error?.code, name).toBe('COMMAND_NOT_FOUND');
		}
		await kernel.call('scope-set', { project: 'atlas' });
		const archived = await client.call('project-archive', { project: 'atlas' });
		expect(archived.success).toBe(true);
		// Archived for everyone; the person's active scope stays where the person put it.
		const active = await kernel.call<{ scope: { project?: string } }>('scope-get');
		expect(active.data?.scope.project).toBe(workspace.scopes.atlas.project);
		expect((await kernel.call('view-state-get', { id: 'loam.scope' })).data).toMatchObject({
			state: { project: workspace.scopes.atlas.project },
		});
	});

	it("gives the same through afd-call's `meta` argument", async () => {
		const workspace = await createScopedWorkspace();
		const client = await connect(await serve(workspace), mode);
		const result = await client.call<{ scope: unknown }>('afd-call', {
			command: 'dual-where',
			input: {},
			meta: { 'dev.loam/scope': workspace.scopes.atlas },
		});
		expect(result.data?.scope).toEqual(workspace.scopes.atlas);
	});

	it('refuses a malformed scope as VALIDATION_ERROR, naming the field', async () => {
		const workspace = await createScopedWorkspace();
		const client = await connect(await serve(workspace), mode);
		const result = await client.call('dual-where', {}, { 'dev.loam/scope': { workspace: 7 } });
		expect(result.error?.code).toBe('VALIDATION_ERROR');
		expect(result.error?.details).toMatchObject({ field: 'scope', meta: 'dev.loam/scope' });
	});
});
