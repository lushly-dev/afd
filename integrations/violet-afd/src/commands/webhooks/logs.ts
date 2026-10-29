import { z } from 'zod';
import { failure, success } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';
import { safeDeliveryResponse } from './redact.js';

/**
 * Webhook event types as a Zod schema for validation
 */
const WebhookEventTypeSchema = z.enum([
	'token.added',
	'token.updated',
	'token.removed',
	'node.created',
	'node.updated',
	'node.deleted',
	'export.completed',
	'constraint.failed',
	'test.ping',
]);

/**
 * Input schema for webhooks.logs command
 */
export const WebhookLogsInputSchema = z.object({
	/** Webhook ID to get logs for */
	id: z.string().min(1, 'Webhook ID is required'),

	/** Filter by status */
	status: z.enum(['success', 'failed', 'pending']).optional(),

	/** Maximum number of results */
	limit: z.number().int().positive().max(100).default(50),

	/** Offset for pagination */
	offset: z.number().int().min(0).default(0),
});

const InputSchema = WebhookLogsInputSchema;

/**
 * Output schema for webhooks.logs command
 */
const DeliveryLogSchema = z.object({
	id: z.string(),
	eventType: WebhookEventTypeSchema,
	status: z.number().nullable(),
	attempts: z.number(),
	deliveredAt: z.string().optional(),
	createdAt: z.string(),
	nextRetryAt: z.string().optional(),
	response: z.string().optional(),
});

const OutputSchema = z.object({
	webhookId: z.string(),
	logs: z.array(DeliveryLogSchema),
	total: z.number(),
	limit: z.number(),
	offset: z.number(),
	summary: z.object({
		totalDeliveries: z.number(),
		successRate: z.number(),
		avgAttempts: z.number(),
	}),
});

type Output = z.infer<typeof OutputSchema>;

/**
 * webhooks.logs command
 *
 * Returns delivery history for a specific webhook.
 */
export const webhooksLogsCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'webhooks.logs',
	description: 'Get delivery logs for a specific webhook',
	category: 'webhook',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const { db } = context;

		// Parse input to apply defaults
		const input = InputSchema.parse(rawInput);

		// Verify webhook exists
		const webhook = await db.getWebhook(input.id);

		if (!webhook) {
			return failure({
				code: 'WEBHOOK_NOT_FOUND',
				message: `Webhook '${input.id}' not found`,
				suggestion:
					'Check the webhook ID and try again. Use webhooks.list to see available webhooks.',
			});
		}

		// Build filter
		const filter: {
			webhookId: string;
			status?: 'success' | 'failed' | 'pending';
			limit?: number;
		} = {
			webhookId: input.id,
		};

		if (input.status) {
			filter.status = input.status;
		}

		// Get deliveries from database
		const allDeliveries = await db.listDeliveries(filter);

		// Apply pagination
		const total = allDeliveries.length;
		const paginatedDeliveries = allDeliveries.slice(input.offset, input.offset + input.limit);

		// Map to output format
		const logs = paginatedDeliveries.map((d) => ({
			id: d.id,
			eventType: d.eventType,
			status: d.status,
			attempts: d.attempts,
			deliveredAt: d.deliveredAt,
			createdAt: d.createdAt,
			nextRetryAt: d.nextRetryAt,
			response: safeDeliveryResponse(d),
		}));

		// Calculate summary stats
		const successfulDeliveries = allDeliveries.filter(
			(d) => d.status !== null && d.status >= 200 && d.status < 300,
		);
		const totalAttempts = allDeliveries.reduce((sum, d) => sum + d.attempts, 0);

		const summary = {
			totalDeliveries: total,
			successRate: total > 0 ? successfulDeliveries.length / total : 0,
			avgAttempts: total > 0 ? totalAttempts / total : 0,
		};

		return success(
			{
				webhookId: input.id,
				logs,
				total,
				limit: input.limit,
				offset: input.offset,
				summary,
			},
			{
				reasoning: `Retrieved ${logs.length} delivery log(s) for webhook '${input.id}'`,
			},
		);
	},

	examples: [
		{
			description: 'Get all delivery logs for a webhook',
			input: { id: 'wh_abc123' },
		},
		{
			description: 'Get only failed deliveries',
			input: { id: 'wh_abc123', status: 'failed' },
		},
		{
			description: 'Get recent deliveries with pagination',
			input: { id: 'wh_abc123', limit: 10, offset: 0 },
		},
	],
};
