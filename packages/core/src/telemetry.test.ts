import { describe, expect, it } from 'vitest';
import { createTelemetryEvent, isTelemetryEvent, type TelemetryEvent } from './telemetry.js';

describe('createTelemetryEvent', () => {
	it('creates a telemetry event with required fields', () => {
		const event = createTelemetryEvent({
			commandName: 'todo.create',
			startedAt: '2024-01-15T10:30:00.000Z',
			completedAt: '2024-01-15T10:30:00.150Z',
			success: true,
		});

		expect(event.commandName).toBe('todo.create');
		expect(event.startedAt).toBe('2024-01-15T10:30:00.000Z');
		expect(event.completedAt).toBe('2024-01-15T10:30:00.150Z');
		expect(event.durationMs).toBe(150);
		expect(event.success).toBe(true);
	});

	it('uses provided durationMs over calculated value', () => {
		const event = createTelemetryEvent({
			commandName: 'test.cmd',
			startedAt: '2024-01-15T10:30:00.000Z',
			completedAt: '2024-01-15T10:30:00.150Z',
			durationMs: 200, // Explicit override
			success: true,
		});

		expect(event.durationMs).toBe(200);
	});

	it('includes optional fields when provided', () => {
		const event = createTelemetryEvent({
			commandName: 'todo.create',
			startedAt: '2024-01-15T10:30:00.000Z',
			completedAt: '2024-01-15T10:30:00.150Z',
			success: false,
			error: { code: 'NOT_FOUND', message: 'Item not found' },
			traceId: 'trace-abc123',
			confidence: 0.95,
			metadata: { region: 'us-east' },
			input: { title: 'Test' },
			commandVersion: '1.0.0',
		});

		expect(event.error).toEqual({ code: 'NOT_FOUND', message: 'Item not found' });
		expect(event.traceId).toBe('trace-abc123');
		expect(event.confidence).toBe(0.95);
		expect(event.metadata).toEqual({ region: 'us-east' });
		expect(event.input).toEqual({ title: 'Test' });
		expect(event.commandVersion).toBe('1.0.0');
	});

	it('excludes undefined optional fields', () => {
		const event = createTelemetryEvent({
			commandName: 'test.cmd',
			startedAt: '2024-01-15T10:30:00.000Z',
			completedAt: '2024-01-15T10:30:00.100Z',
			success: true,
		});

		expect(event).not.toHaveProperty('error');
		expect(event).not.toHaveProperty('traceId');
		expect(event).not.toHaveProperty('confidence');
		expect(event).not.toHaveProperty('metadata');
		expect(event).not.toHaveProperty('input');
		expect(event).not.toHaveProperty('commandVersion');
	});
});

describe('isTelemetryEvent', () => {
	it('returns true for valid telemetry events', () => {
		const event: TelemetryEvent = {
			commandName: 'test.cmd',
			startedAt: '2024-01-15T10:30:00.000Z',
			completedAt: '2024-01-15T10:30:00.100Z',
			durationMs: 100,
			success: true,
		};

		expect(isTelemetryEvent(event)).toBe(true);
	});

	it('returns true for events with all optional fields', () => {
		const event: TelemetryEvent = {
			commandName: 'test.cmd',
			startedAt: '2024-01-15T10:30:00.000Z',
			completedAt: '2024-01-15T10:30:00.100Z',
			durationMs: 100,
			success: false,
			error: { code: 'ERROR', message: 'Failed' },
			traceId: 'trace-123',
			confidence: 0.5,
			metadata: {},
			input: {},
			commandVersion: '1.0.0',
		};

		expect(isTelemetryEvent(event)).toBe(true);
	});

	it('returns false for null', () => {
		expect(isTelemetryEvent(null)).toBe(false);
	});

	it('returns false for undefined', () => {
		expect(isTelemetryEvent(undefined)).toBe(false);
	});

	it('returns false for non-objects', () => {
		expect(isTelemetryEvent('string')).toBe(false);
		expect(isTelemetryEvent(123)).toBe(false);
		expect(isTelemetryEvent(true)).toBe(false);
	});

	it('returns false when required fields are missing', () => {
		expect(isTelemetryEvent({})).toBe(false);
		expect(isTelemetryEvent({ commandName: 'test' })).toBe(false);
		expect(
			isTelemetryEvent({
				commandName: 'test',
				startedAt: '2024-01-15T10:30:00.000Z',
			})
		).toBe(false);
	});

	it('returns false when required fields have wrong types', () => {
		expect(
			isTelemetryEvent({
				commandName: 123, // should be string
				startedAt: '2024-01-15T10:30:00.000Z',
				completedAt: '2024-01-15T10:30:00.100Z',
				durationMs: 100,
				success: true,
			})
		).toBe(false);

		expect(
			isTelemetryEvent({
				commandName: 'test',
				startedAt: '2024-01-15T10:30:00.000Z',
				completedAt: '2024-01-15T10:30:00.100Z',
				durationMs: '100', // should be number
				success: true,
			})
		).toBe(false);

		expect(
			isTelemetryEvent({
				commandName: 'test',
				startedAt: '2024-01-15T10:30:00.000Z',
				completedAt: '2024-01-15T10:30:00.100Z',
				durationMs: 100,
				success: 'true', // should be boolean
			})
		).toBe(false);
	});
});
