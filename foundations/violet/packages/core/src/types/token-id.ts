/**
 * Token id safety helpers.
 *
 * Token ids are dot-separated paths ('color.brand.primary') that exporters turn
 * into nested object keys. A segment such as `__proto__` can therefore reach
 * Object.prototype, so those segments are rejected when ids are stored and
 * skipped again when output is built.
 */

/** Path segments that must never be used as object keys */
const UNSAFE_PATH_SEGMENTS: ReadonlySet<string> = new Set([
	'__proto__',
	'constructor',
	'prototype',
]);

/**
 * True when a single path segment is unsafe to use as an object key.
 */
export function isUnsafePathSegment(segment: string): boolean {
	return UNSAFE_PATH_SEGMENTS.has(segment);
}

/**
 * Returns the first unsafe segment of a dot-separated token id, or null when
 * every segment is safe.
 */
export function findUnsafeTokenIdSegment(tokenId: string): string | null {
	for (const segment of tokenId.split('.')) {
		if (isUnsafePathSegment(segment)) {
			return segment;
		}
	}
	return null;
}

/**
 * Human-readable validation message for a token id, or null when valid.
 */
export function validateTokenId(tokenId: string): string | null {
	const unsafe = findUnsafeTokenIdSegment(tokenId);
	if (unsafe !== null) {
		return `Token id '${tokenId}' contains the reserved path segment '${unsafe}'`;
	}
	return null;
}
