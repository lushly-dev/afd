/**
 * Webhooks module - Event delivery system for Violet Design
 *
 * @module webhooks
 */

export {
	sign,
	verify,
	generateSecret,
	createDeliveryHeaders,
	SIGNATURE_HEADER,
	SIGNATURE_PREFIX,
	type SignOptions,
	type VerifyOptions,
	type VerifyResult,
} from './signer.js';

export {
	ALLOW_PRIVATE_ENV,
	DEV_LOOPBACK_HOSTS,
	assertWebhookUrlSafe,
	classifyBlockedAddress,
	validateWebhookUrl,
	type LookupFn,
	type UrlPolicyOptions,
	type UrlPolicyResult,
} from './url-policy.js';

export {
	WebhookDispatcher,
	type DispatcherOptions,
	type DeliveryResult,
} from './dispatcher.js';
