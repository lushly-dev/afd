/**
 * Loam's scenario runner (phase 4 specification, Jobs and scenarios; phase 5 specification, the same). Each file
 * tagged `loam-runner` runs on a fresh seed from `kernel/scenarios/seeds.ts` (`seed:<name>`, default its phase's:
 * `p4-base` or `p5-base`). Each phase's files stay in its `docs/phases/<phase>/scenarios/`, where phase 5's step 1
 * left its own, and run from there as their commands are built.
 * AFD's runner resolves step references and evaluates each step; this file reads each step's directives:
 *
 * - `[agent]`: the agent interface, as `shell-agent` for the person;
 * - `[caller: <instance>]` and `[caller: <instance>, inactive]`: that instance's port;
 * - `[scope: <project id>]`, after any caller: the call's scope.
 *
 * With no caller directive the step is the person's, at the palette. An unknown directive, two callers or a scope
 * before a caller fails the file. A file runs once its commands exist: {@link RUNS} names the step that makes each
 * pending file runnable, and a file in neither list fails, so none is skipped by accident.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CommandResult } from '@lushly-dev/afd-core';
import {
	createInProcessExecutor,
	parseScenarioString,
	type Scenario,
} from '@lushly-dev/afd-testing';
import { afterEach, describe, expect, it } from 'vitest';
import { readDirectives } from '../scenarios/directives.js';
import { P4_PERSON, P4_PROJECTS, P4_SEED, SEEDS, type SeededKernel } from '../scenarios/seeds.js';

const PHASE_4 = fileURLToPath(
	new URL('../../../docs/phases/4-settings/scenarios/', import.meta.url)
);
const PHASE_5 = fileURLToPath(
	new URL('../../../docs/phases/5-copilot/scenarios/', import.meta.url)
);

/**
 * Phase 4's files, by the step that makes each runnable (its section 20). Step 1 built the settings core and
 * `p4-base`; step 2 the settings section, the palette's setting rows, hello's sections and `p4-base`'s apps, so the
 * three settings jobs run; step 8 autonomy, with the second app's reset command, so the three autonomy jobs run. The rest need a
 * later step's commands.
 */
const RUNS_4: Readonly<Record<string, string>> = Object.freeze({
	'setting-per-project': 'now',
	'setting-from-palette': 'now',
	'agent-changes-setting': 'now',
	'autonomy-per-command': 'now',
	'know-my-mode': 'now',
	'owner-ceiling': 'now',
	'opt-into-experiment': "step 9: experiments and hello's `hello.inspector-v2`",
	'workspace-experiment-opt-out': 'step 9: experiments',
	'decline-confirmation':
		"step 6: confirmations, and the second app's command with a `confirm_prompt`",
	'palette-prompts-for-input': "step 6: the palette's input prompt",
	'inbox-action': "steps 5 and 6: the inbox and hello's guest book",
	'agent-leaves-notice': 'step 5: the inbox',
	'rebind-a-chord': 'step 7: keybindings',
	// Its steps push notices: the fixed rate of `notification-push` and `notification-list`, step 5's inbox. Step 10's
	// limits are P4-E10's units and Chromium (`late/limits.test.ts`, `web/test/browser/limits.test.ts`).
	'limit-refuses-call': "step 5: the inbox's `notification-push` and `notification-list`",
});

/**
 * Phase 5's files, by the step that makes each runnable. `now` runs in this step; the rest wait for the commands,
 * fixtures and enforcement their steps build (the specification's section 19).
 */
const RUNS: Readonly<Record<string, string>> = Object.freeze({
	'stop-the-copilot': 'now',
	'no-model-configured': 'now',
	'copilot-drives-shell': "step 3: enforcement, the autonomy rows and phase 4's steps 6 and 8",
	'copilot-suggests-only': 'step 3: suggestion records',
	'approval-health': 'step 3: approval health and confirmations',
	'mail-cannot-act-elsewhere': 'step 4: labels, taint and mounted tools listed',
	'approve-mail-send': 'step 5: mounted approvals',
	'person-sends-mail': 'step 5: mounted approvals and the calls grant',
	'reply-set-fresh-context': 'step 6: units',
	'app-call-needs-grant': "milestone B's amendment: native calls grants",
	'events-since-cursor': "milestone B's amendment: event-list",
});

const seedOf = (scenario: Scenario, fallback: string): string =>
	(scenario.tags ?? []).find((tag) => tag.startsWith('seed:'))?.slice('seed:'.length) ?? fallback;

async function runFile(
	directory: string,
	file: string,
	fallback: string
): Promise<{ passed: boolean; detail: string }> {
	const parsed = parseScenarioString(readFileSync(`${directory}${file}`, 'utf8'), file);
	if (!parsed.success) throw new Error(`${file}: ${parsed.error}`);
	const scenario = parsed.scenario;
	const make = SEEDS[seedOf(scenario, fallback)];
	if (!make) throw new Error(`${file}: no seed '${seedOf(scenario, fallback)}'`);
	const directives = scenario.steps.map((step) => readDirectives(step.description ?? ''));
	seeded = await make();
	const { kernel } = seeded;
	let index = 0;
	const executor = createInProcessExecutor({
		stopOnFailure: true,
		onStepComplete: () => {
			index += 1;
		},
		async handler(command, input): Promise<CommandResult<unknown>> {
			const directive = directives[index] ?? {};
			const scope = directive.scope
				? ({ workspace: 'personal', project: directive.scope } as const)
				: undefined;
			const options = scope ? { scope } : {};
			const caller = directive.caller;
			if (caller && 'agent' in caller) return kernel.agent.call(command, input, options);
			if (caller) {
				// The step's setup: an app that does not open fails the step, rather than run as another (the review's G).
				const opened = await kernel.call('app-open', {
					instance: caller.inactive ? 'console' : caller.instance,
				});
				if (!opened.success) return opened as CommandResult<unknown>;
				const port = kernel.appPort(caller.instance);
				// A scope directive binds the port to that scope, as a surface's port is bound (phase 2 specification, 3.6).
				return (
					scope ? port.surface({ scope }).call(command, input) : port.call(command, input)
				) as Promise<CommandResult>;
			}
			return kernel.call(command, input, options);
		},
	});
	const result = await executor.execute(scenario);
	const failed = result.stepResults.filter((step) => step.outcome !== 'pass');
	return {
		passed: result.outcome === 'pass',
		detail: JSON.stringify(
			failed.map((step) => ({
				step: step.stepId,
				command: step.command,
				assertions: step.assertions.filter((assertion) => !assertion.passed),
				error: step.error,
				actual: step.commandResult,
			})),
			null,
			2
		),
	};
}

let seeded: SeededKernel | undefined;

afterEach(async () => {
	await seeded?.dispose();
	seeded = undefined;
});

for (const [phase, directory, runs, fallback] of [
	['phase 4', PHASE_4, RUNS_4, 'p4-base'],
	['phase 5', PHASE_5, RUNS, 'p5-base'],
] as const) {
	describe(`Loam's runner: ${phase}'s scenarios`, () => {
		const files = readdirSync(directory).filter((name) => name.endsWith('.scenario.yaml'));

		it('knows every file, so none is left out by accident', () => {
			expect(files.map((name) => name.replace('.scenario.yaml', '')).sort()).toEqual(
				Object.keys(runs).sort()
			);
		});

		for (const name of Object.keys(runs).filter((key) => runs[key] === 'now')) {
			it(`passes ${name}`, async () => {
				const { passed, detail } = await runFile(directory, `${name}.scenario.yaml`, fallback);
				expect(passed, detail).toBe(true);
			}, 30_000);
		}
	});
}

describe("Loam's runner: the p4-base seed", () => {
	it('holds a local workspace signed in as its one person, an owner, and Atlas and Beacon by fixed id', async () => {
		seeded = await (SEEDS['p4-base'] as () => Promise<SeededKernel>)();
		const { kernel } = seeded;
		const session = await kernel.call<{ user?: { id: string } }>('auth-session-get');
		expect(session.data?.user?.id).toBe(P4_PERSON);
		const listed = await kernel.call<{
			projects: Array<{ id: string; slug: string; createdBy: string }>;
		}>('project-list');
		expect(
			listed.data?.projects.map(({ id, slug, createdBy }) => ({ id, slug, createdBy }))
		).toEqual(P4_PROJECTS.map(({ id, slug }) => ({ id, slug, createdBy: P4_PERSON })));
		// An owner: a workspace value is theirs to set, in the project the directives name by id.
		const set = await kernel.call('setting-set', {
			section: 'loam.documents',
			key: 'trashDays',
			value: 14,
			level: 'workspace',
		});
		expect(set.success, JSON.stringify(set.error)).toBe(true);
		const scoped = await kernel.call(
			'setting-get',
			{ section: 'loam.documents', key: 'trashDays' },
			{ scope: { workspace: 'personal', project: 'prj_atlas' } }
		);
		expect(scoped.data).toMatchObject({ value: 14, from: 'workspace' });
	});

	it("holds its seed file's apps, enabled for both projects, and its documents and calls' results", async () => {
		seeded = await (SEEDS['p4-base'] as () => Promise<SeededKernel>)();
		const { kernel } = seeded;
		const instances = P4_SEED.apps.map(({ instance }) => instance);
		expect(instances).toHaveLength(4);
		const apps = await kernel.call<{ apps: Array<{ instance: string; state: string }> }>(
			'app-list'
		);
		expect(apps.data?.apps.map(({ instance, state }) => ({ instance, state }))).toEqual(
			instances.map((instance) => ({ instance, state: 'ready' }))
		);
		for (const project of ['prj_atlas', 'prj_beacon']) {
			for (const instance of instances) {
				const opened = await kernel.call(
					'app-open',
					{ instance },
					{ scope: { workspace: 'personal', project } }
				);
				expect(opened.success, `${instance} in ${project}: ${JSON.stringify(opened.error)}`).toBe(
					true
				);
			}
		}
		for (const document of P4_SEED.documents) {
			const read = await kernel.call(
				'document-get',
				{ document: document.id },
				document.project ? { scope: { workspace: 'personal', project: document.project } } : {}
			);
			expect(read.data).toMatchObject({ id: document.id, title: document.title });
		}
		expect(P4_SEED.checks.length).toBeGreaterThan(0);
		for (const check of P4_SEED.checks) {
			const read = await kernel.call(
				check.command,
				check.input,
				check.project ? { scope: { workspace: 'personal', project: check.project } } : {}
			);
			expect(read.data, `${check.command}: ${JSON.stringify(read.error)}`).toMatchObject(
				check.data as object
			);
		}
	});
});

describe("Loam's runner: the directives", () => {
	it('reads a caller, then a scope, and strips them', () => {
		expect(readDirectives('[agent] An agent cannot stop my turn')).toEqual({
			caller: { agent: true },
		});
		expect(readDirectives('[caller: hello, inactive] [scope: prj_atlas] text')).toEqual({
			caller: { instance: 'hello', inactive: true },
			scope: 'prj_atlas',
		});
		expect(readDirectives('No directive')).toEqual({});
	});

	it('fails an unknown directive, two callers, or a scope before a caller', () => {
		expect(() => readDirectives('[agents] x')).toThrow(/unknown directive/);
		expect(() => readDirectives('[agent] [caller: hello] x')).toThrow(/Two caller/);
		expect(() => readDirectives('[scope: prj_atlas] [agent] x')).toThrow(/scope before/);
		expect(() => readDirectives('[caller: hello, active] x')).toThrow(/malformed caller/);
	});
});
