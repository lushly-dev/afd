import type { Webhook } from '@lushly-dev/violet-core/types';

/** Placeholder written in place of secrets in audit records */
export const REDACTED = '[REDACTED]';

/**
 * Returns a copy of the webhook that is safe to persist in the audit log or
 * otherwise serialize: the signing secret is replaced with a placeholder.
 */
export function redactWebhook(webhook: Webhook): Webhook {
	return { ...webhook, secret: REDACTED };
}

/** Maximum length of a delivery error string returned to callers */
const MAX_RESPONSE_LENGTH = 200;

/**
 * Delivery `response` is now only a short error string ("HTTP 500", "Request timed
 * out", ...). Older rows may still hold a truncated target response body, so never
 * return anything for 2xx deliveries and cap the length of everything else.
 */
export function safeDeliveryResponse(delivery: {
	status: number | null;
	response?: string;
}): string | undefined {
	if (!delivery.response) return undefined;
	if (delivery.status !== null && delivery.status >= 200 && delivery.status < 300) return undefined;
	return delivery.response.slice(0, MAX_RESPONSE_LENGTH);
}
