import { z } from 'zod';
import { failure, success } from '../../types/command-result.js';
import { WebhookDispatcher } from '../../webhooks/dispatcher.js';
import type { CommandContext, CommandDefinition } from '../registry.js';
import { safeDeliveryResponse } from './redact.js';

/**
 * Input schema for webhooks.test command
 */
export const TestWebhookInputSchema = z.object({
	/** Webhook ID to test */
	id: z.string().min(1, 'Webhook ID is required'),
});

const InputSchema = TestWebhookInputSchema;

/**
 * Output schema for webhooks.test command
 */
const OutputSchema = z.object({
	webhookId: z.string(),
	deliveryId: z.string(),
	status: z.number().nullable(),
	success: z.boolean(),
	responseTime: z.number().nullable(),
	response: z.string().optional(),
});

type Output = z.infer<typeof OutputSchema>;

/**
 * webhooks.test command
 *
 * Sends a test ping to verify webhook connectivity.
 * Creates a delivery record with event type "test.ping".
 */
export const webhooksTestCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'webhooks.test',
	description: 'Send a test ping to verify webhook connectivity',
	category: 'webhook',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const { db } = context;

		// Parse input
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

		// Check if webhook is active
		if (!webhook.active) {
			return failure({
				code: 'WEBHOOK_INACTIVE',
				message: `Webhook '${input.id}' is not active`,
				suggestion: 'Activate the webhook first using webhooks.update with active: true',
			});
		}

		// Send the ping to this webhook only. dispatcher.dispatch() would fan the
		// event out to EVERY active webhook subscribed to test.ping.
		const dispatcher = new WebhookDispatcher({ db });

		// Record start time for response timing
		const startTime = Date.now();

		const pingResult = await dispatcher.sendTestPing(webhook.id);

		const responseTime = Date.now() - startTime;

		if (!pingResult.deliveryId) {
			return failure({
				code: 'DELIVERY_NOT_CREATED',
				message: 'Test delivery was not created',
				suggestion: pingResult.response ?? 'Check the webhook configuration and try again.',
			});
		}

		// Get the delivery record from DB for full details
		const deliveryRecord = await db.getDelivery(pingResult.deliveryId);

		if (!deliveryRecord) {
			return failure({
				code: 'DELIVERY_NOT_FOUND',
				message: 'Could not retrieve delivery record',
				suggestion: 'This may indicate an internal error.',
			});
		}

		const isSuccess =
			deliveryRecord.status !== null && deliveryRecord.status >= 200 && deliveryRecord.status < 300;

		return success(
			{
				webhookId: webhook.id,
				deliveryId: deliveryRecord.id,
				status: deliveryRecord.status,
				success: isSuccess,
				responseTime,
				response: safeDeliveryResponse(deliveryRecord),
			},
			{
				reasoning: isSuccess
					? `Test ping successful (HTTP ${deliveryRecord.status})`
					: `Test ping failed${
							deliveryRecord.status ? ` (HTTP ${deliveryRecord.status})` : ' (no response)'
						}`,
			},
		);
	},

	examples: [
		{
			description: 'Send test ping to a webhook',
			input: { id: 'wh_abc123' },
		},
	],
};
