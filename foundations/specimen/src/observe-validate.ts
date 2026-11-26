import { typedError } from './decisions-store.js';
import { designObserveRequestSchema } from './observe-schema.js';
import type { DesignObserveRequest } from './observe-types.js';

/** Validate and normalize a `design-observe` request. */
export function parseDesignObserveRequest(raw: unknown): DesignObserveRequest {
	const parsed = designObserveRequestSchema.safeParse(raw);
	if (!parsed.success) {
		throw typedError(
			'VALIDATION_ERROR',
			`Invalid design-observe request: ${parsed.error.message}`,
			'Provide decision (dec-<12>), journal (file path), and optional beforeJournal.'
		);
	}
	return parsed.data;
}
