/**
 * Webhook Signer - HMAC-SHA256 signing and verification
 *
 * Follows GitHub webhook signature pattern:
 * - Header: X-Violet-Signature-256
 * - Format: sha256=<hex_digest>
 *
 * @module webhooks/signer
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Signature header name used for webhook deliveries
 */
export const SIGNATURE_HEADER = 'X-Violet-Signature-256';

/**
 * Signature algorithm prefix
 */
export const SIGNATURE_PREFIX = 'sha256=';

/**
 * Options for signature generation
 */
export interface SignOptions {
	/** The webhook secret key */
	secret: string;
	/** The payload to sign (will be JSON stringified if object) */
	payload: string | object;
}

/**
 * Options for signature verification
 */
export interface VerifyOptions {
	/** The webhook secret key */
	secret: string;
	/** The payload that was signed */
	payload: string | object;
	/** The signature to verify (with or without sha256= prefix) */
	signature: string;
}

/**
 * Result of signature verification
 */
export interface VerifyResult {
	/** Whether the signature is valid */
	valid: boolean;
	/** Error message if verification failed */
	error?: string;
}

/**
 * Generates an HMAC-SHA256 signature for a webhook payload
 *
 * @param options - Signing options
 * @returns The signature in format: sha256=<hex_digest>
 *
 * @example
 * ```typescript
 * const signature = sign({
 *   secret: "webhook-secret",
 *   payload: { event: "node.created", data: { id: "xbox" } }
 * });
 * // Returns: "sha256=abc123..."
 * ```
 */
export function sign(options: SignOptions): string {
	const { secret, payload } = options;

	// Normalize payload to string
	const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);

	// Create HMAC-SHA256 signature
	const hmac = createHmac('sha256', secret);
	hmac.update(payloadString, 'utf8');
	const digest = hmac.digest('hex');

	return `${SIGNATURE_PREFIX}${digest}`;
}

/**
 * Verifies an HMAC-SHA256 signature for a webhook payload
 *
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * @param options - Verification options
 * @returns Verification result with validity and optional error
 *
 * @example
 * ```typescript
 * const result = verify({
 *   secret: "webhook-secret",
 *   payload: { event: "node.created", data: { id: "xbox" } },
 *   signature: "sha256=abc123..."
 * });
 *
 * if (result.valid) {
 *   // Process the webhook
 * } else {
 *   // Reject: result.error contains the reason
 * }
 * ```
 */
export function verify(options: VerifyOptions): VerifyResult {
	const { secret, payload, signature } = options;

	// Validate inputs
	if (!secret) {
		return { valid: false, error: 'Missing secret' };
	}

	if (!payload) {
		return { valid: false, error: 'Missing payload' };
	}

	if (!signature) {
		return { valid: false, error: 'Missing signature' };
	}

	// Normalize signature (strip prefix if present)
	const normalizedSignature = signature.startsWith(SIGNATURE_PREFIX)
		? signature
		: `${SIGNATURE_PREFIX}${signature}`;

	// Generate expected signature
	const expectedSignature = sign({ secret, payload });

	// Timing-safe comparison
	try {
		const sigBuffer = Buffer.from(normalizedSignature, 'utf8');
		const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

		// Lengths must match for timingSafeEqual
		if (sigBuffer.length !== expectedBuffer.length) {
			return { valid: false, error: 'Invalid signature' };
		}

		const isValid = timingSafeEqual(sigBuffer, expectedBuffer);

		if (!isValid) {
			return { valid: false, error: 'Invalid signature' };
		}

		return { valid: true };
	} catch {
		return { valid: false, error: 'Signature verification failed' };
	}
}

/**
 * Generates a cryptographically secure random secret
 *
 * @param length - Length of the secret in bytes (default: 32)
 * @returns A hex-encoded random secret
 *
 * @example
 * ```typescript
 * const secret = generateSecret();
 * // Returns: "a1b2c3d4..." (64 hex characters = 32 bytes)
 * ```
 */
export function generateSecret(length = 32): string {
	return randomBytes(length).toString('hex');
}

/**
 * Creates webhook headers for a delivery
 *
 * @param secret - The webhook secret
 * @param payload - The payload being sent
 * @returns Headers object with signature and content type
 *
 * @example
 * ```typescript
 * const headers = createDeliveryHeaders("secret", payload);
 * // Returns: {
 * //   "Content-Type": "application/json",
 * //   "X-Violet-Signature-256": "sha256=...",
 * //   "X-Violet-Event": "node.created",
 * //   "X-Violet-Delivery": "delivery-id"
 * // }
 * ```
 */
export function createDeliveryHeaders(
	secret: string,
	payload: object,
	eventType?: string,
	deliveryId?: string,
): Record<string, string> {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		[SIGNATURE_HEADER]: sign({ secret, payload }),
	};

	if (eventType) {
		headers['X-Violet-Event'] = eventType;
	}

	if (deliveryId) {
		headers['X-Violet-Delivery'] = deliveryId;
	}

	return headers;
}
