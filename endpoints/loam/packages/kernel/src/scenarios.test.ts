/**
 * Loam's scenario runner in the kernel's units (phase 4 specification, Jobs and scenarios; phase 5 specification, the
 * same and P5-A1). Each file tagged `loam-runner` runs on a fresh seed from `kernel/scenarios/seeds.ts` (`seed:<name>`,
 * default its phase's: `p4-base` or `p5-base`). Each phase's files stay in its `docs/phases/<phase>/scenarios/`, where
 * phase 5's step 1 left its own, and run from there as their commands are built. The runner and its directives are
 * `kernel/scenarios/runner.ts`, which Chromium's and the desktop's runners share; here its host is the seed's kernel in
 * this process, and `[caller: <instance>, inactive]` opens `console`, the seed's plain app.
 *
 * A file runs once its commands exist: {@link RUNS} names the step that makes each pending file runnable, and a file in
 * neither list fails, so none is skipped by accident.
 */

import { fileURLToPath } from 'node:url';
import type { CommandResult } from '@lushly-dev/afd-core';
import { afterEach, describe, expect, it } from 'vitest';
import { readDirectives } from '../scenarios/directives.js';
import {
	namesTagged,
	readScenario,
	runScenario,
	type ScenarioHost,
	scenarioNames,
	seedOf,
} from '../scenarios/runner.js';
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
 * three settings jobs run; step 5 the inbox and hello's guest book, so its two jobs run; step 8 autonomy, with the
 * second app's reset command, so the three autonomy jobs run; step 6 confirmations, with the reset command's
 * `confirm_prompt`, and the palette's input prompt, so their two jobs run; step 10 the limits, with step 5 merged, so
 * `limit-refuses-call` runs; step 7 the keybindings, so `rebind-a-chord` runs; step 9 the experiments, with hello's
 * `hello.inspector-v2`, so both experiment jobs run. Every phase 4 file runs.
 */
const RUNS_4: Readonly<Record<string, string>> = Object.freeze({
	'setting-per-project': 'now',
	'setting-from-palette': 'now',
	'agent-changes-setting': 'now',
	'autonomy-per-command': 'now',
	'know-my-mode': 'now',
	'owner-ceiling': 'now',
	'opt-into-experiment': 'now',
	'workspace-experiment-opt-out': 'now',
	'decline-confirmation': 'now',
	'palette-prompts-for-input': 'now',
	'inbox-action': 'now',
	'agent-leaves-notice': 'now',
	'rebind-a-chord': 'now',
	'reserved-keys': 'now',
	// Its steps push notices against the fixed rate of `notification-push`, step 5's, which has merged; step 10's own
	// limits are P4-E10's units and Chromium (`late/limits.test.ts`, `web/test/browser/limits.test.ts`).
	'limit-refuses-call': 'now',
});

/**
 * Phase 5's files, by the step that makes each runnable: step 1 ran 6 and 8; step 3 enforcement, the suggestion records
 * and `p5-base`'s apps and rows, so 1 and 5 run; step 4 2 and 7; step 5 3 and 9. The rest wait for the commands, fixtures and taint their steps build
 * (the specification's section 19).
 */
const RUNS: Readonly<Record<string, string>> = Object.freeze({
	'stop-the-copilot': 'now',
	'no-model-configured': 'now',
	'copilot-drives-shell': 'now',
	'copilot-suggests-only': 'now',
	// Step 4's: mailfix mounted, labels and taint, and mounted tools listed.
	'approval-health': 'now',
	'mail-cannot-act-elsewhere': 'now',
	// Step 5's: mounted approvals, with the send's preview and the shell as mailfix's approver.
	'approve-mail-send': 'now',
	'person-sends-mail': 'now',
	// Step 6's: fresh-context units.
	'reply-set-fresh-context': 'now',
	'app-call-needs-grant': "milestone B's amendment: native calls grants",
	'events-since-cursor': "milestone B's amendment: event-list",
});

/** Milestone A's jobs (the specification's "The slice"), the files tagged `slice`: P5-A1's, in every place it names. */
const SLICE_JOBS = [
	'approval-health',
	'approve-mail-send',
	'copilot-drives-shell',
	'copilot-suggests-only',
	'mail-cannot-act-elsewhere',
	'no-model-configured',
	'person-sends-mail',
	'reply-set-fresh-context',
	'stop-the-copilot',
];

async function runFile(
	directory: string,
	file: string,
	fallback: string
): Promise<{ passed: boolean; detail: string }> {
	const scenario = readScenario(directory, file);
	const make = SEEDS[seedOf(scenario, fallback)];
	if (!make) throw new Error(`${file}: no seed '${seedOf(scenario, fallback)}'`);
	seeded = await make();
	const { kernel } = seeded;
	if (scenario.job === 'reserved-keys') kernel.bindShellKeys?.(() => true);
	const options = (scope?: { workspace: 'personal'; project: string }) => (scope ? { scope } : {});
	const host: ScenarioHost = {
		inactiveApp: 'console',
		call: (command, input, scope) => kernel.call(command, input, options(scope)),
		agent: (command, input, scope) => kernel.agent.call(command, input, options(scope)),
		port(instance, command, input, scope) {
			const port = kernel.appPort(instance);
			return (
				scope ? port.surface({ scope }).call(command, input) : port.call(command, input)
			) as Promise<CommandResult<unknown>>;
		},
	};
	return runScenario(scenario, host);
}

let seeded: SeededKernel | undefined;

afterEach(async () => {
	await seeded?.dispose();
	seeded = undefined;
});

/**
 * The exit rows the runner's titles claim. Phase 4's (its section 19): every phase 4 file is P4-E16's, and P4-E4's row
 * names the `autonomy-per-command` and `owner-ceiling` cases as its own too. Phase 5's (its section 18): every file
 * tagged `slice` is P5-A1's, milestone A's jobs; the files of milestone B claim no row until its exit check reads them.
 */
const P4_ROWS_OF: Readonly<Record<string, string>> = Object.freeze({
	'autonomy-per-command': 'P4-E4: ',
	'owner-ceiling': 'P4-E4: ',
});
const SLICE = new Set(namesTagged(PHASE_5, 'slice'));

for (const [phase, directory, runs, fallback, row] of [
	['phase 4', PHASE_4, RUNS_4, 'p4-base', 'P4-E16: '],
	['phase 5', PHASE_5, RUNS, 'p5-base', ''],
] as const) {
	describe(`${row}Loam's runner: ${phase}'s scenarios`, () => {
		it(`${row}knows every file, so none is left out by accident`, () => {
			expect(scenarioNames(directory)).toEqual(Object.keys(runs).sort());
		});

		// P4-E16: "no job was skipped": every phase 4 file runs now, so a file set back to a later step fails here.
		if (row)
			it(`${row}runs every file, none left for a later step`, () => {
				expect(Object.entries(runs).filter(([, when]) => when !== 'now')).toEqual([]);
			});

		for (const name of Object.keys(runs).filter((key) => runs[key] === 'now')) {
			const rows = row ? `${row}${P4_ROWS_OF[name] ?? ''}` : SLICE.has(name) ? 'P5-A1: ' : '';
			it(`${rows}passes ${name}`, async () => {
				const { passed, detail } = await runFile(directory, `${name}.scenario.yaml`, fallback);
				expect(passed, detail).toBe(true);
			}, 30_000);
		}
	});
}

// P5-A1: "every scenario tagged slice passes": the slice is the nine jobs of milestone A (its Jobs and scenarios), each
// running now, so a file tagged `slice` that is set back to a later step, or a job dropped from the slice, fails here.
describe("P5-A1: Loam's runner: phase 5's slice", () => {
	it('P5-A1: tags the nine jobs of milestone A slice, and runs each now', () => {
		expect([...SLICE].sort()).toEqual(SLICE_JOBS);
		expect(SLICE_JOBS.filter((name) => RUNS[name] !== 'now')).toEqual([]);
	});
});

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
