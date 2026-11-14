/**
 * The call's own scope, on every command (phase 2 specification, 3.4; the documents specification's step 9
 * trust review). Not a hand-kept list: the test loops over every command the palette registry holds, the
 * shell's and the apps', and calls each, signed out, on twin workspaces, one at a project restricted to
 * someone else and one at a project that does not exist. Both twins hold the member's document, content,
 * selection and status value in that restricted project. The two must be indistinguishable: the result, the
 * new journal entries, the events and the whole store, after normalising only the project's id and the
 * context digest that hashes it, and what a wall clock decides. Nothing restricted may appear.
 *
 * A shell command needs a decided input below, and a command the loop does not call needs a named reason, so
 * a new command fails this test until someone decides how it is called.
 */

import type { JournalEntry } from '@lushly-dev/afd-core';
import { afterEach, describe, expect, it } from 'vitest';
import { INTERNAL_COMMANDS } from '../commands.js';
import { SHELL_COMMAND_NAMES } from '../shell-command-names.js';
import {
	createScopedWorkspace,
	documentsDeployment,
	documentsPorts,
	type ScopedWorkspace,
} from '../testing.js';
import type { KernelEventV3, LoamKernelV3 } from '../types.js';

const kernels: LoamKernelV3[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

/** The deployed instances, whose own commands the loop calls with what their schemas require. */
const APP_INSTANCES = documentsDeployment().apps.map((app) => app.instance);

/** What the member keeps in the restricted project, which no non-member may see. */
const SECRETS = [
	'Vault secret',
	'secret-content',
	'secret-selection',
	'secret-status',
	'secret-anchor',
];

/** The project's id in each twin's call: the restricted one's, or one no record has. */
const PROJECT = '$P';
/** The member's document in the restricted project, the same id in both twins. */
const DOCUMENT = '$D';
/** The member's link from their document to itself, the same id in both twins (documents specification, 9.3). */
const LINK = '$L';

/**
 * Each shell command's input, decided once: what reaches its handler, so the loop proves more than
 * validation. `$P` is the twin's project, `$D` the member's document.
 */
const SHELL_INPUTS: Readonly<Record<string, unknown>> = {
	'view-state-get': { id: `loam.layout@${PROJECT}` },
	'view-state-set': { id: `loam.layout@${PROJECT}`, state: { sidebar: { open: false } } },
	'view-state-list': {},
	'layout-get': {},
	'layout-set': { sidebar: { open: false } },
	'layout-reset': {},
	'appearance-get': {},
	'appearance-set': { theme: 'dark' },
	'palette-open': {},
	'palette-close': {},
	'palette-search': { query: 'vault' },
	'auth-sign-in': { method: 'credentials', email: 'person@example.com', password: 'x' },
	'auth-sign-out': {},
	'auth-session-get': {},
	'shell-info-get': {},
	'app-list': {},
	'app-get': { instance: 'dual' },
	'app-open': { instance: 'dual' },
	'app-close': {},
	'app-command-list': { instance: 'dual' },
	'app-instance-list': {},
	'app-instance-refresh': { instance: 'dual' },
	'app-selection-get': { instance: 'dual' },
	'app-selection-set': { instance: 'dual', id: 'probe-id' },
	'status-item-set': { id: 'count', value: 'v' },
	'toast-show': { message: 'Hello' },
	'modal-open': { title: 'Sure?', body: 'Really.' },
	'overlay-dismiss': { overlayId: 'none' },
	'overlay-list': {},
	'scope-get': {},
	'section-get': {},
	'scope-set': { project: PROJECT },
	'section-open': { section: 'documents' },
	'app-route-set': { instance: 'dual', path: 'items' },
	'project-create': { name: 'Delta' },
	'project-list': {},
	'project-get': { project: PROJECT },
	'project-update': { project: PROJECT, name: 'Renamed' },
	'project-archive': { project: PROJECT },
	'project-restore': { project: PROJECT },
	'project-summary-get': { project: PROJECT },
	'workspace-get': {},
	'workspace-app-list': {},
	'workspace-app-set': { instance: 'solo', title: 'Solo two' },
	'document-type-list': {},
	'new-list': {},
	'document-create': { type: 'probe', title: 'New', recent: true },
	'document-get': { document: DOCUMENT },
	'document-list': {},
	'document-rename': { document: DOCUMENT, title: 'Renamed' },
	'document-update': { document: DOCUMENT, tags: ['t'] },
	'document-move': { document: DOCUMENT, project: null },
	'document-trash': { document: DOCUMENT },
	'document-restore': { document: DOCUMENT },
	'document-export': { document: DOCUMENT },
	'document-import': {
		type: 'probe',
		envelope: { loam_document: 1, type: 'probe', content_version: 1, content: { text: 'x' } },
	},
	'document-link-add': { from: DOCUMENT, to: DOCUMENT, kind: 'embed' },
	'document-link-remove': { link: LINK },
	'document-link-list': { document: DOCUMENT },
	'document-open': { document: DOCUMENT },
	// `t1` is the member's tab of their document, in the restricted project's editor record.
	'editor-get': {},
	'editor-activate': { tab: 't1' },
	'editor-close': { tab: 't1', discard: true },
	'editor-pin': { tab: 't1', pinned: true },
	'editor-move': { tab: 't1', group: 'new' },
	'editor-dirty-set': { tab: 't1', dirty: true },
	'editor-selection-set': { tab: 't1', selection: { kind: 'text-range', start: 0, end: 1 } },
	'session-list': {},
	'session-revoke': { session: 'others' },
	'account-passkey-list': {},
	'account-passkey-add': { name: 'Laptop' },
	'account-passkey-rename': { passkey: 'none', name: 'x' },
	'account-passkey-remove': { passkey: 'none' },
};

/**
 * The registered commands the loop does not call, each with its reason. Boot-only commands are in no
 * registry a caller reaches, so the palette registry never holds them.
 */
const NOT_CALLED: Readonly<Record<string, string>> = {
	'app-call-refuse':
		'Internal: only the port runs it, to journal its own refusal (INTERNAL_COMMANDS)',
	'app-modal-refuse':
		'Internal: only the port runs it, to journal its own refusal (INTERNAL_COMMANDS)',
	'app-nested-refuse':
		'Internal: only the port runs it, to journal its own refusal (INTERNAL_COMMANDS)',
	'app-scope-refuse':
		'Internal: only the port runs it, to journal its own refusal (INTERNAL_COMMANDS)',
	'app-embed-refuse':
		'Internal: only the port runs it, to journal its own refusal (INTERNAL_COMMANDS)',
};

/** An app's command, called with what its schema requires: an app's own commands take lines 2 to 6. */
function appInput(schema: unknown): Record<string, unknown> {
	const { properties = {}, required = [] } = schema as {
		properties?: Record<string, { type?: string }>;
		required?: string[];
	};
	return Object.fromEntries(
		required.map((name) => [
			name,
			name === 'document'
				? DOCUMENT
				: name === 'command'
					? 'document-get'
					: properties[name]?.type === 'string'
						? 'k'
						: {},
		])
	);
}

/** Every value, with `$P`, `$D` and `$L` in place. */
function filled(value: unknown, project: string, document: string, link: string): unknown {
	return JSON.parse(
		JSON.stringify(value ?? {})
			.replaceAll(PROJECT, project)
			.replaceAll(DOCUMENT, document)
			.replaceAll(LINK, link)
	);
}

/** One twin: the scoped workspace with the documents fixture, and the member's secrets in Citadel. */
async function twin(): Promise<
	ScopedWorkspace & { events: KernelEventV3[]; document: string; link: string }
> {
	const workspace = await createScopedWorkspace({
		deployment: documentsDeployment(),
		ports: documentsPorts(),
	});
	const { kernel, scopes } = workspace;
	kernels.push(kernel);
	const at = { scope: scopes.citadel };
	await kernel.call('auth-sign-in', {
		method: 'credentials',
		email: 'someone@example.com',
		password: 'x',
	});
	const created = await kernel.call<{ id: string }>(
		'document-create',
		{ type: 'probe', title: 'Vault secret' },
		at
	);
	const document = created.data?.id as string;
	await kernel.call('probe-content-set', { document, text: 'secret-content' }, at);
	const linked = await kernel.call<{ id: string }>(
		'document-link-add',
		{ from: document, to: document, anchor: 'secret-anchor' },
		at
	);
	const link = linked.data?.id as string;
	// Open, with a tab in Citadel's editor record, unsaved and selected (documents specification, 5.2).
	await kernel.call('document-open', { document }, at);
	await kernel.call('editor-dirty-set', { tab: 't1', dirty: true }, at);
	await kernel.call('app-selection-set', { instance: 'dual', id: 'secret-selection' }, at);
	await kernel
		.appPort('dual')
		.surface({ scope: scopes.citadel })
		.call('status-item-set', { id: 'count', value: 'secret-status' });
	await kernel.call('auth-sign-out');
	const events: KernelEventV3[] = [];
	kernel.subscribe((event) => events.push(event));
	return Object.assign(workspace, { events, document, link });
}

/** The whole store, every table and row, in order. */
async function dump(workspace: ScopedWorkspace): Promise<unknown> {
	await workspace.kernel.flush();
	const tables = (workspace.store as unknown as { tables: Map<string, Map<string, unknown>> })
		.tables;
	return [...tables.keys()]
		.sort()
		.map((table) => [
			table,
			[...(tables.get(table)?.entries() ?? [])].sort(([a], [b]) => (a < b ? -1 : 1)),
		]);
}

/**
 * JSON, with the twin's project id as `<project>`, the context digest that hashes it as `<digest>`, and what
 * a wall clock decides left out: timings, the Mock's session id and expiry, from `Date.now()`, and a view-state
 * row's `updatedAt`, which the view-state registry stamps from the wall clock.
 */
function normal(value: unknown, projects: readonly string[]): string {
	return JSON.stringify(value, (key, held) =>
		key === 'executionTimeMs' || key === 'durationMs' || key === 'expiresAt'
			? undefined
			: key === 'contextDigest'
				? '<digest>'
				: // A view-state row's time is the registry's wall clock, an ISO string; the kernel's own records
					// keep the call's clock, a number, and are compared.
					key === 'updatedAt' && typeof held === 'string'
					? '<wall clock>'
					: held
	)
		.replace(new RegExp(projects.join('|'), 'g'), '<project>')
		.replace(/mock-session-\d+/g, '<session>');
}

type Call = (
	workspace: ScopedWorkspace,
	name: string,
	input: unknown,
	scope: { workspace: string; project?: string }
) => Promise<unknown>;

/** The paths a call takes: a person's, an agent's, and the surface ports of two apps. */
const PATHS: Array<[string, Call]> = [
	['person', (w, name, input, scope) => w.kernel.call(name, input, { scope })],
	['agent', (w, name, input, scope) => w.kernel.agent.call(name, input, { scope })],
	[
		"dual's surface",
		(w, name, input, scope) => w.kernel.appPort('dual').surface({ scope }).call(name, input),
	],
	[
		"probe's surface",
		(w, name, input, scope) => w.kernel.appPort('probe').surface({ scope }).call(name, input),
	],
];

describe('P2-D6: the call scope on every command', () => {
	it('decides an input for every shell command, and a reason for every command it does not call', async () => {
		const workspace = await createScopedWorkspace({
			deployment: documentsDeployment(),
			ports: documentsPorts(),
		});
		kernels.push(workspace.kernel);
		const registered = workspace.registries.palette.listCommands().map((row) => row.name);
		expect(Object.keys(SHELL_INPUTS).sort()).toEqual([...SHELL_COMMAND_NAMES].sort());
		expect(Object.keys(NOT_CALLED).sort()).toEqual(
			registered.filter((name) => INTERNAL_COMMANDS.includes(name)).sort()
		);
		// Everything else registered is a deployed app's own, called with what its schema requires.
		const shell = new Set<string>([...SHELL_COMMAND_NAMES, ...Object.keys(NOT_CALLED)]);
		const apps = registered.filter((name) => !shell.has(name));
		expect(apps.length).toBeGreaterThan(0);
		for (const name of apps) {
			expect(
				APP_INSTANCES.some((instance) => name.startsWith(`${instance}-`)),
				name
			).toBe(true);
		}
	});

	it.each(PATHS)(
		'P2-D6: answers a restricted project as a missing one, by every command, through %s',
		async (_path, call) => {
			const restricted = await twin();
			const missing = await twin();
			expect(restricted.document).toBe(missing.document);
			expect(restricted.link).toMatch(/^lnk_/);
			expect(restricted.link).toBe(missing.link);
			const NOWHERE = { workspace: 'personal', project: 'prj_nowhere' };
			const citadel = restricted.scopes.citadel.project as string;
			const commands = restricted.registries.palette.listCommands();
			const shell = new Set<string>(SHELL_COMMAND_NAMES);
			let called = 0;
			for (const command of commands) {
				if (NOT_CALLED[command.name]) continue;
				const template = shell.has(command.name)
					? SHELL_INPUTS[command.name]
					: appInput(
							(command as { jsonSchema?: unknown; inputSchema?: unknown }).jsonSchema ??
								(command as { inputSchema?: unknown }).inputSchema
						);
				const journals = [
					(await restricted.journal.read()).length,
					(await missing.journal.read()).length,
				];
				const events = [restricted.events.length, missing.events.length];
				const answers = [
					await call(
						restricted,
						command.name,
						filled(template, citadel, restricted.document, restricted.link),
						restricted.scopes.citadel
					),
					await call(
						missing,
						command.name,
						filled(template, 'prj_nowhere', missing.document, missing.link),
						NOWHERE
					),
				];
				const entries = [
					((await restricted.journal.read()) as JournalEntry[]).slice(journals[0]),
					((await missing.journal.read()) as JournalEntry[]).slice(journals[1]),
				];
				const seen = [restricted.events.slice(events[0]), missing.events.slice(events[1])];
				const what = [
					{
						answer: answers[0],
						entries: entries[0],
						events: seen[0],
						store: await dump(restricted),
					},
					{ answer: answers[1], entries: entries[1], events: seen[1], store: await dump(missing) },
				];
				// Both ids in both twins: each store also holds the restricted project's records, as the member left them.
				const [one, two] = what.map((held) => normal(held, [citadel, 'prj_nowhere']));
				expect(one, command.name).toBe(two);
				// What the call answered, journaled and announced: never anything of the member's.
				const told = JSON.stringify([answers, entries, seen]);
				for (const secret of SECRETS)
					expect(told, `${command.name} ${secret}`).not.toContain(secret);
				// Nor the member's document's id, which the normalising above leaves equal in both twins: no
				// answer may name it, though an entry journals the input that named it.
				expect(JSON.stringify(answers), `${command.name} document id`).not.toContain(
					restricted.document
				);
				expect(JSON.stringify(answers), `${command.name} link id`).not.toContain(restricted.link);
				called += 1;
			}
			expect(called).toBe(commands.length - Object.keys(NOT_CALLED).length);
			// The restricted project's records are still there, unchanged, in the store: only unreadable.
			expect(JSON.stringify(await dump(restricted))).toContain('Vault secret');
			expect(restricted.events.length).toBeGreaterThan(0);
		}
	);
});
