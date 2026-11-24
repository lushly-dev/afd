/**
 * `withReadableRecoveries`: what `McpClient` returns from a call, a batch or a pipeline keeps a
 * recovery only when it matches the schema (`spec/recovery.md`, rule 7).
 */
import { describe, expect, it } from 'vitest';
import { withReadableRecoveries } from './result-parsing.js';

const good = { kind: 'call', command: 'todo-list' };
const bad = { kind: 'call', command: 'todo-list', then_retry: true };
const error = (recovery: unknown) => ({
	code: 'NOT_FOUND',
	message: 'm',
	suggestion: 's',
	recovery,
});

describe('withReadableRecoveries', () => {
	it('keeps a readable recovery and drops an unreadable one, keeping the rest', () => {
		expect(withReadableRecoveries({ success: false, error: error(good) })).toEqual({
			success: false,
			error: error(good),
		});
		expect(withReadableRecoveries({ success: false, error: error(bad) })).toEqual({
			success: false,
			error: { code: 'NOT_FOUND', message: 'm', suggestion: 's' },
		});
	});

	it('reads batch items and pipeline steps too', () => {
		const batch = withReadableRecoveries({
			success: true,
			results: [
				{ success: false, error: error(bad) },
				{ success: true, data: 1 },
			],
		});
		expect(batch.results[0]?.error).toEqual({ code: 'NOT_FOUND', message: 'm', suggestion: 's' });
		expect(batch.results[1]).toEqual({ success: true, data: 1 });
		const pipeline = withReadableRecoveries({
			success: false,
			error: error(good),
			steps: [{ index: 0, status: 'failure', error: error(bad) }],
		});
		expect(pipeline.error.recovery).toEqual(good);
		expect(pipeline.steps[0]?.error).toEqual({ code: 'NOT_FOUND', message: 'm', suggestion: 's' });
	});

	it('leaves a result with nothing to read unchanged', () => {
		expect(withReadableRecoveries({ success: true, data: { x: 1 } })).toEqual({
			success: true,
			data: { x: 1 },
		});
		expect(withReadableRecoveries(null)).toBeNull();
	});
});
