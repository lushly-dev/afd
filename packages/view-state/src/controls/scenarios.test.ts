/**
 * @fileoverview The fourteen Controls scenarios, run through `@lushly-dev/afd-testing`.
 *
 * A `controls` fixture adapter, written here and nowhere else, makes a registry from a
 * fixture file into a holder, and the scenario's handler dispatches to the commands made from
 * the registry the holder has (the specification's section 10). In a fixture, `rejects` is an
 * error the control shows while it holds that value, and `moves` is fields another control
 * takes while this one holds that value.
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDirectRegistry, type ZodCommandDefinition } from '@lushly-dev/afd-server';
import {
	type AppAdapter,
	createInProcessExecutor,
	getAdapter,
	parseScenarioFile,
	registerAdapter,
} from '@lushly-dev/afd-testing';
import { describe, expect, it } from 'vitest';
import { createControlCommands } from './commands.js';
import { ControlRegistry } from './registry.js';
import type { ControlState, ControlValue } from './types.js';

/** A control as a fixture file declares it. */
interface FixtureControl extends ControlState {
	id: string;
	rejects?: Record<string, string>;
	moves?: Record<string, Array<{ id: string } & Partial<ControlState>>>;
}

interface ControlsFixture {
	app: 'controls';
	screen?: string;
	command?: string;
	controls: FixtureControl[];
}

/** What the adapter's `apply` fills and the scenario's handler reads. */
const holder: { registry?: ControlRegistry } = {};

/** The key a fixture's `rejects` and `moves` use for a value. */
function keyOf(value: ControlValue): string {
	return typeof value === 'string' ? value : JSON.stringify(value);
}

function isControlsFixture(fixture: unknown): fixture is ControlsFixture {
	return (
		typeof fixture === 'object' &&
		fixture !== null &&
		(fixture as { app?: unknown }).app === 'controls' &&
		Array.isArray((fixture as { controls?: unknown }).controls)
	);
}

/** A registry with one handler for each entry of the fixture's `controls`. */
function registryFrom(fixture: ControlsFixture): ControlRegistry {
	const registry = new ControlRegistry();
	registry.setScreen({ name: fixture.screen, command: fixture.command });
	const values = new Map<string, ControlValue>(
		fixture.controls.map((control) => [control.id, control.value])
	);
	for (const declared of fixture.controls) {
		const { id, rejects, moves: _moves, ...base } = declared;
		registry.register(id, {
			read() {
				const value = values.get(id) as ControlValue;
				const state: ControlState = { ...base, value };
				const rejected = rejects?.[keyOf(value)];
				if (rejected !== undefined) state.error = rejected;
				for (const other of fixture.controls) {
					const held = values.get(other.id) as ControlValue;
					for (const moved of other.moves?.[keyOf(held)] ?? []) {
						if (moved.id === id) {
							const { id: _id, ...fields } = moved;
							Object.assign(state, fields);
						}
					}
				}
				return state;
			},
			write(value) {
				values.set(id, value);
			},
		});
	}
	return registry;
}

const controlsAdapter: AppAdapter = {
	name: 'controls',
	version: '1.0.0',
	cli: { command: 'controls', inputFormat: 'json-arg', outputFormat: 'json' },
	fixture: {
		async apply(fixture) {
			if (!isControlsFixture(fixture)) throw new Error('Not a controls fixture');
			holder.registry = registryFrom(fixture);
			return { appliedCommands: [] };
		},
		async reset() {
			holder.registry = undefined;
		},
		async validate(fixture) {
			return isControlsFixture(fixture)
				? { valid: true }
				: { valid: false, errors: ['A controls fixture has app "controls" and a controls list'] };
		},
	},
	commands: {
		list: () => ['control-list', 'control-set', 'control-restore', 'control-choices'],
	},
	errors: {
		list: () => ['NOT_FOUND', 'FORBIDDEN', 'CONFLICT', 'VALIDATION_ERROR', 'INTERNAL_ERROR'],
	},
	jobs: { list: () => [] },
};

if (!getAdapter(controlsAdapter.name)) registerAdapter(controlsAdapter);

/** Dispatch to the commands made from the holder's registry, validating input as a host does. */
async function dispatch(
	command: string,
	input?: Record<string, unknown>,
	context?: Parameters<ReturnType<typeof createDirectRegistry>['execute']>[2]
) {
	if (!holder.registry) throw new Error('No fixture has been applied');
	const commands = createControlCommands(holder.registry) as ZodCommandDefinition[];
	return createDirectRegistry(commands).execute(command, input ?? {}, context);
}

const SCENARIO_DIR = fileURLToPath(new URL('../../scenarios/controls/', import.meta.url));
const FILES = readdirSync(SCENARIO_DIR)
	.filter((file) => file.endsWith('.scenario.yaml'))
	.sort();

describe('Controls scenarios', () => {
	it('are the fourteen of the specification', () => {
		expect(FILES).toHaveLength(14);
	});

	it.each(FILES)('%s passes', async (file) => {
		holder.registry = undefined;
		const parsed = await parseScenarioFile(`${SCENARIO_DIR}${file}`);
		expect(parsed.success).toBe(true);
		if (!parsed.success) return;

		const executor = createInProcessExecutor({ handler: dispatch, stopOnFailure: true });
		const result = await executor.execute(parsed.scenario);

		const failed = result.stepResults
			.filter((step) => step.outcome !== 'pass')
			.map((step) => ({
				step: step.stepId,
				error: step.error,
				failed: step.assertions.filter((assertion) => !assertion.passed),
			}));
		expect(failed).toEqual([]);
		expect(result.outcome).toBe('pass');
		expect(result.passedSteps).toBe(parsed.scenario.steps.length);
	});
});
