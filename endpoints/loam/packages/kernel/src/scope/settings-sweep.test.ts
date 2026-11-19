/**
 * P4-E2's units (phase 4 specification, section 2 and 19): settings grant nothing. "The type and the scan", as P3-E2's,
 * and phase 3's E2 sweep (`persona-sweep`) on twin stores whose one person differs only in settings: in one twin their
 * own theme is light, an app's declared section holds a workspace value and a project value, `loam.documents.trashDays`
 * is 7, and the `setting` table also holds stray rows of a section no app declares; in the other each declared value
 * is written at its default. The theme differs until the sweep's own `appearance-set`, which sets the same theme in
 * both, and the rest throughout. Every registered command, through a person and through an agent, in both modes, must
 * answer with equal `ok`, `error.code` and `data`, but the `data` of section 19's exemptions, which read settings or
 * what a setting sets; their `ok` and `error.code` still must. Two answers show a setting's value, and only that is
 * left out of their comparison: `view-state-list`'s `loam.appearance` alias, and `workspace-get`'s `trashDays`.
 *
 * Not a hand-kept list: a command with no decided input in `call-inputs.ts` fails `call-scope.test.ts`.
 */

import { readFileSync } from 'node:fs';
import type { IdentityV1, ManifestV2 } from '@lushly-dev/loam-manifest';
import { defineApp, success } from '@lushly-dev/loam-sdk';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { SHELL_COMMAND_NAMES } from '../shell-command-names.js';
import {
	createFixturePorts,
	createScopedWorkspace,
	documentsDeployment,
	PROBE_DOCUMENTS_DEFINITION,
	PROBE_DOCUMENTS_MANIFEST,
	type ScopedWorkspace,
} from '../testing.js';
import type { LoamKernelV5 } from '../types.js';
import type { AccessInputV2, MembershipV1 } from './access.js';
import { appInput, filled, NOT_CALLED, SHELL_INPUTS } from './call-inputs.js';
import { SOMEONE_ELSE, scopedPackages } from './fixtures.js';
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
]);

/** An app that declares a section at workspace and project level, and one command that reads nothing of it. */
const PREFS: ManifestV2 = {
	manifest_version: 2,
	protocol: 1,
	plugin: {
		id: 'prefs',
		title: 'Prefs',
		version: '1.0.0',
		description: 'A fixture whose section the sweep sets in one twin.',
		kind: 'native',
		domains: ['prefs'],
	},
	native: { entry: 'dist/native.js' },
	app: { scope_levels: ['workspace', 'project'] },
	grants: [{ name: 'settings', reason: 'Reads its own section.' }],
	commands: [
		{
			name: 'prefs-ping',
			title: 'Ping',
			description: 'Answers, reading nothing.',
			effects: ['inspect'],
			input_schema: { type: 'object', properties: {}, additionalProperties: false },
		},
	],
	ui: {
		surfaces: { main: { element: 'prefs-main' } },
		settings: [
			{
				id: 'general',
				title: 'General',
				levels: ['workspace', 'project'],
				schema: {
					type: 'object',
					properties: {
						mode: {
							type: 'string',
							title: 'Mode',
							enum: ['solo', 'team', 'room'],
							default: 'solo',
						},
					},
					additionalProperties: false,
				},
			},
		],
	},
} as unknown as ManifestV2;

const sweepDeployment = () => {
	const base = documentsDeployment();
	return {
		...base,
		apps: [...base.apps, { instance: 'prefs', app: 'prefs', package: 'fixtures/prefs/' }],
	};
};
const sweepPorts = () =>
	createFixturePorts({
		...scopedPackages(),
		'fixtures/probe/': {
			manifest: PROBE_DOCUMENTS_MANIFEST,
			definition: PROBE_DOCUMENTS_DEFINITION,
		},
		'fixtures/prefs/': {
			manifest: PREFS,
			definition: defineApp({
				sdk: 1,
				handlers: { 'prefs-ping': (async () => success({})) as never },
			}),
		},
	});

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
		deployment: sweepDeployment(),
		ports: sweepPorts(),
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
	// Both twins write the same keys, so both kernels' clocks read alike: one twin a value, the other the default.
	const write = async (input: Record<string, unknown>, options = {}) => {
		const written = await kernel.call('setting-set', input, options);
		expect(written.success, JSON.stringify(written.error)).toBe(true);
	};
	await write({
		section: 'loam.appearance',
		key: 'theme',
		value: set ? 'light' : 'system',
		level: 'person',
	});
	await write(
		{ section: 'prefs.general', key: 'mode', value: set ? 'room' : 'solo', level: 'project' },
		at
	);
	// The workspace's values are an owner's: in `provider` mode the sweep's person is no owner, so Olu sets them.
	if (mode === 'provider') {
		await kernel.call('auth-sign-in', {
			method: 'credentials',
			email: 'olu@example.com',
			password: 'x',
		});
	}
	await write({
		section: 'prefs.general',
		key: 'mode',
		value: set ? 'team' : 'solo',
		level: 'workspace',
	});
	await write({
		section: 'loam.documents',
		key: 'trashDays',
		value: set ? 7 : 30,
		level: 'workspace',
	});
	if (mode === 'provider') await signIn(workspace);
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
				: name === 'view-state-list'
					? // The `loam.appearance` alias's state is the person's appearance, a setting's value (3.6): only it.
						{
							...(data as object),
							states: (data as { states: Array<{ id: string }> }).states.map((entry) =>
								entry.id === 'loam.appearance' ? { id: entry.id } : entry
							),
						}
					: name === 'workspace-get'
						? // `trashDays` is `loam.documents.trashDays` written through (A-P2-2): only it.
							{ ...(data as object), trashDays: undefined }
						: data;
	return JSON.parse(
		JSON.stringify({ ok: success, code: error?.code, data: held }, (key, value) =>
			key === 'expiresAt' || key === 'executionTimeMs' || key === 'durationMs' ? undefined : value
		)
	);
}

// Each test runs every registered command against twin kernels; the count grows with every step, and a loaded
// machine running all packages at once (a pre-push over a tooling change) took them past vitest's 5 s default.
describe('P4-E2: settings grant nothing', { timeout: 30_000 }, () => {
	it.each(PATHS)(
		'P4-E2: every command answers alike with and without settings, in %s mode, through %s',
		async (mode, _path, call) => {
			const first = await twin(true, mode);
			const second = await twin(false, mode);
			expect(first.document).toBe(second.document);
			// The twins do differ: the first's person paints light, until the sweep's own `appearance-set` (dark in both),
			// and its declared section and retention differ throughout.
			const theme = async (held: Twin) =>
				(await held.kernel.call<{ theme: string }>('appearance-get')).data?.theme;
			expect(await theme(first)).toBe('light');
			expect(await theme(second)).toBe('system');
			const modeOf = async (held: Twin, options = {}) =>
				(
					await held.kernel.call<{ value: string }>(
						'setting-get',
						{ section: 'prefs.general', key: 'mode' },
						options
					)
				).data?.value;
			expect([
				await modeOf(first, { scope: 'workspace' }),
				await modeOf(second, { scope: 'workspace' }),
			]).toEqual(['team', 'solo']);
			expect([
				await modeOf(first, { scope: first.at }),
				await modeOf(second, { scope: second.at }),
			]).toEqual(['room', 'solo']);
			const days = async (held: Twin) =>
				(await held.kernel.call<{ trashDays: number }>('workspace-get')).data?.trashDays;
			expect([await days(first), await days(second)]).toEqual([7, 30]);
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

describe('P4-E2: the type and the scan (section 19)', () => {
	it('P4-E2: no setting is a key of the access decision', () => {
		expectTypeOf<keyof AccessInputV2>().toEqualTypeOf<
			'actor' | 'scope' | 'project' | 'membership' | 'agent'
		>();
	});

	it('P4-E2: no setting is read by the decision, line 0, the gate, the port or the owner and human checks', () => {
		const read = (path: string) =>
			readFileSync(new URL(path, import.meta.url), 'utf8')
				// Comments say what is not an input; only code is scanned.
				.replace(/\/\*[\s\S]*?\*\//g, '')
				.replace(/\/\/.*$/gm, '');
		const sources: Record<string, string> = {
			'scope/access.ts': read('./access.ts'),
			'scope/middleware.ts': read('./middleware.ts'),
			'late/port-refusals.ts': read('../late/port-refusals.ts'),
			'late/owners.ts': read('../late/owners.ts'),
			'late/auth-gate.ts': read('../late/auth-gate.ts'),
			// The port's list names the two commands an app may call with the grant, and nothing else of settings.
			'late/port-callable.ts': read('../late/port-callable.ts').replace(
				/'setting-(get|list)'|grants\.has\('settings'\)/g,
				''
			),
		};
		const identity = read('../late/identity-commands.ts');
		sources['late/identity-commands.ts humanRequired'] = identity.slice(
			identity.indexOf('humanRequired(')
		);
		for (const [path, source] of Object.entries(sources)) {
			expect(source.length, path).toBeGreaterThan(0);
			expect(source, path).not.toMatch(/setting|SETTING_|loam\.settings|resolveSetting/i);
		}
	});
});
