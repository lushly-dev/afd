import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '../registry.js';
import { webhooksRegisterCommand } from './register.js';

describe('webhooks.register command', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;

	beforeEach(() => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };
	});

	it('should register a webhook with HTTPS URL', async () => {
		const result = await webhooksRegisterCommand.handler(
			{
				url: 'https://example.com/webhook',
				events: ['token.added', 'token.updated'],
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.webhook.id).toMatch(/^wh_/);
		expect(result.data?.webhook.url).toBe('https://example.com/webhook');
		expect(result.data?.webhook.events).toEqual(['token.added', 'token.updated']);
		expect(result.data?.webhook.active).toBe(true);
		expect(result.data?.secret).toBeDefined();
		expect(result.data?.secret?.length).toBeGreaterThanOrEqual(32);
	});

	it('should register a webhook with localhost URL', async () => {
		const result = await webhooksRegisterCommand.handler(
			{
				url: 'http://localhost:3000/webhook',
				events: ['node.created'],
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.webhook.url).toBe('http://localhost:3000/webhook');
	});

	it('should register a webhook with 127.0.0.1 URL', async () => {
		const result = await webhooksRegisterCommand.handler(
			{
				url: 'http://127.0.0.1:8080/webhook',
				events: ['node.created'],
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.webhook.url).toBe('http://127.0.0.1:8080/webhook');
	});

	it('should reject non-HTTPS URL for non-localhost', async () => {
		const result = await webhooksRegisterCommand.handler(
			{
				url: 'http://example.com/webhook',
				events: ['token.added'],
			},
			context,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('VALIDATION_ERROR');
		expect(result.error?.message).toContain('HTTPS');
	});

	it('should use provided secret instead of generating one', async () => {
		const customSecret = 'my-custom-secret-key-123456';
		const result = await webhooksRegisterCommand.handler(
			{
				url: 'https://example.com/webhook',
				events: ['token.added'],
				secret: customSecret,
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.secret).toBe(customSecret);
	});

	it('should reject secret shorter than 16 characters', async () => {
		// Zod validation throws before handler returns
		await expect(
			webhooksRegisterCommand.handler(
				{
					url: 'https://example.com/webhook',
					events: ['token.added'],
					secret: 'short',
				},
				context,
			),
		).rejects.toThrow('Secret must be at least 16 characters');
	});

	it('should register webhook with node filter', async () => {
		const result = await webhooksRegisterCommand.handler(
			{
				url: 'https://example.com/webhook',
				events: ['token.added', 'token.updated'],
				nodeFilter: 'xbox.*',
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.webhook.nodeFilter).toBe('xbox.*');
	});

	it('should register webhook with description', async () => {
		const result = await webhooksRegisterCommand.handler(
			{
				url: 'https://example.com/webhook',
				events: ['token.added'],
				description: 'Xbox design token changes',
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.webhook.description).toBe('Xbox design token changes');
	});

	it('should register webhook as inactive when specified', async () => {
		const result = await webhooksRegisterCommand.handler(
			{
				url: 'https://example.com/webhook',
				events: ['token.added'],
				active: false,
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.webhook.active).toBe(false);
	});

	it('should reject empty events array', async () => {
		// Zod validation throws before handler returns
		await expect(
			webhooksRegisterCommand.handler(
				{
					url: 'https://example.com/webhook',
					events: [],
				},
				context,
			),
		).rejects.toThrow('At least one event type is required');
	});

	it('should store webhook in database', async () => {
		const result = await webhooksRegisterCommand.handler(
			{
				url: 'https://example.com/webhook',
				events: ['token.added'],
			},
			context,
		);

		expect(result.success).toBe(true);
		const webhookId = result.data?.webhook.id;

		// Verify stored in database
		const stored = await db.getWebhook(webhookId!);
		expect(stored).toBeDefined();
		expect(stored?.url).toBe('https://example.com/webhook');
	});

	it('should create audit event for registration', async () => {
		await webhooksRegisterCommand.handler(
			{
				url: 'https://example.com/webhook',
				events: ['token.added'],
			},
			context,
		);

		// Verify audit event was created
		const events = await db.getAuditEvents({});
		const registerEvent = events.find(
			(e: { eventType: string }) => e.eventType === 'webhook_registered',
		);
		expect(registerEvent).toBeDefined();
		expect(registerEvent?.actor).toBe('test');
	});
});
