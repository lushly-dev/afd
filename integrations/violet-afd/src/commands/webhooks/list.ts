import type { WebhookEventType } from '@lushly-dev/violet-core/types';
import { z } from 'zod';
import { success } from '../../types/command-result.js';
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
 * Input schema for webhooks.list command
 */
export const ListWebhooksInputSchema = z.object({
	/** Filter by active status */
	active: z.boolean().optional(),

	/** Filter by event type subscription */
	event: WebhookEventTypeSchema.optional(),

	/** Maximum number of results to return */
	limit: z.number().int().positive().max(100).default(50),

	/** Offset for pagination */
	offset: z.number().int().min(0).default(0),
});

const InputSchema = ListWebhooksInputSchema;

/**
 * Output schema for webhooks.list command
 */
const WebhookSummarySchema = z.object({
	id: z.string(),
	url: z.string(),
	events: z.array(WebhookEventTypeSchema),
	nodeFilter: z.string().optional(),
	description: z.string().optional(),
	active: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

const OutputSchema = z.object({
	webhooks: z.array(WebhookSummarySchema),
	total: z.number(),
	limit: z.number(),
	offset: z.number(),
});

type Output = z.infer<typeof OutputSchema>;

/**
 * webhooks.list command
 *
 * Lists registered webhooks with optional filtering.
 * Note: Secrets are never returned in list operations.
 */
export const webhooksListCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'webhooks.list',
	description: 'List registered webhooks with optional filtering',
	category: 'webhook',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const { db } = context;

		// Parse input to apply defaults
		const input = InputSchema.parse(rawInput);

		// Build filter
		const filter: { active?: boolean; events?: WebhookEventType[] } = {};
		if (input.active !== undefined) {
			filter.active = input.active;
		}
		if (input.event) {
			filter.events = [input.event];
		}

		// Get webhooks from database
		const allWebhooks = await db.listWebhooks(filter);

		// Apply pagination
		const total = allWebhooks.length;
		const paginatedWebhooks = allWebhooks.slice(input.offset, input.offset + input.limit);

		// Map to output format (excluding secret)
		const webhooks = paginatedWebhooks.map((wh) => ({
			id: wh.id,
			url: wh.url,
			events: wh.events,
			nodeFilter: wh.nodeFilter,
			description: wh.description,
			active: wh.active,
			createdAt: wh.createdAt,
			updatedAt: wh.updatedAt,
		}));

		return success(
			{
				webhooks,
				total,
				limit: input.limit,
				offset: input.offset,
			},
			{ reasoning: `Found ${total} webhook(s)` },
		);
	},

	examples: [
		{
			description: 'List all webhooks',
			input: {},
		},
		{
			description: 'List only active webhooks',
			input: { active: true },
		},
		{
			description: 'List webhooks subscribed to token.added events',
			input: { event: 'token.added' },
		},
		{
			description: 'Paginate webhooks',
			input: { limit: 10, offset: 20 },
		},
	],
};
