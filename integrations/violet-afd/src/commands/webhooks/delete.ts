import { nanoid } from 'nanoid';
import { z } from 'zod';
import { failure, success } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';
import { redactWebhook } from './redact.js';

/**
 * Input schema for webhooks.delete command
 */
export const DeleteWebhookInputSchema = z.object({
	/** Webhook ID */
	id: z.string().min(1, 'Webhook ID is required'),

	/** Require confirmation */
	confirm: z.boolean().default(false),
});

const InputSchema = DeleteWebhookInputSchema;

/**
 * Output schema for webhooks.delete command
 */
const OutputSchema = z.object({
	id: z.string(),
	deleted: z.boolean(),
	deliveriesDeleted: z.number(),
});

type Output = z.infer<typeof OutputSchema>;

/**
 * webhooks.delete command
 *
 * Deletes a webhook and all its delivery history.
 * Requires confirm=true for safety.
 */
export const webhooksDeleteCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'webhooks.delete',
	description: 'Delete a webhook and its delivery history',
	category: 'webhook',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const { db, actor } = context;

		// Parse input to apply defaults
		const input = InputSchema.parse(rawInput);

		// Require explicit confirmation
		if (!input.confirm) {
			return failure({
				code: 'CONFIRMATION_REQUIRED',
				message: 'Deletion requires explicit confirmation',
				suggestion: 'Set confirm=true to delete the webhook and all its delivery history.',
			});
		}

		// Get existing webhook
		const existing = await db.getWebhook(input.id);

		if (!existing) {
			return failure({
				code: 'WEBHOOK_NOT_FOUND',
				message: `Webhook '${input.id}' not found`,
				suggestion:
					'Check the webhook ID and try again. Use webhooks.list to see available webhooks.',
			});
		}

		// Get delivery count before deletion
		const deliveries = await db.listDeliveries({ webhookId: input.id });
		const deliveriesCount = deliveries.length;

		// Delete webhook (this should cascade to deliveries based on implementation)
		await db.deleteWebhook(input.id);

		const now = new Date().toISOString();

		// Log audit event
		await db.addAuditEvent({
			id: nanoid(),
			timestamp: now,
			eventType: 'webhook_deleted',
			actor: actor || 'system',
			targetNode: input.id, // Use webhookId as targetNode
			targetToken: null,
			// Secrets are never written to the audit log
			oldValue: JSON.stringify(redactWebhook(existing)),
			newValue: null,
			metadata: JSON.stringify({
				webhookId: input.id,
				url: existing.url,
				deliveriesDeleted: deliveriesCount,
			}),
		});

		return success(
			{
				id: input.id,
				deleted: true,
				deliveriesDeleted: deliveriesCount,
			},
			{
				reasoning: `Deleted webhook '${input.id}' and ${deliveriesCount} delivery record(s)`,
			},
		);
	},

	examples: [
		{
			description: 'Delete a webhook with confirmation',
			input: { id: 'wh_abc123', confirm: true },
		},
	],
};
