import { failure, success } from '@lushly-dev/afd-core/result';
import { describe, expect, it, vi } from 'vitest';
import {
	AFD_PLUGIN_ID,
	AFD_RUNNER_ID,
	type AfdCallableElement,
	afdRunner,
	createAfdCommandRunner,
	isCommandResult,
} from './index.js';

function fakeElement(
	overrides: Partial<AfdCallableElement> & { localName?: string } = {}
): Element {
	return {
		localName: overrides.localName ?? 'notes-app',
		...overrides,
	} as unknown as Element;
}

describe('createAfdCommandRunner', () => {
	it('registers runner and job driver under afd by default', () => {
		const plugin = afdRunner();
		expect(plugin.id).toBe(AFD_PLUGIN_ID);
		expect(plugin.version).toMatch(/^\d+\.\d+\.\d+/);
		expect(Object.keys(plugin.runners ?? {})).toEqual([AFD_RUNNER_ID]);
		expect(Object.keys(plugin.jobDrivers ?? {})).toEqual([AFD_RUNNER_ID]);
	});

	it('supports custom plugin and runner ids', () => {
		const plugin = afdRunner({ id: 'custom-afd', runner: 'app-afd' });
		expect(plugin.id).toBe('custom-afd');
		expect(Object.keys(plugin.runners ?? {})).toEqual(['app-afd']);
		expect(Object.keys(plugin.jobDrivers ?? {})).toEqual(['app-afd']);
	});

	it('dispatches explicit commands through element.call(name, input)', async () => {
		const call = vi.fn(async (name: string, input?: Record<string, unknown>) =>
			success({ name, input })
		);
		const runner = createAfdCommandRunner();
		const result = await runner.run(fakeElement({ call }), 'note-create', { title: 'Draft' });

		expect(call).toHaveBeenCalledWith('note-create', { title: 'Draft' });
		expect(result).toEqual(success({ name: 'note-create', input: { title: 'Draft' } }));
	});

	it('normalizes undefined and null input to an empty object', async () => {
		const call = vi.fn(() => success({ ok: true }));
		const runner = createAfdCommandRunner();

		await runner.run(fakeElement({ call }), 'note-list', undefined);
		await runner.run(fakeElement({ call }), 'note-list', null);

		expect(call).toHaveBeenNthCalledWith(1, 'note-list', {});
		expect(call).toHaveBeenNthCalledWith(2, 'note-list', {});
	});

	it('returns structured AFD failure results intact without throwing', async () => {
		const errResult = failure({
			code: 'NOTE_NOT_FOUND',
			message: 'Missing note',
			suggestion: 'Create a note first.',
		});
		const runner = createAfdCommandRunner();
		const result = await runner.run(fakeElement({ call: () => errResult }), 'note-open', {
			id: 'missing',
		});

		expect(result).toEqual(errResult);
	});

	it('rejects non-object command inputs, empty command names, missing call, and non-CommandResult returns', async () => {
		const runner = createAfdCommandRunner();

		await expect(runner.run(fakeElement({ call: () => success({}) }), '   ', {})).rejects.toThrow(
			/non-empty string/
		);

		await expect(runner.run(fakeElement(), 'note-open', {})).rejects.toThrow(
			/does not expose a call\(name, input\)/
		);

		await expect(
			runner.run(fakeElement({ call: () => success({}) }), 'note-open', ['bad'])
		).rejects.toThrow(/expects an object input, received array/);

		await expect(
			runner.run(fakeElement({ call: () => success({}) }), 'note-open', 'bad')
		).rejects.toThrow(/expects an object input, received string/);

		await expect(
			runner.run(fakeElement({ call: () => ({ ok: true }) }), 'note-open', {})
		).rejects.toThrow(/did not return a structured CommandResult/);

		await expect(
			runner.run(fakeElement({ call: () => ({ success: false, error: 42 }) }), 'note-open', {})
		).rejects.toThrow(/did not return a structured CommandResult/);
	});

	it('reports declared element commands from an array or function', () => {
		const runner = createAfdCommandRunner();

		expect(runner.commands?.(fakeElement({ commands: ['note-create', 'note-open'] }))).toEqual([
			'note-create',
			'note-open',
		]);
		expect(runner.commands?.(fakeElement({ commands: () => ['note-seed'] }))).toEqual([
			'note-seed',
		]);
		expect(runner.commands?.(fakeElement())).toBeUndefined();
		expect(
			runner.commands?.(fakeElement({ commands: ['ok', 42 as unknown as string] }))
		).toBeUndefined();
	});

	it('validates CommandResult shapes accurately against spec/schema/result.json', () => {
		expect(isCommandResult({ success: true })).toBe(true);
		expect(isCommandResult({ success: true, data: { id: '1' } })).toBe(true);
		expect(isCommandResult({ success: false, error: { code: 'E', message: 'm' } })).toBe(true);
		expect(isCommandResult(null)).toBe(false);
		expect(isCommandResult([])).toBe(false);
		expect(isCommandResult({ success: 'yes' })).toBe(false);
		expect(isCommandResult({ success: false })).toBe(false);
		expect(isCommandResult({ success: false, error: 42 })).toBe(false);
		expect(isCommandResult({ success: false, error: { code: '', message: 'm' } })).toBe(false);
		expect(isCommandResult({ success: false, error: { code: 'E', message: 'm' }, data: {} })).toBe(
			false
		);
		expect(isCommandResult({ success: true, error: { code: 'E', message: 'm' } })).toBe(false);
	});
});
