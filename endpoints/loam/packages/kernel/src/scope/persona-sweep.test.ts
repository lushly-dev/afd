/**
 * P3-E2's sweep (phase 3 specification, 6.2; D89): persona never reaches a decision. Every registered command,
 * through a person and through an agent, on twin stores whose one person holds two personas each, the first
 * active in one twin and the second in the other. Each answer's `ok`, `error.code` and `data` must be equal,
 * but the `data` of the commands 6.2 exempts, which read or write personas or what a persona sets; their `ok`
 * and `error.code` still must be. `palette-search`'s items are compared as a set, since emphasis orders them.
 *
 * Not a hand-kept list: a command with no decided input in `call-inputs.ts` fails `call-scope.test.ts`, and a
 * command this loop does not call needs a named reason there.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { SHELL_COMMAND_NAMES } from '../shell-command-names.js';
import {
	createScopedWorkspace,
	documentsDeployment,
	documentsPorts,
	type ScopedWorkspace,
} from '../testing.js';
import type { LoamKernelV3 } from '../types.js';
import { appInput, filled, NOT_CALLED, SHELL_INPUTS } from './call-inputs.js';
import type { PersonaV1 } from './records.js';

const kernels: LoamKernelV3[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

const EMAIL = 'someone@example.com';

/** 6.2's exemptions from comparing `data`; never from `ok` or `error.code`. */
const DATA_EXEMPT: ReadonlySet<string> = new Set([
	'persona-list',
	'persona-create',
	'persona-update',
	'persona-remove',
	'persona-set',
	'appearance-get',
	'palette-search',
	'account-get',
	'member-list',
]);

/**
 * The sweep's inputs where the shared ones would end what it compares: a sign-in names the twins' one person, and
 * `persona-set` keeps each twin's active persona, so every later command still runs under two personas.
 */
const SWEEP_INPUTS: Readonly<Record<string, unknown>> = {
	...SHELL_INPUTS,
	'auth-sign-in': { method: 'credentials', email: EMAIL, password: 'x' },
	'persona-set': { persona: '$ACTIVE' },
};

/** Two personas, each a different emphasis, presentation, landing and project; the same density. */
const PERSONAS = [
	{
		title: 'Reviewer',
		presentation: { name: 'Rev', pronouns: 'they/them', avatar: 'system/folder' },
		defaults: { density: 'compact', landing: { section: 'documents' }, project: 'citadel' },
		emphasis: { apps: ['dual', 'probe'], sections: ['documents', 'account'] },
	},
	{
		title: 'Writer',
		presentation: { name: 'Wri' },
		defaults: { density: 'compact', landing: { app: 'solo' }, project: null },
		emphasis: { apps: ['solo', 'tasks'], sections: ['projects'] },
	},
];

interface Twin extends ScopedWorkspace {
	document: string;
	link: string;
	active: string;
}

const signIn = (twin: ScopedWorkspace) =>
	twin.kernel.call('auth-sign-in', { method: 'credentials', email: EMAIL, password: 'x' });

/** One twin: the person's document, link and tab in Citadel, both personas, and the `active`th set. */
async function twin(active: 0 | 1): Promise<Twin> {
	const workspace = await createScopedWorkspace({
		deployment: documentsDeployment(),
		ports: documentsPorts(),
	});
	const { kernel, scopes } = workspace;
	kernels.push(kernel);
	const at = { scope: scopes.citadel };
	expect((await signIn(workspace)).success).toBe(true);
	const created = await kernel.call<{ id: string }>(
		'document-create',
		{ type: 'probe', title: 'Notes' },
		at
	);
	const document = created.data?.id as string;
	const linked = await kernel.call<{ id: string }>(
		'document-link-add',
		{ from: document, to: document },
		at
	);
	await kernel.call('document-open', { document }, at);
	const ids: string[] = [];
	for (const persona of PERSONAS) {
		const made = await kernel.call<PersonaV1>('persona-create', persona);
		expect(made.success, JSON.stringify(made.error)).toBe(true);
		ids.push((made.data as PersonaV1).id);
	}
	const id = ids[active] as string;
	expect((await kernel.call('persona-set', { persona: id })).success).toBe(true);
	return Object.assign(workspace, { document, link: linked.data?.id as string, active: id });
}

type Call = (twin: Twin, name: string, input: unknown) => Promise<unknown>;

const PATHS: Array<[string, Call]> = [
	['a person', (t, name, input) => t.kernel.call(name, input, { scope: t.scopes.citadel })],
	['an agent', (t, name, input) => t.kernel.agent.call(name, input, { scope: t.scopes.citadel })],
];

/** What the sweep compares of an answer: `ok`, `error.code`, and `data` unless exempt (6.2). */
function compared(name: string, answer: unknown): unknown {
	const { success, error, data } = answer as {
		success: boolean;
		error?: { code: string };
		data?: unknown;
	};
	const held =
		name === 'palette-search'
			? ((data as { items?: { name: string }[] } | undefined)?.items ?? [])
					.map((item) => item.name)
					.sort()
			: DATA_EXEMPT.has(name)
				? undefined
				: data;
	// What a wall clock decides, as `call-scope.test.ts` leaves it out.
	return JSON.parse(
		JSON.stringify({ ok: success, code: error?.code, data: held }, (key, value) =>
			key === 'expiresAt' || key === 'executionTimeMs' || key === 'durationMs' ? undefined : value
		)
	);
}

describe('P3-E2: persona changes emphasis, never what anyone may do', () => {
	it.each(PATHS)(
		'P3-E2: every command answers alike under two personas, through %s',
		async (_path, call) => {
			const first = await twin(0);
			const second = await twin(1);
			expect(first.active).not.toBe(second.active);
			expect(first.document).toBe(second.document);
			const citadel = first.scopes.citadel.project as string;
			const commands = first.registries.palette.listCommands();
			const shell = new Set<string>(SHELL_COMMAND_NAMES);
			let called = 0;
			for (const command of commands) {
				if (NOT_CALLED[command.name]) continue;
				const template = shell.has(command.name)
					? SWEEP_INPUTS[command.name]
					: appInput(
							(command as { jsonSchema?: unknown; inputSchema?: unknown }).jsonSchema ??
								(command as { inputSchema?: unknown }).inputSchema
						);
				const answers = [];
				for (const held of [first, second]) {
					const input = JSON.parse(
						JSON.stringify(filled(template, citadel, held.document, held.link)).replace(
							'$ACTIVE',
							held.active
						)
					);
					answers.push(await call(held, command.name, input));
				}
				expect(compared(command.name, answers[0]), command.name).toEqual(
					compared(command.name, answers[1])
				);
				// A command that signed the person out: both twins sign in again, so the rest still runs as them.
				if (command.name === 'auth-sign-out') {
					await signIn(first);
					await signIn(second);
				}
				called += 1;
			}
			expect(called).toBe(commands.length - Object.keys(NOT_CALLED).length);
			// Each twin's person still has the persona the sweep began with: the comparison held under two.
			for (const held of [first, second]) {
				const listed = await held.kernel.call<{ active: string }>('persona-list');
				expect(listed.data?.active).toBe(held.active);
			}
		}
	);
});
