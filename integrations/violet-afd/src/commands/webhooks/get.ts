import { z } from 'zod';
import { failure, success } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';

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
 * Input schema for webhooks.get command
 */
export const GetWebhookInputSchema = z.object({
	/** Webhook ID */
	id: z.string().min(1, 'Webhook ID is required'),

	/** Include delivery statistics */
	includeStats: z.boolean().default(false),
});

const InputSchema = GetWebhookInputSchema;

/**
 * Output schema for webhooks.get command
 */
const WebhookDetailSchema = z.object({
	id: z.string(),
	url: z.string(),
	events: z.array(WebhookEventTypeSchema),
	nodeFilter: z.string().optional(),
	description: z.string().optional(),
	active: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
	// Optional stats
	stats: z
		.object({
			totalDeliveries: z.number(),
			successfulDeliveries: z.number(),
			failedDeliveries: z.number(),
			lastDeliveryAt: z.string().nullable(),
			lastSuccessAt: z.string().nullable(),
		})
		.optional(),
});

const OutputSchema = WebhookDetailSchema;

type Output = z.infer<typeof OutputSchema>;

/**
 * webhooks.get command
 *
 * Gets details of a specific webhook by ID.
 * Note: Secret is never returned.
 */
export const webhooksGetCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'webhooks.get',
	description: 'Get details of a specific webhook by ID',
	category: 'webhook',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const { db } = context;

		// Parse input to apply defaults
		const input = InputSchema.parse(rawInput);

		// Get webhook from database
		const webhook = await db.getWebhook(input.id);

		if (!webhook) {
			return failure({
				code: 'WEBHOOK_NOT_FOUND',
				message: `Webhook '${input.id}' not found`,
				suggestion:
					'Check the webhook ID and try again. Use webhooks.list to see available webhooks.',
			});
		}

		// Build result (excluding secret)
		const result: Output = {
			id: webhook.id,
			url: webhook.url,
			events: webhook.events,
			nodeFilter: webhook.nodeFilter,
			description: webhook.description,
			active: webhook.active,
			createdAt: webhook.createdAt,
			updatedAt: webhook.updatedAt,
		};

		// Include delivery statistics if requested
		if (input.includeStats) {
			const deliveries = await db.listDeliveries({
				webhookId: input.id,
			});

			// Success = HTTP 2xx status code
			const successful = deliveries.filter(
				(d) => d.status !== null && d.status >= 200 && d.status < 300,
			);
			const failed = deliveries.filter(
				(d) => d.status !== null && (d.status < 200 || d.status >= 300),
			);

			// Sort by createdAt to get latest (createdAt is always present)
			const sortedDeliveries = [...deliveries].sort(
				(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
			);
			const sortedSuccessful = [...successful].sort(
				(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
			);
			const latestSuccess = sortedSuccessful.at(0);

			result.stats = {
				totalDeliveries: deliveries.length,
				successfulDeliveries: successful.length,
				failedDeliveries: failed.length,
				lastDeliveryAt: sortedDeliveries.at(0)?.createdAt ?? null,
				lastSuccessAt: latestSuccess?.deliveredAt ?? null,
			};
		}

		return success(result, {
			reasoning: `Retrieved webhook '${webhook.id}'`,
		});
	},

	examples: [
		{
			description: 'Get webhook by ID',
			input: { id: 'wh_abc123' },
		},
		{
			description: 'Get webhook with delivery statistics',
			input: { id: 'wh_abc123', includeStats: true },
		},
	],
};
