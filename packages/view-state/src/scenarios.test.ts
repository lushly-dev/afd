import { createInProcessExecutor, parseScenarioFile } from '@lushly-dev/afd-testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { createViewStateCommands } from './commands.js';
import { ViewStateRegistry } from './registry.js';
import type { ViewStateHandler } from './types.js';

function createHandler(
	initial: Record<string, unknown>
): ViewStateHandler & { state: Record<string, unknown> } {
	const obj = {
		state: { ...initial },
		get: () => ({ ...obj.state }),
		set: (partial: Partial<Record<string, unknown>>) => {
			Object.assign(obj.state, partial);
		},
	};
	return obj;
}

/**
 * Build a command dispatcher for the view-state commands.
 * Returns a handler function compatible with InProcessExecutor.
 */
function createDispatcher(registry: ViewStateRegistry) {
	const commands = createViewStateCommands(registry);
	const commandMap = new Map(commands.map((c) => [c.name, c]));

	return async (command: string, input?: Record<string, unknown>) => {
		const cmd = commandMap.get(command);
		if (!cmd) {
			throw new Error(`Unknown command: ${command}`);
		}
		return cmd.handler(input ?? {}, {} as never);
	};
}

const SCENARIO_DIR = new URL('../scenarios/', import.meta.url).pathname;

describe('JTBD Scenarios', () => {
	let registry: ViewStateRegistry;

	beforeEach(() => {
		registry = new ViewStateRegistry();
	});

	it('basic-operations: error paths when no states registered', async () => {
		const parsed = await parseScenarioFile(`${SCENARIO_DIR}basic-operations.scenario.yaml`);
		expect(parsed.success).toBe(true);
		if (!parsed.success) return;

		const executor = createInProcessExecutor({
			handler: createDispatcher(registry),
			stopOnFailure: false,
		});

		const result = await executor.execute(parsed.scenario);
		expect(result.outcome).toBe('pass');
		expect(result.passedSteps).toBe(parsed.scenario.steps.length);
		expect(result.failedSteps).toBe(0);
	});

	it('panel-control: agent opens, switches tab, resizes, and closes a panel', async () => {
		registry.register('design-panel', createHandler({ open: false, tab: 'design', width: 320 }));

		const parsed = await parseScenarioFile(`${SCENARIO_DIR}panel-control.scenario.yaml`);
		expect(parsed.success).toBe(true);
		if (!parsed.success) return;

		const executor = createInProcessExecutor({
			handler: createDispatcher(registry),
			stopOnFailure: true,
		});

		const result = await executor.execute(parsed.scenario);
		expect(result.outcome).toBe('pass');
		expect(result.passedSteps).toBe(5);
		expect(result.failedSteps).toBe(0);
	});

	it('undo-round-trip: set then undo restores original state', async () => {
		registry.register('sidebar', createHandler({ collapsed: false, width: 240 }));

		const parsed = await parseScenarioFile(`${SCENARIO_DIR}undo-round-trip.scenario.yaml`);
		expect(parsed.success).toBe(true);
		if (!parsed.success) return;

		const executor = createInProcessExecutor({
			handler: createDispatcher(registry),
			stopOnFailure: true,
		});

		const result = await executor.execute(parsed.scenario);
		expect(result.outcome).toBe('pass');
		expect(result.passedSteps).toBe(4);
		expect(result.failedSteps).toBe(0);
	});

	it('discovery: list and inspect multiple registered states', async () => {
		registry.register('design-panel', createHandler({ open: false, tab: 'design', width: 320 }));
		registry.register('sidebar', createHandler({ collapsed: false, width: 240 }));

		const parsed = await parseScenarioFile(`${SCENARIO_DIR}discovery.scenario.yaml`);
		expect(parsed.success).toBe(true);
		if (!parsed.success) return;

		const executor = createInProcessExecutor({
			handler: createDispatcher(registry),
			stopOnFailure: true,
		});

		const result = await executor.execute(parsed.scenario);
		expect(result.outcome).toBe('pass');
		expect(result.passedSteps).toBe(3);
		expect(result.failedSteps).toBe(0);
	});
});
