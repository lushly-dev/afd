/**
 * @fileoverview Tests for telemetry middleware
 */

import type { TelemetryEvent, TelemetrySink } from '@lushly-dev/afd-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsoleTelemetrySink, createTelemetryMiddleware } from './middleware.js';

describe('createTelemetryMiddleware', () => {
	let recordedEvents: TelemetryEvent[];
	let mockSink: TelemetrySink;

	beforeEach(() => {
		recordedEvents = [];
		mockSink = {
			record: (event: TelemetryEvent) => {
				recordedEvents.push(event);
			},
		};
	});

	it('records telemetry events for successful commands', async () => {
		const middleware = createTelemetryMiddleware({ sink: mockSink });

		const result = await middleware(
			'test.command',
			{ input: 'data' },
			{ traceId: 'trace-123' },
			async () => ({
				success: true,
				data: { result: 'ok' },
				confidence: 0.95,
				metadata: { commandVersion: '1.0.0' },
			})
		);

		expect(result.success).toBe(true);
		expect(recordedEvents).toHaveLength(1);

		const event = recordedEvents[0];
		if (!event) throw new Error('Expected event');
		expect(event.commandName).toBe('test.command');
		expect(event.success).toBe(true);
		expect(event.traceId).toBe('trace-123');
		expect(event.confidence).toBe(0.95);
		expect(event.durationMs).toBeGreaterThanOrEqual(0);
		expect(event.commandVersion).toBe('1.0.0');
	});

	it('records telemetry events for failed commands', async () => {
		const middleware = createTelemetryMiddleware({ sink: mockSink });

		const result = await middleware('test.command', {}, {}, async () => ({
			success: false,
			error: { code: 'NOT_FOUND', message: 'Item not found' },
		}));

		expect(result.success).toBe(false);
		expect(recordedEvents).toHaveLength(1);

		const event = recordedEvents[0];
		if (!event) throw new Error('Expected event');
		expect(event.success).toBe(false);
		expect(event.error).toEqual({ code: 'NOT_FOUND', message: 'Item not found' });
	});

	it('records telemetry events when command throws', async () => {
		const middleware = createTelemetryMiddleware({ sink: mockSink });

		await expect(
			middleware('test.command', {}, {}, async () => {
				throw new Error('Command failed');
			})
		).rejects.toThrow('Command failed');

		expect(recordedEvents).toHaveLength(1);

		const event = recordedEvents[0];
		if (!event) throw new Error('Expected event');
		expect(event.success).toBe(false);
		expect(event.error).toEqual({
			code: 'UNHANDLED_ERROR',
			message: 'Command failed',
		});
	});

	it('includes input when includeInput is true', async () => {
		const middleware = createTelemetryMiddleware({
			sink: mockSink,
			includeInput: true,
		});

		await middleware('test.command', { secret: 'value' }, {}, async () => ({
			success: true,
			data: {},
		}));

		expect(recordedEvents[0]?.input).toEqual({ secret: 'value' });
	});

	it('excludes input by default', async () => {
		const middleware = createTelemetryMiddleware({ sink: mockSink });

		await middleware('test.command', { secret: 'value' }, {}, async () => ({
			success: true,
			data: {},
		}));

		expect(recordedEvents[0]?.input).toBeUndefined();
	});

	it('excludes metadata when includeMetadata is false', async () => {
		const middleware = createTelemetryMiddleware({
			sink: mockSink,
			includeMetadata: false,
		});

		await middleware('test.command', {}, {}, async () => ({
			success: true,
			data: {},
			metadata: { custom: 'data' },
		}));

		expect(recordedEvents[0]?.metadata).toBeUndefined();
	});

	it('respects filter function', async () => {
		const middleware = createTelemetryMiddleware({
			sink: mockSink,
			filter: (name) => !name.startsWith('internal.'),
		});

		// Should be recorded
		await middleware('public.command', {}, {}, async () => ({
			success: true,
			data: {},
		}));

		// Should be skipped
		await middleware('internal.command', {}, {}, async () => ({
			success: true,
			data: {},
		}));

		expect(recordedEvents).toHaveLength(1);
		expect(recordedEvents[0]?.commandName).toBe('public.command');
	});

	it('handles async sinks', async () => {
		const asyncSink: TelemetrySink = {
			record: async (event: TelemetryEvent) => {
				await new Promise((resolve) => setTimeout(resolve, 10));
				recordedEvents.push(event);
			},
		};

		const middleware = createTelemetryMiddleware({ sink: asyncSink });

		await middleware('test.command', {}, {}, async () => ({
			success: true,
			data: {},
		}));

		// Give time for async record to complete
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(recordedEvents).toHaveLength(1);
	});

	it('silently handles sink errors', async () => {
		const failingSink: TelemetrySink = {
			record: () => {
				throw new Error('Sink failed');
			},
		};

		const middleware = createTelemetryMiddleware({ sink: failingSink });

		// Should not throw
		const result = await middleware('test.command', {}, {}, async () => ({
			success: true,
			data: {},
		}));

		expect(result.success).toBe(true);
	});

	it('silently handles async sink errors', async () => {
		const failingAsyncSink: TelemetrySink = {
			record: async () => {
				throw new Error('Async sink failed');
			},
		};

		const middleware = createTelemetryMiddleware({ sink: failingAsyncSink });

		// Should not throw
		const result = await middleware('test.command', {}, {}, async () => ({
			success: true,
			data: {},
		}));

		expect(result.success).toBe(true);
	});
});

describe('ConsoleTelemetrySink', () => {
	it('logs events in human-readable format by default', () => {
		const logs: string[] = [];
		const sink = new ConsoleTelemetrySink({
			log: (msg) => logs.push(msg),
		});

		sink.record({
			commandName: 'test.command',
			startedAt: '2024-01-15T10:30:00.000Z',
			completedAt: '2024-01-15T10:30:00.150Z',
			durationMs: 150,
			success: true,
		});

		expect(logs).toHaveLength(1);
		expect(logs[0]).toContain('[Telemetry]');
		expect(logs[0]).toContain('test.command');
		expect(logs[0]).toContain('SUCCESS');
		expect(logs[0]).toContain('150ms');
	});

	it('logs events in JSON format when json: true', () => {
		const logs: string[] = [];
		const sink = new ConsoleTelemetrySink({
			log: (msg) => logs.push(msg),
			json: true,
		});

		sink.record({
			commandName: 'test.command',
			startedAt: '2024-01-15T10:30:00.000Z',
			completedAt: '2024-01-15T10:30:00.150Z',
			durationMs: 150,
			success: true,
		});

		expect(logs).toHaveLength(1);
		const log = logs[0];
		if (!log) throw new Error('Expected log entry');
		const parsed = JSON.parse(log);
		expect(parsed.commandName).toBe('test.command');
		expect(parsed.success).toBe(true);
		expect(parsed._prefix).toBe('[Telemetry]');
	});

	it('includes traceId in log output', () => {
		const logs: string[] = [];
		const sink = new ConsoleTelemetrySink({
			log: (msg) => logs.push(msg),
		});

		sink.record({
			commandName: 'test.command',
			startedAt: '2024-01-15T10:30:00.000Z',
			completedAt: '2024-01-15T10:30:00.150Z',
			durationMs: 150,
			success: true,
			traceId: 'trace-abc123',
		});

		expect(logs[0]).toContain('[trace-abc123]');
	});

	it('includes confidence in log output', () => {
		const logs: string[] = [];
		const sink = new ConsoleTelemetrySink({
			log: (msg) => logs.push(msg),
		});

		sink.record({
			commandName: 'test.command',
			startedAt: '2024-01-15T10:30:00.000Z',
			completedAt: '2024-01-15T10:30:00.150Z',
			durationMs: 150,
			success: true,
			confidence: 0.95,
		});

		expect(logs[0]).toContain('confidence: 0.95');
	});

	it('includes error info in log output for failures', () => {
		const logs: string[] = [];
		const sink = new ConsoleTelemetrySink({
			log: (msg) => logs.push(msg),
		});

		sink.record({
			commandName: 'test.command',
			startedAt: '2024-01-15T10:30:00.000Z',
			completedAt: '2024-01-15T10:30:00.150Z',
			durationMs: 150,
			success: false,
			error: { code: 'NOT_FOUND', message: 'Item not found' },
		});

		expect(logs[0]).toContain('FAILURE');
		expect(logs[0]).toContain('NOT_FOUND');
		expect(logs[0]).toContain('Item not found');
	});

	it('uses custom prefix', () => {
		const logs: string[] = [];
		const sink = new ConsoleTelemetrySink({
			log: (msg) => logs.push(msg),
			prefix: '[CMD]',
		});

		sink.record({
			commandName: 'test.command',
			startedAt: '2024-01-15T10:30:00.000Z',
			completedAt: '2024-01-15T10:30:00.150Z',
			durationMs: 150,
			success: true,
		});

		expect(logs[0]).toContain('[CMD]');
		expect(logs[0]).not.toContain('[Telemetry]');
	});

	it('uses default console.log when no log function provided', () => {
		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		const sink = new ConsoleTelemetrySink();
		sink.record({
			commandName: 'test.command',
			startedAt: '2024-01-15T10:30:00.000Z',
			completedAt: '2024-01-15T10:30:00.150Z',
			durationMs: 150,
			success: true,
		});

		expect(consoleSpy).toHaveBeenCalledTimes(1);
		consoleSpy.mockRestore();
	});

	it('flush does nothing (console sink does not buffer)', () => {
		const sink = new ConsoleTelemetrySink();
		// Should not throw
		sink.flush();
	});
});
