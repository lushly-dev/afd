import { describe, expect, it } from 'vitest';
import {
	collectStreamData,
	consumeStream,
	createCompleteChunk,
	createDataChunk,
	createErrorChunk,
	createProgressChunk,
	createTimeoutController,
	isCompleteChunk,
	isDataChunk,
	isErrorChunk,
	isProgressChunk,
	isStreamableCommand,
	isStreamChunk,
	type StreamCallbacks,
	type StreamChunk,
} from './streaming.js';

describe('createProgressChunk', () => {
	it('creates a progress chunk with basic fields', () => {
		const chunk = createProgressChunk(0.5);

		expect(chunk.type).toBe('progress');
		expect(chunk.progress).toBe(0.5);
	});

	it('clamps progress to 0-1 range', () => {
		expect(createProgressChunk(-0.5).progress).toBe(0);
		expect(createProgressChunk(1.5).progress).toBe(1);
	});

	it('includes optional fields', () => {
		const chunk = createProgressChunk(0.5, {
			message: 'Processing...',
			itemsProcessed: 50,
			itemsTotal: 100,
			estimatedTimeRemainingMs: 5000,
			phase: 'validation',
		});

		expect(chunk.message).toBe('Processing...');
		expect(chunk.itemsProcessed).toBe(50);
		expect(chunk.itemsTotal).toBe(100);
		expect(chunk.estimatedTimeRemainingMs).toBe(5000);
		expect(chunk.phase).toBe('validation');
	});
});

describe('createDataChunk', () => {
	it('creates a data chunk', () => {
		const chunk = createDataChunk({ id: '123', name: 'Test' }, 0, false);

		expect(chunk.type).toBe('data');
		expect(chunk.data).toEqual({ id: '123', name: 'Test' });
		expect(chunk.index).toBe(0);
		expect(chunk.isLast).toBe(false);
	});

	it('includes optional chunk ID', () => {
		const chunk = createDataChunk('text', 5, true, 'chunk-5');

		expect(chunk.chunkId).toBe('chunk-5');
		expect(chunk.isLast).toBe(true);
	});
});

describe('createCompleteChunk', () => {
	it('creates a complete chunk with required fields', () => {
		const chunk = createCompleteChunk(10, 1500);

		expect(chunk.type).toBe('complete');
		expect(chunk.totalChunks).toBe(10);
		expect(chunk.totalDurationMs).toBe(1500);
	});

	it('includes optional fields', () => {
		const chunk = createCompleteChunk(10, 1500, {
			data: { summary: 'Done' },
			confidence: 0.95,
			reasoning: 'All items processed successfully',
			metadata: { traceId: 'abc123' },
		});

		expect(chunk.data).toEqual({ summary: 'Done' });
		expect(chunk.confidence).toBe(0.95);
		expect(chunk.reasoning).toBe('All items processed successfully');
		expect(chunk.metadata?.traceId).toBe('abc123');
	});
});

describe('createErrorChunk', () => {
	it('creates an error chunk', () => {
		const chunk = createErrorChunk(
			{ code: 'EXPORT_FAILED', message: 'Export failed at item 45' },
			44,
			false
		);

		expect(chunk.type).toBe('error');
		expect(chunk.error.code).toBe('EXPORT_FAILED');
		expect(chunk.chunksBeforeError).toBe(44);
		expect(chunk.recoverable).toBe(false);
	});

	it('includes resume position for recoverable errors', () => {
		const chunk = createErrorChunk({ code: 'TIMEOUT', message: 'Timed out' }, 100, true, 100);

		expect(chunk.recoverable).toBe(true);
		expect(chunk.resumeFrom).toBe(100);
	});
});

describe('type guards', () => {
	describe('isProgressChunk', () => {
		it('returns true for progress chunks', () => {
			const chunk = createProgressChunk(0.5);
			expect(isProgressChunk(chunk)).toBe(true);
		});

		it('returns false for other chunk types', () => {
			expect(isProgressChunk(createDataChunk('x', 0, true))).toBe(false);
			expect(isProgressChunk(createCompleteChunk(0, 0))).toBe(false);
		});
	});

	describe('isDataChunk', () => {
		it('returns true for data chunks', () => {
			const chunk = createDataChunk('test', 0, false);
			expect(isDataChunk(chunk)).toBe(true);
		});

		it('returns false for other chunk types', () => {
			expect(isDataChunk(createProgressChunk(0.5))).toBe(false);
		});
	});

	describe('isCompleteChunk', () => {
		it('returns true for complete chunks', () => {
			const chunk = createCompleteChunk(10, 1000);
			expect(isCompleteChunk(chunk)).toBe(true);
		});

		it('returns false for other chunk types', () => {
			expect(isCompleteChunk(createProgressChunk(0.5))).toBe(false);
		});
	});

	describe('isErrorChunk', () => {
		it('returns true for error chunks', () => {
			const chunk = createErrorChunk({ code: 'ERR', message: 'Error' }, 0, false);
			expect(isErrorChunk(chunk)).toBe(true);
		});

		it('returns false for other chunk types', () => {
			expect(isErrorChunk(createCompleteChunk(0, 0))).toBe(false);
		});
	});

	describe('isStreamChunk', () => {
		it('returns true for all valid chunk types', () => {
			expect(isStreamChunk(createProgressChunk(0.5))).toBe(true);
			expect(isStreamChunk(createDataChunk('x', 0, true))).toBe(true);
			expect(isStreamChunk(createCompleteChunk(0, 0))).toBe(true);
			expect(isStreamChunk(createErrorChunk({ code: 'E', message: 'm' }, 0, false))).toBe(true);
		});

		it('returns false for invalid values', () => {
			expect(isStreamChunk(null)).toBe(false);
			expect(isStreamChunk({})).toBe(false);
			expect(isStreamChunk({ type: 'unknown' })).toBe(false);
		});
	});

	describe('isStreamableCommand', () => {
		it('returns true for streamable commands', () => {
			expect(isStreamableCommand({ streamable: true })).toBe(true);
		});

		it('returns false for non-streamable commands', () => {
			expect(isStreamableCommand({ streamable: false })).toBe(false);
			expect(isStreamableCommand({})).toBe(false);
			expect(isStreamableCommand(null)).toBe(false);
		});
	});
});

describe('consumeStream', () => {
	it('calls callbacks for each chunk type', async () => {
		const chunks: StreamChunk<string>[] = [
			createProgressChunk(0.5, { message: 'Halfway' }),
			createDataChunk('data1', 0, false),
			createDataChunk('data2', 1, true),
			createCompleteChunk(2, 100),
		];

		const progressCalls: number[] = [];
		const dataCalls: string[] = [];
		let completeChunk: (typeof chunks)[3] | undefined;

		async function* mockStream(): AsyncGenerator<StreamChunk<string>> {
			for (const chunk of chunks) {
				yield chunk;
			}
		}

		const callbacks: StreamCallbacks<string> = {
			onProgress: (chunk) => progressCalls.push(chunk.progress),
			onData: (chunk) => dataCalls.push(chunk.data),
			onComplete: (chunk) => {
				completeChunk = chunk;
			},
		};

		const result = await consumeStream(mockStream(), callbacks);

		expect(progressCalls).toEqual([0.5]);
		expect(dataCalls).toEqual(['data1', 'data2']);
		expect(completeChunk?.type).toBe('complete');
		expect(result.type).toBe('complete');
	});

	it('handles error chunks', async () => {
		const chunks: StreamChunk<string>[] = [
			createDataChunk('data1', 0, false),
			createErrorChunk({ code: 'ERR', message: 'Failed' }, 1, false),
		];

		let errorChunk: StreamChunk<string> | undefined;

		async function* mockStream(): AsyncGenerator<StreamChunk<string>> {
			for (const chunk of chunks) {
				yield chunk;
			}
		}

		const result = await consumeStream(mockStream(), {
			onError: (chunk) => {
				errorChunk = chunk;
			},
		});

		expect(errorChunk?.type).toBe('error');
		expect(result.type).toBe('error');
	});

	it('creates synthetic error for unexpected stream end', async () => {
		async function* emptyStream(): AsyncGenerator<StreamChunk<string>> {
			// yields nothing
		}

		const result = await consumeStream(emptyStream(), {});

		expect(result.type).toBe('error');
		if (result.type === 'error') {
			expect(result.error.code).toBe('STREAM_ENDED_UNEXPECTEDLY');
		}
	});
});

describe('collectStreamData', () => {
	it('collects all data from stream', async () => {
		async function* mockStream(): AsyncGenerator<StreamChunk<number>> {
			yield createDataChunk(1, 0, false);
			yield createDataChunk(2, 1, false);
			yield createDataChunk(3, 2, true);
			yield createCompleteChunk(3, 100);
		}

		const data = await collectStreamData(mockStream());

		expect(data).toEqual([1, 2, 3]);
	});

	it('throws on error chunk', async () => {
		async function* mockStream(): AsyncGenerator<StreamChunk<number>> {
			yield createDataChunk(1, 0, false);
			yield createErrorChunk({ code: 'ERR', message: 'Stream failed' }, 1, false);
		}

		await expect(collectStreamData(mockStream())).rejects.toThrow('Stream failed');
	});
});

describe('createTimeoutController', () => {
	it('creates an AbortController', () => {
		const controller = createTimeoutController(1000);

		expect(controller).toBeInstanceOf(AbortController);
		expect(controller.signal.aborted).toBe(false);
	});

	it('aborts after timeout', async () => {
		const controller = createTimeoutController(50);

		await new Promise((resolve) => setTimeout(resolve, 100));

		expect(controller.signal.aborted).toBe(true);
	});

	it('can be manually aborted', () => {
		const controller = createTimeoutController(10000);

		controller.abort();

		expect(controller.signal.aborted).toBe(true);
	});
});
