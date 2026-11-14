/**
 * P3-E2's sweep (phase 3 specification, 6.2; D89): persona never reaches a decision. Every registered command,
 * through a person and through an agent, on twin stores whose one person holds two personas each, the first
 * active in one twin and the second in the other. Each answer's `ok`, `error.code` and `data` must be equal,
 * but the `data` of the commands 6.2 exempts, which read or write personas or what a persona sets; their `ok`
 * and `error.code` still must be. `palette-search`'s items are compared as a set, since emphasis orders them.
 *
 * It runs in both modes: `provider`'s person is a member and no owner, in a project restricted to them, so line 0
 * and the owner checks answer too (the step 5 review's I5). Each twin's own entries must carry its persona, so a
 * path that ran under none fails (B1).
 *
 * Not a hand-kept list: a command with no decided input in `call-inputs.ts` fails `call-scope.test.ts`, and a
 * command this loop does not call needs a named reason there.
 */

import type { IdentityV1 } from '@lushly-dev/loam-manifest';
import { afterEach, describe, expect, it } from 'vitest';
import { SHELL_COMMAND_NAMES } from '../shell-command-names.js';
import {
	createScopedWorkspace,
	documentsDeployment,
	documentsPorts,
	type ScopedWorkspace,
} from '../testing.js';
import type { LoamKernelV3 } from '../types.js';
import type { MembershipV1 } from './access.js';
import { appInput, filled, NOT_CALLED, SHELL_INPUTS } from './call-inputs.js';
import { SOMEONE_ELSE } from './fixtures.js';
import type { PersonaV1, ScopeV1 } from './records.js';

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

/**
 * Two personas, each a different title, presentation and emphasis. Their density, project and landing are the same:
 * the sweep signs the person in again after `auth-sign-out`, and at a `provider` sign-in a persona's project and
 * landing move them by design (6.2), so different ones would compare two places rather than two personas.
 */
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
		defaults: { density: 'compact', landing: { section: 'documents' }, project: 'citadel' },
		emphasis: { apps: ['solo', 'tasks'], sections: ['projects'] },
	},
];

/** The deployment's identity in `provider` mode: the person a member and no owner (6.2's line 0 and owner checks). */
const PROVIDER: IdentityV1 = {
	mode: 'provider',
	organization: 'acme',
	path: 'api/auth',
	methods: ['passkey', 'password'],
};
const ACME: MembershipV1 = {
	mode: 'provider',
	members: new Map([
		[SOMEONE_ELSE, 'member'],
		['mock-user-olu@example.com', 'owner'],
	]),
	digest: 'd1',
};

type Mode = 'local' | 'provider';

interface Twin extends ScopedWorkspace {
	document: string;
	link: string;
	active: string;
	/** Where every call of the sweep is made: Citadel, restricted to the person. */
	at: ScopeV1;
}

const signIn = (twin: ScopedWorkspace) =>
	twin.kernel.call('auth-sign-in', { method: 'credentials', email: EMAIL, password: 'x' });

/**
 * One twin: the person's document, link and tab in Citadel, both personas, and the `active`th set. In `provider`
 * mode the person is a member and no owner, and Citadel is a project they made restricted to themselves.
 */
async function twin(active: 0 | 1, mode: Mode): Promise<Twin> {
	const workspace = await createScopedWorkspace({
		deployment: documentsDeployment(),
		ports: documentsPorts(),
		...(mode === 'provider' ? { identity: PROVIDER, membership: ACME, empty: true } : {}),
	});
	const { kernel } = workspace;
	kernels.push(kernel);
	expect((await signIn(workspace)).success).toBe(true);
	if (mode === 'provider') {
		const made = await kernel.call('project-create', {
			name: 'Citadel',
			access: { mode: 'restricted', members: [SOMEONE_ELSE] },
		});
		expect(made.success, JSON.stringify(made.error)).toBe(true);
	}
	const citadel = (await kernel.call<{ id: string }>('project-get', { project: 'citadel' })).data
		?.id as string;
	const at = { scope: { workspace: 'personal', project: citadel } };
	const created = await kernel.call<{ id: string }>(
		'document-create',
		{ type: 'probe', title: 'Plan' },
		at
	);
	expect(created.success, JSON.stringify(created.error)).toBe(true);
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
	return Object.assign(workspace, {
		document,
		link: linked.data?.id as string,
		active: id,
		at: at.scope,
	});
}

type Call = (twin: Twin, name: string, input: unknown) => Promise<unknown>;

const PATHS: Array<[Mode, string, Call]> = (['local', 'provider'] as const).flatMap((mode) => [
	[mode, 'a person', (t, name, input) => t.kernel.call(name, input, { scope: t.at })],
	[mode, 'an agent', (t, name, input) => t.kernel.agent.call(name, input, { scope: t.at })],
]);

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
		'P3-E2: every command answers alike under two personas, in %s mode, through %s',
		async (mode, _path, call) => {
			const first = await twin(0, mode);
			const second = await twin(1, mode);
			expect(first.active).not.toBe(second.active);
			expect(first.document).toBe(second.document);
			const commands = first.registries.palette.listCommands();
			const shell = new Set<string>(SHELL_COMMAND_NAMES);
			let called = 0;
			/** By twin, how many of the path's own entries carried that twin's persona: the sweep's proof it ran under two. */
			const carried = [0, 0];
			for (const command of commands) {
				if (NOT_CALLED[command.name]) continue;
				const template = shell.has(command.name)
					? SWEEP_INPUTS[command.name]
					: appInput(
							(command as { jsonSchema?: unknown; inputSchema?: unknown }).jsonSchema ??
								(command as { inputSchema?: unknown }).inputSchema
						);
				const answers = [];
				for (const [index, held] of [first, second].entries()) {
					const input = JSON.parse(
						JSON.stringify(
							filled(template, held.at.project as string, held.document, held.link)
						).replace('$ACTIVE', held.active)
					);
					const before = (await held.journal.read()).length;
					answers.push(await call(held, command.name, input));
					// The call's own entry, journaled, carries this twin's persona: a call that compared no persona
					// would leave the half vacuous (the step 5 review's B1).
					for (const entry of (await held.journal.read()).slice(before)) {
						if (entry.command !== command.name || entry.context?.parent !== undefined) continue;
						expect(
							(entry.context as { persona?: string } | undefined)?.persona,
							`${command.name}'s entry`
						).toBe(held.active);
						carried[index] = (carried[index] as number) + 1;
					}
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
			// Most of the path's calls were journaled with each twin's persona.
			for (const count of carried) expect(count).toBeGreaterThan(called / 2);
			// Each twin's person still has the persona the sweep began with: the comparison held under two.
			for (const held of [first, second]) {
				const listed = await held.kernel.call<{ active: string }>('persona-list');
				expect(listed.data?.active).toBe(held.active);
			}
		}
	);
});
