import type { Webhook } from '@lushly-dev/violet-core/types';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import { generateSecret } from '../../webhooks/signer.js';
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
 * Input schema for webhooks.register command
 */
export const RegisterWebhookInputSchema = z.object({
	/** URL to receive webhook events (must be HTTPS; http only for localhost) */
	url: z.string().url('Invalid URL format'),

	/** Shared secret for signature verification (auto-generated if not provided) */
	secret: z.string().min(16, 'Secret must be at least 16 characters').optional(),

	/** Event types to subscribe to */
	events: z.array(WebhookEventTypeSchema).min(1, 'At least one event type is required'),

	/** Optional node filter pattern (glob-style, e.g., "xbox.*") */
	nodeFilter: z.string().optional(),

	/** Human-readable description */
	description: z.string().max(500).optional(),

	/** Whether the webhook is active (defaults to true) */
	active: z.boolean().default(true),
});

const InputSchema = RegisterWebhookInputSchema;

/**
 * Output schema for webhooks.register command
 */
const OutputSchema = z.object({
	webhook: z.object({
		id: z.string(),
		url: z.string(),
		events: z.array(WebhookEventTypeSchema),
		nodeFilter: z.string().nullable(),
		description: z.string().nullable(),
		active: z.boolean(),
		createdAt: z.string(),
		updatedAt: z.string(),
	}),
	/** The generated or provided secret - ONLY returned on registration */
	secret: z.string(),
});

type Output = z.infer<typeof OutputSchema>;

/**
 * Generates a webhook ID with 'wh_' prefix
 */
function generateWebhookId(): string {
	return `wh_${nanoid(16)}`;
}

/**
 * webhooks.register command
 *
 * Registers a new webhook endpoint to receive design system events.
 * The secret is only returned on initial registration and should be
 * stored securely by the caller.
 */
export const webhooksRegisterCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'webhooks.register',
	description: 'Register a new webhook endpoint to receive design system events',
	category: 'webhook',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const { db, actor } = context;

		// Parse input to apply defaults
		const input = InputSchema.parse(rawInput);

		// Generate webhook ID
		const webhookId = generateWebhookId();

		// Generate secret if not provided
		const secret = input.secret || generateSecret(32);

		// Validate URL (HTTPS, no credentials, no private/internal literal hosts)
		const urlCheck = validateWebhookUrl(input.url);
		if (!urlCheck.ok) {
			return failure({
				code: ErrorCodes.VALIDATION_ERROR,
				message: urlCheck.reason,
				suggestion:
					'Use a public HTTPS URL without credentials (http is only allowed for localhost/127.0.0.1/[::1] in local development)',
			});
		}

		// Create the webhook record
		const now = new Date().toISOString();
		const webhook: Webhook = {
			id: webhookId,
			url: input.url,
			secret,
			events: input.events,
			nodeFilter: input.nodeFilter,
			description: input.description,
			active: input.active,
			createdAt: now,
			updatedAt: now,
		};

		await db.createWebhook(webhook);

		// Log audit event
		await db.addAuditEvent({
			id: nanoid(),
			timestamp: now,
			eventType: 'webhook_registered',
			actor: actor || 'system',
			targetNode: webhookId, // Use webhookId as targetNode
			targetToken: null,
			oldValue: null,
			// The secret is returned only once, to the caller; never persist it in the audit log
			newValue: JSON.stringify(redactWebhook(webhook)),
			metadata: JSON.stringify({
				webhookId,
				url: input.url,
				events: input.events,
				nodeFilter: input.nodeFilter ?? null,
			}),
		});

		return success(
			{
				webhook: {
					id: webhookId,
					url: input.url,
					events: input.events,
					nodeFilter: input.nodeFilter ?? null,
					description: input.description ?? null,
					active: input.active,
					createdAt: now,
					updatedAt: now,
				},
				secret,
			},
			{
				reasoning: `Webhook '${webhookId}' registered successfully. Store the secret securely - it will not be shown again.`,
			},
		);
	},

	examples: [
		{
			description: 'Register a webhook for token changes',
			input: {
				url: 'https://example.com/webhooks/violet',
				events: ['token.added', 'token.updated', 'token.removed'],
			},
		},
		{
			description: 'Register a webhook with node filter',
			input: {
				url: 'https://example.com/webhooks/xbox',
				events: ['token.added', 'token.updated'],
				nodeFilter: 'xbox.*',
				description: 'Xbox design token changes',
			},
		},
		{
			description: 'Register a webhook with custom secret',
			input: {
				url: 'https://example.com/webhooks/all',
				secret: 'my-super-secret-key-123',
				events: [
					'token.added',
					'token.updated',
					'token.removed',
					'node.created',
					'node.updated',
					'node.deleted',
				],
				description: 'All design system events',
			},
		},
	],
};
