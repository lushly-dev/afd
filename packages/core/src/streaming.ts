/**
 * @fileoverview Streaming types for AFD commands
 *
 * Streaming enables incremental delivery of large results with real-time
 * progress feedback. Commands can emit progress updates, data chunks,
 * and completion/error signals.
 */

import type { CommandError } from './errors.js';
import type { ResultMetadata } from './result.js';

// ═══════════════════════════════════════════════════════════════════════════════
// STREAM CHUNK TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Progress update chunk.
 *
 * Emitted during long-running operations to show progress.
 *
 * @example
 * ```typescript
 * const chunk: ProgressChunk = {
 *   type: 'progress',
 *   progress: 0.45,
 *   message: 'Processing item 45 of 100...',
 *   itemsProcessed: 45,
 *   itemsTotal: 100
 * };
 * ```
 */
export interface ProgressChunk {
	/**
	 * Discriminator for chunk type.
	 */
	type: 'progress';

	/**
	 * Progress percentage (0-1).
	 */
	progress: number;

	/**
	 * Human-readable progress message.
	 */
	message?: string;

	/**
	 * Number of items processed so far.
	 */
	itemsProcessed?: number;

	/**
	 * Total number of items to process.
	 */
	itemsTotal?: number;

	/**
	 * Estimated time remaining in milliseconds.
	 */
	estimatedTimeRemainingMs?: number;

	/**
	 * Current phase or stage of the operation.
	 */
	phase?: string;
}

/**
 * Data chunk containing partial results.
 *
 * Emitted as data becomes available, allowing incremental UI updates.
 *
 * @template T - The type of data in this chunk
 *
 * @example
 * ```typescript
 * const chunk: DataChunk<Todo> = {
 *   type: 'data',
 *   data: { id: 'todo-1', title: 'Buy groceries' },
 *   index: 0,
 *   isLast: false
 * };
 * ```
 */
export interface DataChunk<T = unknown> {
	/**
	 * Discriminator for chunk type.
	 */
	type: 'data';

	/**
	 * The data payload for this chunk.
	 */
	data: T;

	/**
	 * Index of this chunk in the sequence (0-based).
	 */
	index: number;

	/**
	 * Whether this is the last data chunk.
	 */
	isLast: boolean;

	/**
	 * Optional chunk ID for deduplication.
	 */
	chunkId?: string;
}

/**
 * Completion chunk signaling successful stream end.
 *
 * Contains final summary and aggregated metadata.
 *
 * @template T - The type of the complete result data
 *
 * @example
 * ```typescript
 * const chunk: CompleteChunk<ExportResult> = {
 *   type: 'complete',
 *   data: { exportedCount: 100, filename: 'export.csv' },
 *   totalChunks: 100,
 *   totalDurationMs: 5000,
 *   confidence: 0.95
 * };
 * ```
 */
export interface CompleteChunk<T = unknown> {
	/**
	 * Discriminator for chunk type.
	 */
	type: 'complete';

	/**
	 * Final result data (summary or complete result).
	 */
	data?: T;

	/**
	 * Total number of data chunks emitted.
	 */
	totalChunks: number;

	/**
	 * Total duration of the stream in milliseconds.
	 */
	totalDurationMs: number;

	/**
	 * Confidence in the overall result (0-1).
	 */
	confidence?: number;

	/**
	 * Human-readable summary of what was accomplished.
	 */
	reasoning?: string;

	/**
	 * Execution metadata.
	 */
	metadata?: ResultMetadata;
}

/**
 * Error chunk signaling stream failure.
 *
 * May be emitted mid-stream if an error occurs after some data has been sent.
 *
 * @example
 * ```typescript
 * const chunk: ErrorChunk = {
 *   type: 'error',
 *   error: {
 *     code: 'EXPORT_FAILED',
 *     message: 'Failed to export item 45',
 *     suggestion: 'Check the item data and try again'
 *   },
 *   chunksBeforeError: 44,
 *   recoverable: false
 * };
 * ```
 */
export interface ErrorChunk {
	/**
	 * Discriminator for chunk type.
	 */
	type: 'error';

	/**
	 * Error details.
	 */
	error: CommandError;

	/**
	 * Number of chunks successfully emitted before the error.
	 */
	chunksBeforeError: number;

	/**
	 * Whether the stream can be resumed or retried.
	 */
	recoverable: boolean;

	/**
	 * If recoverable, the position to resume from.
	 */
	resumeFrom?: number;
}

/**
 * Union type for all possible stream chunks.
 *
 * Use discriminated union on `type` field to handle each chunk type.
 *
 * @template T - The type of data in data/complete chunks
 *
 * @example
 * ```typescript
 * function handleChunk<T>(chunk: StreamChunk<T>) {
 *   switch (chunk.type) {
 *     case 'progress':
 *       updateProgressBar(chunk.progress);
 *       break;
 *     case 'data':
 *       appendToList(chunk.data);
 *       break;
 *     case 'complete':
 *       showCompletion(chunk.totalChunks);
 *       break;
 *     case 'error':
 *       showError(chunk.error);
 *       break;
 *   }
 * }
 * ```
 */
export type StreamChunk<T = unknown> = ProgressChunk | DataChunk<T> | CompleteChunk<T> | ErrorChunk;

// ═══════════════════════════════════════════════════════════════════════════════
// STREAM OPTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Options for stream execution.
 */
export interface StreamOptions {
	/**
	 * AbortSignal for cancellation support.
	 * When aborted, the stream will emit an error chunk and terminate.
	 */
	signal?: AbortSignal;

	/**
	 * Timeout in milliseconds for the entire stream.
	 */
	timeout?: number;

	/**
	 * Minimum interval between progress updates in milliseconds.
	 * Prevents UI thrashing from too-frequent updates.
	 * @default 100
	 */
	progressThrottleMs?: number;

	/**
	 * Maximum number of data chunks to buffer before backpressure.
	 * @default 100
	 */
	bufferSize?: number;
}

/**
 * Callbacks for stream consumption.
 *
 * @template T - The type of data in data/complete chunks
 */
export interface StreamCallbacks<T = unknown> {
	/**
	 * Called for each progress update.
	 */
	onProgress?: (chunk: ProgressChunk) => void;

	/**
	 * Called for each data chunk.
	 */
	onData?: (chunk: DataChunk<T>) => void;

	/**
	 * Called when the stream completes successfully.
	 */
	onComplete?: (chunk: CompleteChunk<T>) => void;

	/**
	 * Called if the stream encounters an error.
	 */
	onError?: (chunk: ErrorChunk) => void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STREAMABLE COMMAND
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Marker interface for commands that support streaming.
 *
 * Extends the standard CommandDefinition with streaming metadata.
 */
export interface StreamableCommand {
	/**
	 * Indicates this command supports streaming responses.
	 */
	streamable: true;

	/**
	 * Type of data emitted in stream chunks.
	 */
	streamDataType?: string;

	/**
	 * Whether progress updates are emitted.
	 */
	emitsProgress?: boolean;

	/**
	 * Estimated items per second throughput (for progress estimation).
	 */
	estimatedThroughput?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTORY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a progress chunk.
 */
export function createProgressChunk(
	progress: number,
	options?: Omit<ProgressChunk, 'type' | 'progress'>
): ProgressChunk {
	return {
		type: 'progress',
		progress: Math.max(0, Math.min(1, progress)), // Clamp to 0-1
		...options,
	};
}

/**
 * Create a data chunk.
 */
export function createDataChunk<T>(
	data: T,
	index: number,
	isLast: boolean,
	chunkId?: string
): DataChunk<T> {
	return {
		type: 'data',
		data,
		index,
		isLast,
		...(chunkId && { chunkId }),
	};
}

/**
 * Create a completion chunk.
 */
export function createCompleteChunk<T>(
	totalChunks: number,
	totalDurationMs: number,
	options?: Omit<CompleteChunk<T>, 'type' | 'totalChunks' | 'totalDurationMs'>
): CompleteChunk<T> {
	return {
		type: 'complete',
		totalChunks,
		totalDurationMs,
		...options,
	};
}

/**
 * Create an error chunk.
 */
export function createErrorChunk(
	error: CommandError,
	chunksBeforeError: number,
	recoverable = false,
	resumeFrom?: number
): ErrorChunk {
	return {
		type: 'error',
		error,
		chunksBeforeError,
		recoverable,
		...(resumeFrom !== undefined && { resumeFrom }),
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE GUARDS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Type guard for ProgressChunk.
 */
export function isProgressChunk(chunk: StreamChunk): chunk is ProgressChunk {
	return chunk.type === 'progress';
}

/**
 * Type guard for DataChunk.
 */
export function isDataChunk<T>(chunk: StreamChunk<T>): chunk is DataChunk<T> {
	return chunk.type === 'data';
}

/**
 * Type guard for CompleteChunk.
 */
export function isCompleteChunk<T>(chunk: StreamChunk<T>): chunk is CompleteChunk<T> {
	return chunk.type === 'complete';
}

/**
 * Type guard for ErrorChunk.
 */
export function isErrorChunk(chunk: StreamChunk): chunk is ErrorChunk {
	return chunk.type === 'error';
}

/**
 * Type guard to check if any value is a StreamChunk.
 */
export function isStreamChunk(value: unknown): value is StreamChunk {
	return (
		typeof value === 'object' &&
		value !== null &&
		'type' in value &&
		['progress', 'data', 'complete', 'error'].includes((value as StreamChunk).type)
	);
}

/**
 * Type guard to check if a command definition is streamable.
 */
export function isStreamableCommand(command: unknown): command is StreamableCommand {
	return (
		typeof command === 'object' &&
		command !== null &&
		'streamable' in command &&
		(command as StreamableCommand).streamable === true
	);
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Consume a stream with callbacks.
 *
 * @param stream - AsyncGenerator yielding StreamChunks
 * @param callbacks - Handlers for each chunk type
 * @returns Promise that resolves when stream completes
 */
export async function consumeStream<T>(
	stream: AsyncGenerator<StreamChunk<T>, void, unknown>,
	callbacks: StreamCallbacks<T>
): Promise<CompleteChunk<T> | ErrorChunk> {
	let lastChunk: CompleteChunk<T> | ErrorChunk | undefined;

	for await (const chunk of stream) {
		switch (chunk.type) {
			case 'progress':
				callbacks.onProgress?.(chunk);
				break;
			case 'data':
				callbacks.onData?.(chunk);
				break;
			case 'complete':
				callbacks.onComplete?.(chunk);
				lastChunk = chunk;
				break;
			case 'error':
				callbacks.onError?.(chunk);
				lastChunk = chunk;
				break;
		}
	}

	if (!lastChunk) {
		// Stream ended without complete or error - create synthetic error
		lastChunk = createErrorChunk(
			{
				code: 'STREAM_ENDED_UNEXPECTEDLY',
				message: 'Stream ended without completion or error signal',
				suggestion: 'This may indicate a connection issue. Try again.',
				retryable: true,
			},
			0,
			true
		);
	}

	return lastChunk;
}

/**
 * Collect all data from a stream into an array.
 *
 * @param stream - AsyncGenerator yielding StreamChunks
 * @returns Promise resolving to array of all data items
 */
export async function collectStreamData<T>(
	stream: AsyncGenerator<StreamChunk<T>, void, unknown>
): Promise<T[]> {
	const items: T[] = [];

	for await (const chunk of stream) {
		if (chunk.type === 'data') {
			items.push(chunk.data);
		} else if (chunk.type === 'error') {
			throw new Error(chunk.error.message);
		}
	}

	return items;
}

/**
 * Create an AbortController with timeout.
 *
 * @param timeoutMs - Timeout in milliseconds
 * @returns AbortController that will abort after timeout
 */
export function createTimeoutController(timeoutMs: number): AbortController {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => {
		controller.abort(new Error(`Stream timed out after ${timeoutMs}ms`));
	}, timeoutMs);

	// Clear timeout if aborted manually
	controller.signal.addEventListener('abort', () => {
		clearTimeout(timeoutId);
	});

	return controller;
}
