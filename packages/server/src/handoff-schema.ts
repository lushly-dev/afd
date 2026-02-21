/**
 * @fileoverview Zod schemas for handoff types
 *
 * These schemas provide runtime validation for HandoffResult and related types.
 * Use these when defining handoff commands or validating handoff data.
 */

import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════════
// ZOD SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Zod schema for HandoffCredentials.
 *
 * @example
 * ```typescript
 * const credentials = HandoffCredentialsSchema.parse({
 *   token: 'abc123',
 *   sessionId: 'session-xyz'
 * });
 * ```
 */
export const HandoffCredentialsSchema = z.object({
	/** Bearer token for authentication */
	token: z.string().optional(),
	/** Additional headers to include */
	headers: z.record(z.string()).optional(),
	/** Session ID for correlation */
	sessionId: z.string().optional(),
});

/**
 * Zod schema for HandoffMetadata.
 *
 * @example
 * ```typescript
 * const metadata = HandoffMetadataSchema.parse({
 *   capabilities: ['text', 'presence'],
 *   reconnect: { allowed: true, maxAttempts: 5 }
 * });
 * ```
 */
export const HandoffMetadataSchema = z.object({
	/** Expected latency in ms (hint for client) */
	expectedLatency: z.number().optional(),
	/** Capabilities the channel supports */
	capabilities: z.array(z.string()).optional(),
	/** When the handoff credentials expire (ISO 8601) */
	expiresAt: z.string().datetime().optional(),
	/** Reconnection policy */
	reconnect: z
		.object({
			/** Whether reconnection is allowed */
			allowed: z.boolean(),
			/** Maximum number of reconnection attempts */
			maxAttempts: z.number().optional(),
			/** Base backoff time in milliseconds */
			backoffMs: z.number().optional(),
		})
		.optional(),
	/** Human-readable description of the handoff */
	description: z.string().optional(),
});

/**
 * Zod schema for HandoffResult.
 *
 * Use this as the outputSchema for handoff commands.
 *
 * @example
 * ```typescript
 * import { defineCommand } from '@lushly-dev/afd-server';
 *
 * const connectChat = defineCommand({
 *   name: 'chat-connect',
 *   description: 'Connect to a chat room',
 *   handoff: true,
 *   input: z.object({ roomId: z.string() }),
 *   outputSchema: HandoffResultSchema,
 *   async handler(input, ctx) {
 *     return success({
 *       protocol: 'websocket',
 *       endpoint: `wss://chat.example.com/rooms/${input.roomId}`,
 *       credentials: { token: ctx.session.token }
 *     });
 *   }
 * });
 * ```
 */
export const HandoffResultSchema = z.object({
	/** Protocol type for client dispatch */
	protocol: z.string(),
	/** Full URL to connect to */
	endpoint: z.string().url(),
	/** Authentication credentials for the handoff */
	credentials: HandoffCredentialsSchema.optional(),
	/** Metadata for client decision-making */
	metadata: HandoffMetadataSchema.optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// INFERRED TYPES (for type-safe usage)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Inferred type from HandoffCredentialsSchema.
 * Matches the HandoffCredentials interface in @lushly-dev/afd-core.
 */
export type HandoffCredentialsInput = z.input<typeof HandoffCredentialsSchema>;
export type HandoffCredentialsOutput = z.output<typeof HandoffCredentialsSchema>;

/**
 * Inferred type from HandoffMetadataSchema.
 * Matches the HandoffMetadata interface in @lushly-dev/afd-core.
 */
export type HandoffMetadataInput = z.input<typeof HandoffMetadataSchema>;
export type HandoffMetadataOutput = z.output<typeof HandoffMetadataSchema>;

/**
 * Inferred type from HandoffResultSchema.
 * Matches the HandoffResult interface in @lushly-dev/afd-core.
 */
export type HandoffResultInput = z.input<typeof HandoffResultSchema>;
export type HandoffResultOutput = z.output<typeof HandoffResultSchema>;
