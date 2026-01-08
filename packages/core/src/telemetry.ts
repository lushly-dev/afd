/**
 * @fileoverview Telemetry types for AFD command execution tracking
 *
 * This module provides interfaces for capturing and storing telemetry data
 * about command executions, enabling monitoring, debugging, and analytics.
 */

import type { CommandError } from './errors.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TELEMETRY EVENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Telemetry event representing a single command execution.
 *
 * Contains all relevant information about the command invocation,
 * including timing, outcome, and optional context.
 *
 * @example
 * ```typescript
 * const event: TelemetryEvent = {
 *   commandName: 'todo.create',
 *   startedAt: '2024-01-15T10:30:00.000Z',
 *   completedAt: '2024-01-15T10:30:00.150Z',
 *   durationMs: 150,
 *   success: true,
 *   traceId: 'trace-abc123',
 * };
 * ```
 */
export interface TelemetryEvent {
	/** Name of the command that was executed */
	commandName: string;

	/** ISO timestamp when command execution started */
	startedAt: string;

	/** ISO timestamp when command execution completed */
	completedAt: string;

	/** Duration of execution in milliseconds */
	durationMs: number;

	/** Whether the command executed successfully */
	success: boolean;

	/** Error details if the command failed */
	error?: CommandError;

	/** Trace ID for correlating related events */
	traceId?: string;

	/** Confidence score from the result (0-1), if provided */
	confidence?: number;

	/** Additional metadata from the command result */
	metadata?: Record<string, unknown>;

	/** Input provided to the command (optional, may be redacted for security) */
	input?: unknown;

	/** Command version that was executed */
	commandVersion?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TELEMETRY SINK
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Interface for pluggable telemetry storage backends.
 *
 * Implement this interface to send telemetry events to your preferred
 * storage or monitoring system (console, file, database, cloud service, etc.).
 *
 * @example
 * ```typescript
 * // Custom sink that sends to a monitoring service
 * const monitoringSink: TelemetrySink = {
 *   async record(event) {
 *     await fetch('https://monitoring.example.com/events', {
 *       method: 'POST',
 *       body: JSON.stringify(event),
 *     });
 *   },
 *   async flush() {
 *     // Ensure all pending events are sent
 *   },
 * };
 * ```
 */
export interface TelemetrySink {
	/**
	 * Record a telemetry event.
	 *
	 * This method should be non-blocking when possible.
	 * Errors should be handled internally (log and continue).
	 *
	 * @param event - The telemetry event to record
	 */
	record(event: TelemetryEvent): void | Promise<void>;

	/**
	 * Flush any pending events to storage.
	 *
	 * Called during graceful shutdown to ensure all events are persisted.
	 * Optional - implement only if your sink buffers events.
	 */
	flush?(): void | Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a telemetry event from command execution data.
 *
 * @param data - Partial event data (at minimum: commandName, startedAt, completedAt, success)
 * @returns A complete TelemetryEvent
 */
export function createTelemetryEvent(
	data: Pick<TelemetryEvent, 'commandName' | 'startedAt' | 'completedAt' | 'success'> &
		Partial<TelemetryEvent>
): TelemetryEvent {
	const startTime = new Date(data.startedAt).getTime();
	const endTime = new Date(data.completedAt).getTime();

	return {
		commandName: data.commandName,
		startedAt: data.startedAt,
		completedAt: data.completedAt,
		durationMs: data.durationMs ?? endTime - startTime,
		success: data.success,
		...(data.error !== undefined && { error: data.error }),
		...(data.traceId !== undefined && { traceId: data.traceId }),
		...(data.confidence !== undefined && { confidence: data.confidence }),
		...(data.metadata !== undefined && { metadata: data.metadata }),
		...(data.input !== undefined && { input: data.input }),
		...(data.commandVersion !== undefined && { commandVersion: data.commandVersion }),
	};
}

/**
 * Type guard to check if an object is a valid TelemetryEvent.
 */
export function isTelemetryEvent(value: unknown): value is TelemetryEvent {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const event = value as Record<string, unknown>;
	return (
		typeof event.commandName === 'string' &&
		typeof event.startedAt === 'string' &&
		typeof event.completedAt === 'string' &&
		typeof event.durationMs === 'number' &&
		typeof event.success === 'boolean'
	);
}
