/**
 * Loam's scenario runner (phase 4 specification, Jobs and scenarios; phase 5 specification, the same). Each file
 * tagged `loam-runner` runs on a fresh seed from `kernel/scenarios/seeds.ts` (`seed:<name>`, default `p5-base`).
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
import { SEEDS, type SeededKernel } from '../scenarios/seeds.js';

const PHASE_5 = fileURLToPath(
	new URL('../../../docs/phases/5-copilot/scenarios/', import.meta.url)
);

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

const seedOf = (scenario: Scenario): string =>
	(scenario.tags ?? []).find((tag) => tag.startsWith('seed:'))?.slice('seed:'.length) ?? 'p5-base';

async function runFile(file: string): Promise<{ passed: boolean; detail: string }> {
	const parsed = parseScenarioString(readFileSync(`${PHASE_5}${file}`, 'utf8'), file);
	if (!parsed.success) throw new Error(`${file}: ${parsed.error}`);
	const scenario = parsed.scenario;
	const make = SEEDS[seedOf(scenario)];
	if (!make) throw new Error(`${file}: no seed '${seedOf(scenario)}'`);
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
				if (caller.inactive) await kernel.call('app-open', { instance: 'console' });
				else await kernel.call('app-open', { instance: caller.instance });
				return kernel.appPort(caller.instance).call(command, input) as Promise<CommandResult>;
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

describe("Loam's runner: phase 5's scenarios", () => {
	const files = readdirSync(PHASE_5).filter((name) => name.endsWith('.scenario.yaml'));

	it('knows every file, so none is left out by accident', () => {
		expect(files.map((name) => name.replace('.scenario.yaml', '')).sort()).toEqual(
			Object.keys(RUNS).sort()
		);
	});

	for (const name of Object.keys(RUNS).filter((key) => RUNS[key] === 'now')) {
		it(`passes ${name}`, async () => {
			const { passed, detail } = await runFile(`${name}.scenario.yaml`);
			expect(passed, detail).toBe(true);
		}, 30_000);
	}
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
