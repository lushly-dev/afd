/**
 * P4-E2's units (phase 4 specification, section 2 and 19): settings, and from step 8 autonomy, grant nothing; from
 * phase 5's step 3 autonomy decides whether an agent's call asks, so both twins hold the workspace's mode `act`. "The type and the scan", as P3-E2's,
 * and phase 3's E2 sweep (`persona-sweep`) on twin stores whose one person differs only in settings: in one twin their
 * own theme is light, an app's declared section holds a workspace value and a project value, `loam.documents.trashDays`
 * is 7, the `setting` table also holds stray rows of a section no app declares, and the `autonomy` table holds the
 * workspace's mode and ceiling, a command row and the restricted project's row, beside the person's own cap (step 8);
 * and by experiments (step 9): the workspace has one on, the person another, and an app held out whole is on, whose
 * commands are exempt entirely, as section 19 says; and by the shell's own sections (3.7, section 11): the person's rail
 * order, a keybinding override and a muted app, and the workspace's raised limits, whose readers `keybinding-list` and
 * `limit-usage-get` are section 19's exemptions; the twins' clocks are levelled after each command;
 * in the other each declared value
 * is written at its default. The theme differs until the sweep's own `appearance-set`, which sets the same theme in
 * both, and the rest throughout. Every registered command, through a person and through an agent, in both modes, must
 * answer with equal `ok`, `error.code` and `data`, but the `data` of section 19's exemptions, which read settings or
 * what a setting sets; their `ok` and `error.code` still must. Two answers show a setting's value, and only that is
 * left out of their comparison: `view-state-list`'s `loam.appearance` alias, and `workspace-get`'s `trashDays`.
 *
 * Not a hand-kept list: a command with no decided input in `call-inputs.ts` fails `call-scope.test.ts`.
 */

import { readFileSync } from 'node:fs';
import type { IdentityV1, ManifestV3 } from '@lushly-dev/loam-manifest';
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
import type { LoamKernel } from '../types.js';
import type { AccessInputV2, MembershipV1 } from './access.js';
import { appInput, filled, NOT_CALLED, SHELL_INPUTS } from './call-inputs.js';
import { SOMEONE_ELSE, scopedPackages } from './fixtures.js';
import type { ScopeV1 } from './records.js';

const kernels: LoamKernel[] = [];
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
	// Step 8's: autonomy's rows, resolution and cap are what the twins differ by (4.4).
	'autonomy-get',
	'autonomy-list',
	'autonomy-set',
	// Step 9's: experiments' states are what the twins differ by (5.4).
	'experiment-list',
	'experiment-check',
	'experiment-enable',
	'experiment-disable',
	// The shell's own sections the twins differ by (3.7, section 11): the person's keys and the workspace's limits.
	'keybinding-list',
	'limit-usage-get',
	'appearance-get',
	'app-list',
	'app-get',
	// Phase 5's 9.2: the bus lists the writes that made the twins differ (each one's settings, autonomy and experiments).
	'event-list',
]);

/** An app that declares a section at workspace and project level, and one command that reads nothing of it. */
const PREFS: ManifestV3 = {
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
		// Step 9's (P4-E2): one experiment the workspace has on in one twin, and one the person has.
		experiments: [
			{
				id: 'beta',
				title: 'Beta',
				changes: 'Tries something.',
				ends: '2027-03-01',
				stage: 'visible',
			},
			{ id: 'trial', title: 'Trial', changes: 'Tries more.', ends: '2027-03-01', stage: 'visible' },
			{ id: 'other', title: 'Other', changes: 'Tries else.', ends: '2027-03-01', stage: 'visible' },
		],
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
} as unknown as ManifestV3;

/** Step 9's (P4-E2): an app held out whole by its own experiment, on in one twin, so its commands are exempt entirely. */
const GATED: ManifestV3 = {
	...PREFS,
	plugin: { ...PREFS.plugin, id: 'gated', title: 'Gated', domains: ['gated'] },
	app: { scope_levels: ['workspace', 'project'], requires_experiment: 'gated.on' },
	grants: [],
	commands: [{ ...(PREFS.commands?.[0] as object), name: 'gated-ping' }],
	ui: {
		surfaces: { main: { element: 'gated-main' } },
		experiments: [
			{ id: 'on', title: 'Gated', changes: 'Shows the app.', ends: '2027-03-01', stage: 'visible' },
		],
	},
} as unknown as ManifestV3;

const sweepDeployment = () => {
	const base = documentsDeployment();
	return {
		...base,
		apps: [
			...base.apps,
			{ instance: 'prefs', app: 'prefs', package: 'fixtures/prefs/' },
			{ instance: 'gated', app: 'gated', package: 'fixtures/gated/' },
		],
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
		'fixtures/gated/': {
			manifest: GATED,
			definition: defineApp({
				sdk: 1,
				handlers: { 'gated-ping': (async () => success({})) as never },
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
	/** The twin's clock, and its setting forward (step 9). */
	ticks(): number;
	level(to: number): void;
	document: string;
	link: string;
	at: ScopeV1;
}

const signIn = (twin: ScopedWorkspace) =>
	twin.kernel.call('auth-sign-in', { method: 'credentials', email: EMAIL, password: 'x' });

/** One twin: the person's document, link and tab in Citadel; with `set`, their settings and the shared rows. */
async function twin(set: boolean, mode: Mode): Promise<Twin> {
	// Each twin's own stepping clock, which the sweep brings level after each command (step 9, below).
	let tick = Date.parse('2026-01-01T00:00:00Z');
	const workspace = await createScopedWorkspace({
		clock: () => tick++,
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
	// The shell's own person sections (3.7): the rail's order, keybinding overrides and the notifications' mute, set in
	// one twin and at their defaults in the other. `toastSticky` stays at its default in both: it lands a toast in the
	// inbox by design (6.1), which changes what `toast-show` makes, and decides no access.
	await write({
		section: 'loam.rail',
		key: 'order',
		value: set ? ['prefs', 'probe'] : [],
		level: 'person',
	});
	await write({
		section: 'loam.keybindings',
		key: 'overrides',
		value: set ? [{ command: 'palette-open', keys: 'Mod+Shift+K' }] : [],
		level: 'person',
	});
	await write({
		section: 'loam.notifications',
		key: 'muted',
		value: set ? ['prefs'] : [],
		level: 'person',
	});
	// Step 9's: the person is out of the workspace's experiment in both twins first, so neither is told of it (5.2).
	const experiment = async (on: boolean, input: Record<string, unknown>) => {
		const written = await kernel.call(on ? 'experiment-enable' : 'experiment-disable', input);
		expect(written.success, JSON.stringify(written.error)).toBe(true);
	};
	await experiment(false, { experiment: set ? 'prefs.beta' : 'prefs.other', audience: 'person' });
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
	// Step 10's limits (section 11), an owner's: raised past what any sweep call reaches, so only usage differs.
	await write({
		section: 'loam.limits',
		key: 'messageBytes',
		value: set ? 2_097_152 : 1_048_576,
		level: 'workspace',
	});
	await write({
		section: 'loam.limits',
		key: 'storeBytes',
		value: set ? 52_428_800 : 26_214_400,
		level: 'workspace',
	});
	// Step 8's autonomy (P4-E2): the workspace's mode, ceiling and a command row, an owner's; in the other twin the same
	// calls remove them, so both kernels' clocks read alike.
	const autonomy = async (input: Record<string, unknown>) => {
		const written = await kernel.call('autonomy-set', input);
		expect(written.success, JSON.stringify(written.error)).toBe(true);
	};
	// The workspace's own mode is `act` in both (phase 5's step 3): autonomy now decides whether an agent's call asks (its
	// 6.1), so the twins resolve every mode alike while their rows, ceiling and cap still differ, and the sweep still
	// shows that none of it decides what an agent may do. Ask against act is P5-A5's (`copilot/enforce.test.ts`).
	await autonomy({ level: 'workspace', mode: 'act', ceiling: set ? 'act' : null });
	await autonomy({
		level: 'workspace',
		instance: 'dual',
		command: 'dual-put',
		mode: set ? 'act' : null,
	});
	// Step 9's: the workspace's enablement, an owner's; the other twin turns another on, so both write a row alike.
	await experiment(true, { experiment: set ? 'prefs.beta' : 'prefs.other', audience: 'workspace' });
	if (mode === 'provider') await signIn(workspace);
	// And the person's own: one on, and the app held out whole on, in one twin only.
	await experiment(set, { experiment: 'prefs.trial', audience: 'person' });
	await experiment(set, { experiment: 'gated.on', audience: 'person' });
	// Citadel's own row, its creator's (D154), and the person's own cap.
	await autonomy({ level: 'project', project: citadel, mode: set ? 'act' : null });
	await autonomy({ level: 'person', cap: set ? 'act' : null });
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
	// The twins differ by what was written: read back as the person reads it, through the shell's own sections.
	for (const [section, key, value] of [
		['loam.rail', 'order', set ? ['prefs', 'probe'] : []],
		[
			'loam.keybindings',
			'overrides',
			set ? [{ command: 'palette-open', keys: 'Mod+Shift+K' }] : [],
		],
		['loam.notifications', 'muted', set ? ['prefs'] : []],
		['loam.limits', 'messageBytes', set ? 2_097_152 : 1_048_576],
		['loam.limits', 'storeBytes', set ? 52_428_800 : 26_214_400],
	] as const) {
		const read = await kernel.call<{ value: unknown }>('setting-get', { section, key });
		expect(read.data?.value, `${section}.${key}`).toEqual(value);
	}
	return Object.assign(workspace, {
		ticks: () => tick,
		level: (to: number) => {
			tick = to;
		},
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
			// And by autonomy: the rows and the cap (step 8).
			const rows = async (held: Twin) =>
				(await held.kernel.call<{ rows: unknown[]; cap: string | null }>('autonomy-list')).data;
			expect(await rows(first)).toMatchObject({ rows: { length: 3 }, cap: 'act' });
			expect(await rows(second)).toMatchObject({ rows: { length: 1 }, cap: null });
			// And by experiments: the workspace's, the person's, and an app held out in one twin alone (step 9).
			const on = async (held: Twin, experiment: string) =>
				(await held.kernel.call<{ on: boolean }>('experiment-check', { experiment })).data?.on;
			for (const id of ['prefs.trial', 'gated.on'])
				expect([await on(first, id), await on(second, id)], id).toEqual([true, false]);
			const forWorkspace = async (held: Twin) =>
				(
					await held.kernel.call<{ experiments: Array<{ workspace: boolean }> }>(
						'experiment-list',
						{
							experiment: 'prefs.beta',
						}
					)
				).data?.experiments[0]?.workspace;
			expect([await forWorkspace(first), await forWorkspace(second)]).toEqual([true, false]);
			const gatedState = async (held: Twin) =>
				(
					await held.kernel.call<{ apps: Array<{ instance: string; state: string }> }>('app-list')
				).data?.apps.find((app) => app.instance === 'gated')?.state;
			expect([await gatedState(first), await gatedState(second)]).toEqual(['ready', 'gated']);
			const commands = first.registries.palette.listCommands();
			// Level from the start: boot reads a held-out app's confirmations, in one twin alone.
			const start = Math.max(first.ticks(), second.ticks());
			first.level(start);
			second.level(start);
			// The app gated in one twin is exempt entirely (section 19's P4-E2): its commands exist in the other alone.
			const exempt = commands.filter((command) => command.name.startsWith('gated-')).length;
			const shell = new Set<string>(SHELL_COMMAND_NAMES);
			let called = 0;
			for (const command of commands) {
				if (NOT_CALLED[command.name] || command.name.startsWith('gated-')) continue;
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
				// The clocks level: the app gated in one twin lists one more row, so a list that reads the clock per row
				// (`palette-search`) moves one twin's further. The sweep compares answers, not how often a clock is read.
				const top = Math.max(first.ticks(), second.ticks());
				first.level(top);
				second.level(top);
				if (command.name === 'auth-sign-out') {
					await signIn(first);
					await signIn(second);
				}
				called += 1;
			}
			expect(exempt).toBe(1);
			expect(called).toBe(commands.length - Object.keys(NOT_CALLED).length - exempt);
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
			'apps/port-refusals.ts': read('../apps/port-refusals.ts'),
			'scope/owners.ts': read('./owners.ts'),
			'identity/auth-gate.ts': read('../identity/auth-gate.ts'),
			// The port's list names the two commands an app may call with the grant, and nothing else of settings.
			'apps/port-callable.ts': read('../apps/port-callable.ts').replace(
				/'setting-(get|list)'|'experiment-check'|grants\.has\('settings'\)/g,
				''
			),
		};
		const identity = read('../identity/identity-commands.ts');
		sources['identity/identity-commands.ts humanRequired'] = identity.slice(
			identity.indexOf('humanRequired(')
		);
		for (const [path, source] of Object.entries(sources)) {
			expect(source.length, path).toBeGreaterThan(0);
			expect(source, path).not.toMatch(
				/setting|SETTING_|loam\.settings|resolveSetting|autonomy|AUTONOMY_|resolveAutonomy|experiment|EXPERIMENT_|experimentOn/i
			);
		}
	});
});
