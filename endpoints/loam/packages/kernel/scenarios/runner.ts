/**
 * @fileoverview Loam's scenario runner (phase 4 specification, Jobs and scenarios; phase 5 specification, the same and
 * P5-A1), shared by every place that runs the files: the kernel's units in this process (`src/scenarios.test.ts`),
 * Chromium against the built shell (`web/test/browser/scenarios.test.ts`) and the desktop suite
 * (`desktop/test/scenarios.test.ts`). Each place builds the file's seed its own way and gives the runner a
 * {@link ScenarioHost} over its kernel; the runner reads the file and its directives the same way in all three, so a
 * step means the same wherever it runs.
 *
 * AFD's runner resolves step references and evaluates each step; this file reads each step's directives:
 *
 * - `[agent]`: the agent interface, as `shell-agent` for the person;
 * - `[caller: <instance>]` and `[caller: <instance>, inactive]`: that instance's port, after the person opens it, or,
 *   inactive, after the person opens another app, so the caller is neither the active app nor the active tab's owner;
 * - `[scope: <project id>]`, after any caller: the call's scope.
 *
 * With no caller directive the step is the person's, at the palette. An unknown directive, two callers or a scope
 * before a caller fails the file.
 */

import { readdirSync, readFileSync } from 'node:fs';
import type { CommandResult } from '@lushly-dev/afd-core';
import {
	createInProcessExecutor,
	parseScenarioString,
	type Scenario,
} from '@lushly-dev/afd-testing';
import { readDirectives } from './directives.js';

/** A step's scope, from `[scope: <project id>]`. */
export interface ScenarioScope {
	workspace: 'personal';
	project: string;
}

/** One place's kernel, as the runner calls it. Every call answers a `CommandResult`, failures included. */
export interface ScenarioHost {
	/** A step with no caller: the person's call, at the palette. */
	call(command: string, input: unknown, scope?: ScenarioScope): Promise<CommandResult<unknown>>;
	/** `[agent]`: the agent interface, `kernel.agent`, as `shell-agent` for the person. */
	agent(command: string, input: unknown, scope?: ScenarioScope): Promise<CommandResult<unknown>>;
	/** `[caller: <instance>]`: a call through that instance's port, bound to the scope when the step names one. */
	port(
		instance: string,
		command: string,
		input: unknown,
		scope?: ScenarioScope
	): Promise<CommandResult<unknown>>;
	/** The app the person opens for `[caller: <instance>, inactive]`: never the caller. */
	readonly inactiveApp: string;
}

/** A file's scenario, read and parsed; a file that does not parse throws with its name. */
export function readScenario(directory: string, file: string): Scenario {
	const parsed = parseScenarioString(readFileSync(`${directory}${file}`, 'utf8'), file);
	if (!parsed.success) throw new Error(`${file}: ${parsed.error}`);
	return parsed.scenario;
}

/** The seed a file names with its `seed:<name>` tag, else its phase's. */
export const seedOf = (scenario: Scenario, fallback: string): string =>
	(scenario.tags ?? []).find((tag) => tag.startsWith('seed:'))?.slice('seed:'.length) ?? fallback;

/** Every scenario file in a directory, by name without `.scenario.yaml`, sorted. */
export const scenarioNames = (directory: string): string[] =>
	readdirSync(directory)
		.filter((name) => name.endsWith('.scenario.yaml'))
		.map((name) => name.replace('.scenario.yaml', ''))
		.sort();

/** The files a tag names, such as phase 5's `slice` (milestone A's jobs, P5-A1). */
export const namesTagged = (directory: string, tag: string): string[] =>
	scenarioNames(directory).filter((name) =>
		(readScenario(directory, `${name}.scenario.yaml`).tags ?? []).includes(tag)
	);

/** Run one scenario on a host whose seed is in place: whether every step passed, and the failed steps, as JSON. */
export async function runScenario(
	scenario: Scenario,
	host: ScenarioHost
): Promise<{ passed: boolean; detail: string }> {
	const directives = scenario.steps.map((step) => readDirectives(step.description ?? ''));
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
			const caller = directive.caller;
			if (caller && 'agent' in caller) return host.agent(command, input, scope);
			if (caller) {
				// "Inactive" opens another app first; the caller itself cannot be that app, or it would run active.
				if (caller.inactive && caller.instance === host.inactiveApp)
					throw new Error(
						`[caller: ${caller.instance}, inactive] names the app this host opens to make a caller inactive`
					);
				// The step's setup: an app that does not open fails the step, rather than run as another (the review's G).
				const opened = await host.call('app-open', {
					instance: caller.inactive ? host.inactiveApp : caller.instance,
				});
				if (!opened.success) return opened;
				// A scope directive binds the port to that scope, as a surface's port is bound (phase 2 specification, 3.6).
				return host.port(caller.instance, command, input, scope);
			}
			// A person reads the copilot's answer before writing again: a message sent after they answered a confirmation,
			// while the turn it follows still continues (3.5), waits for it, as `COPILOT_TURN_RUNNING`'s retryable
			// suggestion says. Only then, so a file can still assert the code itself.
			if (
				command === 'copilot-message-send' &&
				scenario.steps.slice(0, index).some((step) => step.command === 'notification-act')
			) {
				for (let attempt = 0; ; attempt += 1) {
					const sent = await host.call(command, input, scope);
					if (sent.error?.code !== 'COPILOT_TURN_RUNNING' || attempt >= 200) return sent;
					await new Promise((resolve) => setTimeout(resolve, 10));
				}
			}
			return host.call(command, input, scope);
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
