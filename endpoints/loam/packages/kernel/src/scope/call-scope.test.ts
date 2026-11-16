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
import { appInput, filled, NOT_CALLED, SHELL_INPUTS } from './call-inputs.js';

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
