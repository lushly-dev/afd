/**
 * @fileoverview Job 6: an agent narrows the view through the page's view-state commands, and the
 * page's filter follows. Runs the scenario against `TodoViewState.commands`.
 */

import { fileURLToPath } from 'node:url';
import { InProcessExecutor, parseScenarioFile } from '@lushly-dev/afd-testing';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTER, FILTER_VIEW, listInput, TodoViewState } from './view-state.ts';

const scenario = fileURLToPath(
	new URL('../scenarios/06-narrow-the-view.scenario.yaml', import.meta.url)
);

describe('the page view state', () => {
	it('lets an agent narrow the view and put it back (job 6)', async () => {
		const parsed = await parseScenarioFile(scenario);
		if (!parsed.success) throw new Error(parsed.error);
		const view = new TodoViewState();
		const seen: unknown[] = [];
		view.subscribe((filter) => seen.push(filter));
		const executor = new InProcessExecutor({
			handler: (command, input, context) => view.commands.execute(command, input ?? {}, context),
		});
		const result = await executor.execute(parsed.scenario);
		const failures = result.stepResults
			.filter((step) => step.outcome !== 'pass')
			.map((step) => ({ step: step.stepId, error: step.error }));
		expect(failures).toEqual([]);
		// The page saw the narrowed filter and then the original one
		expect(seen).toEqual([
			{ ...DEFAULT_FILTER, status: 'pending', priority: 'high' },
			DEFAULT_FILTER,
		]);
	});

	it("takes a person's change through the same registry an agent uses", async () => {
		const view = new TodoViewState();
		view.set({ status: 'completed' });
		const read = await view.commands.execute<{ state: unknown }>('view-state-get', {
			id: FILTER_VIEW,
		});
		expect(read.data?.state).toMatchObject({ status: 'completed' });
	});

	it('ignores values the list does not know', async () => {
		const view = new TodoViewState();
		await view.commands.execute('view-state-set', {
			id: FILTER_VIEW,
			state: { status: 'someday', priority: 'urgent' },
		});
		expect(view.current).toEqual(DEFAULT_FILTER);
	});

	it('turns the filter into todo-list input', () => {
		expect(listInput(DEFAULT_FILTER)).toEqual({});
		expect(listInput({ status: 'pending', priority: 'high', search: ' seeds ' })).toEqual({
			completed: false,
			priority: 'high',
			search: 'seeds',
		});
	});
});
