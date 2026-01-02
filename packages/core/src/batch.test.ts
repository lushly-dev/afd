import { describe, expect, it } from 'vitest';
import {
	type BatchCommand,
	type BatchCommandResult,
	type BatchTiming,
	calculateBatchConfidence,
	createBatchRequest,
	createBatchResult,
	createFailedBatchResult,
	isBatchCommand,
	isBatchRequest,
	isBatchResult,
} from './batch.js';
import type { CommandResult } from './result.js';

describe('createBatchRequest', () => {
	it('creates a batch request with commands', () => {
		const request = createBatchRequest([
			{ command: 'todo.create', input: { title: 'Task 1' } },
			{ command: 'todo.create', input: { title: 'Task 2' } },
		]);

		expect(request.commands).toHaveLength(2);
		expect(request.commands[0]?.id).toBe('cmd-0');
		expect(request.commands[0]?.command).toBe('todo.create');
		expect(request.commands[1]?.id).toBe('cmd-1');
	});

	it('preserves custom command IDs', () => {
		const request = createBatchRequest([{ id: 'my-id', command: 'todo.create', input: {} }]);

		expect(request.commands[0]?.id).toBe('my-id');
	});

	it('includes options', () => {
		const request = createBatchRequest([{ command: 'todo.list', input: {} }], {
			stopOnError: true,
			timeout: 5000,
		});

		expect(request.options?.stopOnError).toBe(true);
		expect(request.options?.timeout).toBe(5000);
	});
});

describe('calculateBatchConfidence', () => {
	it('returns 1 for empty batch', () => {
		expect(calculateBatchConfidence([])).toBe(1);
	});

	it('returns 1 for all successful commands with confidence 1', () => {
		const results: BatchCommandResult[] = [
			createMockCommandResult('cmd-0', 0, 'test', true, 1),
			createMockCommandResult('cmd-1', 1, 'test', true, 1),
		];

		expect(calculateBatchConfidence(results)).toBe(1);
	});

	it('returns 0 for all failed commands', () => {
		const results: BatchCommandResult[] = [
			createMockCommandResult('cmd-0', 0, 'test', false),
			createMockCommandResult('cmd-1', 1, 'test', false),
		];

		expect(calculateBatchConfidence(results)).toBe(0);
	});

	it('calculates weighted average for mixed results', () => {
		const results: BatchCommandResult[] = [
			createMockCommandResult('cmd-0', 0, 'test', true, 0.9),
			createMockCommandResult('cmd-1', 1, 'test', false),
		];

		// successRatio = 0.5, avgConfidence = 0.9
		// (0.5 * 0.5) + (0.9 * 0.5) = 0.25 + 0.45 = 0.7
		expect(calculateBatchConfidence(results)).toBe(0.7);
	});

	it('handles missing confidence in successful results', () => {
		const results: BatchCommandResult[] = [
			createMockCommandResult('cmd-0', 0, 'test', true), // undefined confidence = 1
		];

		// successRatio = 1, avgConfidence = 1
		// (1 * 0.5) + (1 * 0.5) = 1
		expect(calculateBatchConfidence(results)).toBe(1);
	});
});

describe('createBatchResult', () => {
	it('creates a successful batch result', () => {
		const results: BatchCommandResult[] = [
			createMockCommandResult('cmd-0', 0, 'todo.create', true, 0.9),
			createMockCommandResult('cmd-1', 1, 'todo.list', true, 1.0),
		];

		const timing: BatchTiming = {
			totalMs: 150,
			averageMs: 75,
			startedAt: '2024-01-01T00:00:00.000Z',
			completedAt: '2024-01-01T00:00:00.150Z',
		};

		const result = createBatchResult(results, timing);

		expect(result.success).toBe(true);
		expect(result.summary.total).toBe(2);
		expect(result.summary.successCount).toBe(2);
		expect(result.summary.failureCount).toBe(0);
		expect(result.timing.totalMs).toBe(150);
		expect(result.confidence).toBeGreaterThan(0.9);
		expect(result.reasoning).toContain('2 commands');
	});

	it('handles partial failures', () => {
		const results: BatchCommandResult[] = [
			createMockCommandResult('cmd-0', 0, 'todo.create', true),
			createMockCommandResult('cmd-1', 1, 'todo.create', false),
		];

		const timing: BatchTiming = {
			totalMs: 100,
			averageMs: 50,
			startedAt: '2024-01-01T00:00:00.000Z',
			completedAt: '2024-01-01T00:00:00.100Z',
		};

		const result = createBatchResult(results, timing);

		expect(result.success).toBe(true); // Partial success semantics
		expect(result.summary.successCount).toBe(1);
		expect(result.summary.failureCount).toBe(1);
		expect(result.reasoning).toContain('1 succeeded');
		expect(result.reasoning).toContain('1 failed');
	});

	it('collects warnings from all commands', () => {
		const results: BatchCommandResult[] = [
			{
				id: 'cmd-0',
				index: 0,
				command: 'test',
				durationMs: 10,
				result: {
					success: true,
					data: {},
					warnings: [{ code: 'WARN1', message: 'Warning 1', severity: 'info' as const }],
				},
			},
			{
				id: 'cmd-1',
				index: 1,
				command: 'test',
				durationMs: 10,
				result: {
					success: true,
					data: {},
					warnings: [{ code: 'WARN2', message: 'Warning 2', severity: 'warning' as const }],
				},
			},
		];

		const timing: BatchTiming = {
			totalMs: 20,
			averageMs: 10,
			startedAt: '2024-01-01T00:00:00.000Z',
			completedAt: '2024-01-01T00:00:00.020Z',
		};

		const result = createBatchResult(results, timing);

		expect(result.warnings).toHaveLength(2);
		expect(result.warnings?.[0]?.commandId).toBe('cmd-0');
		expect(result.warnings?.[1]?.commandId).toBe('cmd-1');
	});
});

describe('createFailedBatchResult', () => {
	it('creates a failed batch result', () => {
		const result = createFailedBatchResult(
			{ code: 'BATCH_ERROR', message: 'Connection lost' },
			{ startedAt: '2024-01-01T00:00:00.000Z' }
		);

		expect(result.success).toBe(false);
		expect(result.results).toHaveLength(0);
		expect(result.summary.total).toBe(0);
		expect(result.confidence).toBe(0);
		expect(result.error?.code).toBe('BATCH_ERROR');
		expect(result.reasoning).toContain('failed');
	});
});

describe('type guards', () => {
	describe('isBatchCommand', () => {
		it('returns true for valid batch command', () => {
			const cmd: BatchCommand = { command: 'test', input: {} };
			expect(isBatchCommand(cmd)).toBe(true);
		});

		it('returns false for invalid objects', () => {
			expect(isBatchCommand(null)).toBe(false);
			expect(isBatchCommand({})).toBe(false);
			expect(isBatchCommand({ name: 'test' })).toBe(false);
		});
	});

	describe('isBatchRequest', () => {
		it('returns true for valid batch request', () => {
			const request = createBatchRequest([{ command: 'test', input: {} }]);
			expect(isBatchRequest(request)).toBe(true);
		});

		it('returns false for invalid objects', () => {
			expect(isBatchRequest(null)).toBe(false);
			expect(isBatchRequest({})).toBe(false);
			expect(isBatchRequest({ commands: 'not array' })).toBe(false);
		});
	});

	describe('isBatchResult', () => {
		it('returns true for valid batch result', () => {
			const result = createBatchResult([], {
				totalMs: 0,
				averageMs: 0,
				startedAt: '',
				completedAt: '',
			});
			expect(isBatchResult(result)).toBe(true);
		});

		it('returns false for invalid objects', () => {
			expect(isBatchResult(null)).toBe(false);
			expect(isBatchResult({ success: true })).toBe(false);
			expect(isBatchResult({ success: true, results: 'not array' })).toBe(false);
		});
	});
});

// Helper to create mock command results
function createMockCommandResult(
	id: string,
	index: number,
	command: string,
	success: boolean,
	confidence?: number
): BatchCommandResult {
	const result: CommandResult<unknown> = success
		? { success: true, data: {}, confidence }
		: { success: false, error: { code: 'ERROR', message: 'Failed' } };

	return {
		id,
		index,
		command,
		result,
		durationMs: 10,
	};
}
