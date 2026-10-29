import type { WebhookEventType, WebhookUpdate } from '@lushly-dev/violet-core/types';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { failure, success } from '../../types/command-result.js';
import { validateWebhookUrl } from '../../webhooks/url-policy.js';
import type { CommandContext, CommandDefinition } from '../registry.js';
import { redactWebhook } from './redact.js';

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
 * Input schema for webhooks.update command
 */
export const UpdateWebhookInputSchema = z.object({
	/** Webhook ID */
	id: z.string().min(1, 'Webhook ID is required'),

	/** New URL (must be HTTPS; http only for localhost) */
	url: z.string().url().optional(),

	/** Update event subscriptions */
	events: z.array(WebhookEventTypeSchema).min(1).optional(),

	/** Update node filter pattern (glob); null clears it */
	nodeFilter: z.string().nullable().optional(),

	/** Update description; null clears it */
	description: z.string().nullable().optional(),

	/** Enable or disable webhook */
	active: z.boolean().optional(),

	/** Regenerate secret (returns new secret) */
	regenerateSecret: z.boolean().default(false),
});

const InputSchema = UpdateWebhookInputSchema;

/**
 * Output schema for webhooks.update command
 */
const OutputSchema = z.object({
	id: z.string(),
	url: z.string(),
	events: z.array(WebhookEventTypeSchema),
	nodeFilter: z.string().nullable(),
	description: z.string().nullable(),
	active: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
	/** New secret only returned if regenerateSecret was true */
	secret: z.string().optional(),
});

type Output = z.infer<typeof OutputSchema>;

/**
 * webhooks.update command
 *
 * Updates a webhook's settings. All fields are optional.
 * Use regenerateSecret to get a new signing secret.
 */
export const webhooksUpdateCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'webhooks.update',
	description: "Update a webhook's settings",
	category: 'webhook',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const { db, actor } = context;

		// Parse input to apply defaults
		const input = InputSchema.parse(rawInput);

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

		// Validate new URL if provided
		if (input.url) {
			const urlCheck = validateWebhookUrl(input.url);
			if (!urlCheck.ok) {
				return failure({
					code: 'INVALID_URL',
					message: urlCheck.reason,
					suggestion:
						'Use a public HTTPS URL without credentials (http is only allowed for localhost/127.0.0.1/[::1] in local development).',
				});
			}
		}

		// Build updates object
		const updates: WebhookUpdate = {};

		if (input.url !== undefined) {
			updates.url = input.url;
		}
		if (input.events !== undefined) {
			updates.events = input.events as WebhookEventType[];
		}
		if (input.nodeFilter !== undefined) {
			// null clears the field
			updates.nodeFilter = input.nodeFilter;
		}
		if (input.description !== undefined) {
			// null clears the field
			updates.description = input.description;
		}
		if (input.active !== undefined) {
			updates.active = input.active;
		}

		// Regenerate secret if requested
		let newSecret: string | undefined;
		if (input.regenerateSecret) {
			// Import dynamically to avoid circular dependency
			const { generateSecret } = await import('../../webhooks/signer.js');
			newSecret = generateSecret();
			updates.secret = newSecret;
		}

		// Update webhook
		await db.updateWebhook(input.id, updates);

		// Get the updated webhook
		const updated = await db.getWebhook(input.id);

		if (!updated) {
			return failure({
				code: 'UPDATE_FAILED',
				message: `Failed to update webhook '${input.id}'`,
				suggestion: 'Please try again. If the problem persists, contact support.',
			});
		}

		const now = new Date().toISOString();

		// Log audit event
		await db.addAuditEvent({
			id: nanoid(),
			timestamp: now,
			eventType: 'webhook_updated',
			actor: actor || 'system',
			targetNode: input.id, // Use webhookId as targetNode
			targetToken: null,
			// Secrets are never written to the audit log
			oldValue: JSON.stringify(redactWebhook(existing)),
			newValue: JSON.stringify(redactWebhook(updated)),
			metadata: JSON.stringify({
				webhookId: input.id,
				changes: Object.keys(updates),
				secretRegenerated: input.regenerateSecret,
			}),
		});

		// Build result
		const result: Output = {
			id: updated.id,
			url: updated.url,
			events: updated.events,
			nodeFilter: updated.nodeFilter ?? null,
			description: updated.description ?? null,
			active: updated.active,
			createdAt: updated.createdAt,
			updatedAt: updated.updatedAt,
		};

		// Only include secret if regenerated
		if (newSecret) {
			result.secret = newSecret;
		}

		const changes: string[] = [];
		if (input.url) changes.push('URL');
		if (input.events) changes.push('events');
		if (input.nodeFilter !== undefined) changes.push('node filter');
		if (input.description !== undefined) changes.push('description');
		if (input.active !== undefined) changes.push(`active=${input.active}`);
		if (input.regenerateSecret) changes.push('secret (regenerated)');

		return success(result, {
			reasoning: `Updated webhook '${input.id}': ${changes.join(', ')}`,
		});
	},

	examples: [
		{
			description: 'Update webhook URL',
			input: { id: 'wh_abc123', url: 'https://new-endpoint.example.com/hooks' },
		},
		{
			description: 'Disable a webhook',
			input: { id: 'wh_abc123', active: false },
		},
		{
			description: 'Update event subscriptions',
			input: { id: 'wh_abc123', events: ['token.added', 'token.updated'] },
		},
		{
			description: 'Regenerate webhook secret',
			input: { id: 'wh_abc123', regenerateSecret: true },
		},
	],
};
