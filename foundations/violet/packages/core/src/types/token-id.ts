/**
 * Token id safety helpers.
 *
 * Token ids are dot-separated paths ('color.brand.primary') that exporters turn
 * into nested object keys, DTCG groups and CSS/SCSS variable names. Reserved
 * object-key segments (`__proto__`, `constructor`, `prototype`) and characters
 * that cannot form a CSS name (or empty segments) are refused on write and
 * guarded again when output is built (#1957).
 */

/** Path segments that must never be used as object keys */
const UNSAFE_PATH_SEGMENTS: ReadonlySet<string> = new Set([
	'__proto__',
	'constructor',
	'prototype',
]);

/**
 * Valid dot-separated token id: non-empty segments of letters, digits, `_` and
 * `-` only, so replacing `.` with `-` always yields a safe CSS/SCSS name.
 */
const VALID_TOKEN_ID = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;

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
	if (!VALID_TOKEN_ID.test(tokenId)) {
		return `Token id '${tokenId}' cannot be a CSS name; use non-empty dot-separated segments of letters, digits, '_' and '-' only`;
	}
	return null;
}
