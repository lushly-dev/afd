/**
 * P4-E2's units (phase 4 specification, section 2 and 19): settings grant nothing. Phase 3's E2 sweep (`persona-sweep`)
 * on twin stores whose one person differs only in settings: in one twin their own theme is light, and the `setting`
 * table holds a workspace row and a project row; in the other their theme is the default's, and the table is empty. The person's theme differs
 * until the sweep's own `appearance-set`, which sets the same theme in both, and the shared rows throughout. Every registered command,
 * through a person and through an agent, in both modes, must answer with equal `ok`, `error.code` and `data`, but the
 * `data` of section 19's exemptions, which read settings or what a setting sets; their `ok` and `error.code` still
 * must. No setting is an input to `decideAccess`, line 0, the grants, the auth gate or the owner and human checks.
 *
 * Not a hand-kept list: a command with no decided input in `call-inputs.ts` fails `call-scope.test.ts`.
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
import type { LoamKernelV5 } from '../types.js';
import type { MembershipV1 } from './access.js';
import { appInput, filled, NOT_CALLED, SHELL_INPUTS } from './call-inputs.js';
import { SOMEONE_ELSE } from './fixtures.js';
import type { ScopeV1 } from './records.js';

const kernels: LoamKernelV5[] = [];
afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.dispose()));
});

const EMAIL = 'someone@example.com';

/**
 * Section 19's exemptions from comparing `data` (P4-E2), and `view-state-list`, which lists the `loam.appearance`
 * alias with the person's own appearance (3.6): never from `ok` or `error.code`. Of the commands the list names, step
 * 1 registers `setting-*`, `appearance-get`, `palette-search` (compared as a set), `app-list` and `app-get`.
 */
const DATA_EXEMPT: ReadonlySet<string> = new Set([
	'setting-schema-get',
	'setting-list',
	'setting-get',
	'setting-set',
	'setting-reset',
	'appearance-get',
	'app-list',
	'app-get',
	'view-state-list',
]);

/** The sweep's inputs: a sign-in names the twins' one person. */
const SWEEP_INPUTS: Readonly<Record<string, unknown>> = {
	...SHELL_INPUTS,
	'auth-sign-in': { method: 'credentials', email: EMAIL, password: 'x' },
};

/** The deployment's identity in `provider` mode: the person a member and no owner. */
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
	at: ScopeV1;
}

const signIn = (twin: ScopedWorkspace) =>
	twin.kernel.call('auth-sign-in', { method: 'credentials', email: EMAIL, password: 'x' });

/** One twin: the person's document, link and tab in Citadel; with `set`, their settings and the shared rows. */
async function twin(set: boolean, mode: Mode): Promise<Twin> {
	const workspace = await createScopedWorkspace({
		deployment: documentsDeployment(),
		ports: documentsPorts(),
		...(mode === 'provider' ? { identity: PROVIDER, membership: ACME, empty: true } : {}),
	});
	const { kernel, store } = workspace;
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
	const document = created.data?.id as string;
	const linked = await kernel.call<{ id: string }>(
		'document-link-add',
		{ from: document, to: document },
		at
	);
	await kernel.call('document-open', { document }, at);
	// Both twins' person writes their theme, so both kernels' clocks read alike: one light, the other the default's.
	const written = await kernel.call('setting-set', {
		section: 'loam.appearance',
		key: 'theme',
		value: set ? 'light' : 'system',
		level: 'person',
	});
	expect(written.success, JSON.stringify(written.error)).toBe(true);
	if (set) {
		// Shared rows of a section no app declares now, at both levels: what a stale row could say, it grants nothing.
		const stamp = { updatedAt: 1, updatedBy: 'mock-user-olu@example.com' };
		for (const [id, extra] of [
			['probe.general/workspace', { level: 'workspace' }],
			[`probe.general/project/${citadel}`, { level: 'project', project: citadel }],
		] as const) {
			await store.create<Record<string, unknown>>('setting', {
				id,
				workspace: 'personal',
				section: 'probe.general',
				...extra,
				values: { access: { value: 'everyone', ...stamp } },
				...stamp,
			});
		}
	}
	return Object.assign(workspace, {
		document,
		link: linked.data?.id as string,
		at: at.scope,
	});
}

type Call = (twin: Twin, name: string, input: unknown) => Promise<unknown>;

const PATHS: Array<[Mode, string, Call]> = (['local', 'provider'] as const).flatMap((mode) => [
	[mode, 'a person', (t, name, input) => t.kernel.call(name, input, { scope: t.at })],
	[mode, 'an agent', (t, name, input) => t.kernel.agent.call(name, input, { scope: t.at })],
]);

/** What the sweep compares of an answer: `ok`, `error.code`, and `data` unless exempt. */
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
	return JSON.parse(
		JSON.stringify({ ok: success, code: error?.code, data: held }, (key, value) =>
			key === 'expiresAt' || key === 'executionTimeMs' || key === 'durationMs' ? undefined : value
		)
	);
}

describe('P4-E2: settings grant nothing', () => {
	it.each(PATHS)(
		'P4-E2: every command answers alike with and without settings, in %s mode, through %s',
		async (mode, _path, call) => {
			const first = await twin(true, mode);
			const second = await twin(false, mode);
			expect(first.document).toBe(second.document);
			// The twins do differ: the first's person paints light, until the sweep's own `appearance-set` (dark in both).
			const theme = async (held: Twin) =>
				(await held.kernel.call<{ theme: string }>('appearance-get')).data?.theme;
			expect(await theme(first)).toBe('light');
			expect(await theme(second)).toBe('system');
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
					const input = filled(template, held.at.project as string, held.document, held.link);
					answers.push(await call(held, command.name, input));
				}
				expect(compared(command.name, answers[0]), command.name).toEqual(
					compared(command.name, answers[1])
				);
				if (command.name === 'auth-sign-out') {
					await signIn(first);
					await signIn(second);
				}
				called += 1;
			}
			expect(called).toBe(commands.length - Object.keys(NOT_CALLED).length);
		}
	);
});
