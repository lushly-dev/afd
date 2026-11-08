/**
 * P2-E5: the scope travels in `_meta` over MCP, through a test-only handler (phase 2 specification, 3.3).
 *
 * What this proves: a real `createMcpHandler` from `@lushly-dev/afd-server`, given `mcpOptions()`, takes
 * `dev.loam/scope` as the one declared context field, and the kernel's own middleware runs on it, so the
 * journal holds each call's scope and a restricted project is refused, and a mutation's event reaches the
 * page's listeners. What it does not prove: anything only `run` does (a default scope from the active one,
 * the wait for stage B, a failure's or a query's event, `dev.loam/seq`),
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
import type { KernelEventV2 } from './types.js';

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

	it("P2-D5: section-get gives a server's caller no document id, and document-open writes the record alone, moving nothing on the person's screen", async () => {
		const workspace = await createScopedWorkspace({
			deployment: documentsDeployment(),
			ports: documentsPorts(),
		});
		const { kernel, scopes } = workspace;
		// The member opens their Citadel document, on their own screen, and stays there, signed in: a server's
		// caller, whose actor is `local`, may not enter Citadel.
		await kernel.call('auth-sign-in', {
			method: 'credentials',
			email: 'someone@example.com',
			password: 'x',
		});
		await kernel.call('scope-set', { project: scopes.citadel.project });
		const vault = (
			await kernel.call<{ id: string }>('document-create', { type: 'probe', title: 'Vault' })
		).data?.id as string;
		await kernel.call('document-open', { document: vault });
		expect((await kernel.call('section-get')).data).toMatchObject({ path: vault });
		const client = await connect(await serve(workspace), mode);
		const section = await client.call<{ path: string }>('section-get');
		expect(section.data?.path).toBe('');
		expect(JSON.stringify(section)).not.toContain(vault);

		// A server opening an Atlas document while the person has `dual` open at the workspace.
		await kernel.call('scope-set', { project: null });
		await kernel.call('app-open', { instance: 'dual' });
		const atlasNote = (
			await kernel.call<{ id: string }>('document-create', { type: 'probe', project: 'atlas' })
		).data?.id as string;
		const opened = await client.call<{ tab: string; scope?: unknown }>(
			'document-open',
			{ document: atlasNote },
			{ 'dev.loam/scope': scopes.atlas }
		);
		expect(opened.success).toBe(true);
		expect(opened.data?.scope).toBeUndefined();
		expect((await kernel.call('section-get')).data).toMatchObject({
			active: 'dual',
			section: null,
		});
		expect((await kernel.call<{ scope: unknown }>('scope-get')).data?.scope).toEqual({
			workspace: 'personal',
		});
		// The document's own record holds the tab.
		const atlasEditor = await kernel.call<{ groups: Array<{ tabs: Array<{ document: string }> }> }>(
			'editor-get',
			{},
			{ scope: scopes.atlas }
		);
		expect(atlasEditor.data?.groups[0]?.tabs.map((tab) => tab.document)).toEqual([atlasNote]);
	});

	it("P2-D5: a server's document-open into the active scope adds a tab and activates nothing, and its editor calls reach the page as events", async () => {
		const workspace = await createScopedWorkspace({
			deployment: documentsDeployment(),
			ports: documentsPorts(),
		});
		const { kernel } = workspace;
		const create = async (title: string) =>
			(await kernel.call<{ id: string }>('document-create', { type: 'probe', title })).data
				?.id as string;
		const mine = await create('Mine');
		const theirs = await create('Theirs');
		await kernel.call('document-open', { document: mine });
		const heard: KernelEventV2[] = [];
		kernel.subscribe((event) => heard.push(event));
		const client = await connect(await serve(workspace), mode);
		const at = { 'dev.loam/scope': { workspace: 'personal' } };
		const opened = await client.call<{ tab: string }>('document-open', { document: theirs }, at);
		expect(opened.success).toBe(true);
		// What the person sees is unchanged: the same active tab, so the same path, and no URL move.
		expect((await kernel.call('section-get')).data).toMatchObject({
			section: 'documents',
			path: mine,
		});
		const editor = await kernel.call<{
			groups: Array<{ active: string; tabs: Array<{ id: string; document: string }> }>;
		}>('editor-get');
		const group = editor.data?.groups[0];
		expect(group?.tabs.map((tab) => tab.document)).toEqual([mine, theirs]);
		expect(group?.tabs.find((tab) => tab.id === group.active)?.document).toBe(mine);
		const open = heard.filter((event) => event.command === 'document-open');
		expect(open).toEqual([
			{
				command: 'document-open',
				interface: 'agent',
				success: true,
				mutation: true,
				scope: { workspace: 'personal' },
			},
		]);
		// A server's editor call that moves the active tab is heard with `mainChanged`, as the URL follows it.
		await client.call('editor-activate', { tab: opened.data?.tab }, at);
		expect(heard.at(-1)).toMatchObject({ command: 'editor-activate', mainChanged: 'replace' });
		expect((await kernel.call('section-get')).data).toMatchObject({ path: theirs });
		// A query is not an event, and nor is a refusal.
		const count = heard.length;
		await client.call('editor-get', {}, at);
		await client.call('editor-activate', { tab: 't99' }, at);
		expect(heard.length).toBe(count);
	});

	it("P2-D5: a server's document-open into an empty area main shows activates its tab, and the URL follows it", async () => {
		const workspace = await createScopedWorkspace({
			deployment: documentsDeployment(),
			ports: documentsPorts(),
		});
		const { kernel } = workspace;
		await kernel.call('section-open', { section: 'documents' });
		const note = (
			await kernel.call<{ id: string }>('document-create', { type: 'probe', title: 'Only' })
		).data?.id as string;
		const heard: KernelEventV2[] = [];
		kernel.subscribe((event) => heard.push(event));
		const client = await connect(await serve(workspace), mode);
		await client.call(
			'document-open',
			{ document: note },
			{ 'dev.loam/scope': { workspace: 'personal' } }
		);
		expect(heard.at(-1)).toMatchObject({ command: 'document-open', mainChanged: 'replace' });
		expect((await kernel.call('section-get')).data).toMatchObject({
			section: 'documents',
			path: note,
		});
	});

	it("P2-D5: a server's trash or move of a document with an unsaved tab is refused, and so is its marking that tab saved", async () => {
		const workspace = await createScopedWorkspace({
			deployment: documentsDeployment(),
			ports: documentsPorts(),
		});
		const { kernel } = workspace;
		const note = (
			await kernel.call<{ id: string }>('document-create', { type: 'probe', title: 'Drafted' })
		).data?.id as string;
		await kernel.call('document-open', { document: note });
		await kernel.call('editor-dirty-set', { tab: 't1', dirty: true });
		const client = await connect(await serve(workspace), mode);
		const at = { 'dev.loam/scope': { workspace: 'personal' } };
		for (const [name, input] of [
			['document-trash', { document: note }],
			['document-move', { document: note, project: 'atlas' }],
			['editor-dirty-set', { tab: 't1', dirty: false }],
		] as const) {
			const refused = await client.call(name, input, at);
			expect(refused.error?.code, name).toBe('EDITOR_TAB_DIRTY');
			expect(refused.error?.suggestion, name).toContain('Ask the person to save it, then retry');
		}
		// Nor may a server open with stay, which is the person's page's alone.
		const stayed = await client.call('document-open', { document: note, stay: 'background' }, at);
		expect(stayed.error?.code).toBe('DOCUMENT_OPEN_STAY_REFUSED');
		expect((await kernel.call('document-get', { document: note })).data).toMatchObject({
			status: 'active',
			scope: { workspace: 'personal' },
		});
		const editor = await kernel.call<{ groups: Array<{ tabs: Array<{ dirty: boolean }> }> }>(
			'editor-get'
		);
		expect(editor.data?.groups[0]?.tabs[0]?.dirty).toBe(true);
	});

	it("emits nothing to the page of a server's mutation in a project the page's actor may not enter", async () => {
		const workspace = await createScopedWorkspace({
			deployment: documentsDeployment(),
			ports: documentsPorts(),
		});
		const { kernel } = workspace;
		// Signed out, the page's actor is `local`, as a server's is: a project only `local` may enter.
		const hidden = await kernel.call<{ id: string }>('project-create', {
			name: 'Local only',
			access: { mode: 'restricted', members: ['local'] },
		});
		expect(hidden.success, JSON.stringify(hidden.error)).toBe(true);
		await kernel.call('auth-sign-in', {
			method: 'credentials',
			email: 'person@example.com',
			password: 'x',
		});
		const heard: KernelEventV2[] = [];
		kernel.subscribe((event) => heard.push(event));
		const client = await connect(await serve(workspace), mode);
		const made = await client.call<{ id: string }>(
			'document-create',
			{ type: 'probe', title: 'Unseen' },
			{ 'dev.loam/scope': { workspace: 'personal', project: hidden.data?.id } }
		);
		expect(made.success, JSON.stringify(made)).toBe(true);
		expect(heard).toEqual([]);
		// One in the workspace, which the person may enter, is heard.
		await client.call(
			'document-create',
			{ type: 'probe', title: 'Seen' },
			{ 'dev.loam/scope': { workspace: 'personal' } }
		);
		expect(heard.map((event) => event.command)).toEqual(['document-create']);
	});

	it("tells the page of a server's call that takes the page's actor out of the call's scope", async () => {
		const workspace = await createScopedWorkspace();
		const { kernel } = workspace;
		// Signed out, the page's actor is `local`, as a server's is: a project both it and the person may enter.
		const shared = await kernel.call<{ id: string }>('project-create', {
			name: 'Shared',
			access: { mode: 'restricted', members: ['local', 'mock-user-person@example.com'] },
		});
		expect(shared.success, JSON.stringify(shared.error)).toBe(true);
		await kernel.call('auth-sign-in', {
			method: 'credentials',
			email: 'person@example.com',
			password: 'x',
		});
		const heard: KernelEventV2[] = [];
		kernel.subscribe((event) => heard.push(event));
		const client = await connect(await serve(workspace), mode);
		const project = shared.data?.id as string;
		const updated = await client.call(
			'project-update',
			{ project, access: { mode: 'restricted', members: ['local'] } },
			{ 'dev.loam/scope': { workspace: 'personal', project } }
		);
		expect(updated.success, JSON.stringify(updated)).toBe(true);
		// The person may no longer enter it, and still hears that it changed.
		expect(heard.map((event) => event.command)).toEqual(['project-update']);
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
