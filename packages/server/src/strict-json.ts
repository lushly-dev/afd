/**
 * @fileoverview JSON with unique member names (RFC 7515 4, RFC 7519 4): a JOSE header or claims
 * set that repeats a name is refused, never read as its last value, as `JSON.parse` would.
 */

/**
 * Whether valid JSON `text` repeats a member name in any object, at any depth. Names are
 * compared after their escapes are decoded, so `"a"` and `"a"` are the same name.
 */
function repeatsName(text: string): boolean {
	// One entry per open container: an object's names so far, or `null` for an array.
	const open: (Set<string> | null)[] = [];
	let expectName = false;
	let index = 0;
	while (index < text.length) {
		const char = text[index];
		if (char === '"') {
			let end = index + 1;
			while (text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
			const names = open.at(-1);
			if (expectName && names) {
				const name = JSON.parse(text.slice(index, end + 1)) as string;
				if (names.has(name)) return true;
				names.add(name);
				expectName = false;
			}
			index = end + 1;
			continue;
		}
		if (char === '{') {
			open.push(new Set());
			expectName = true;
		} else if (char === '[') {
			open.push(null);
			expectName = false;
		} else if (char === '}' || char === ']') {
			open.pop();
			expectName = false;
		} else if (char === ',') {
			expectName = open.at(-1) instanceof Set;
		}
		index += 1;
	}
	return false;
}

/**
 * `text` parsed as one JSON object whose objects, at every depth, have unique member names; or
 * `undefined` for invalid JSON, a value that is not an object, or a repeated name.
 */
export function parseStrictObject(text: string): Record<string, unknown> | undefined {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
	return repeatsName(text) ? undefined : (value as Record<string, unknown>);
}

/** Bytes as UTF-8 text, or `undefined` when they are not well-formed UTF-8. */
function utf8(bytes: Uint8Array): string | undefined {
	try {
		return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
	} catch {
		return undefined;
	}
}

const BASE64URL = /^[A-Za-z0-9_-]*$/;

/**
 * Unpadded base64url (RFC 7515 2) decoded strictly: only the alphabet, no padding, no length
 * that leaves a lone character, and no non-zero trailing bits. `undefined` otherwise.
 */
export function decodeBase64url(part: string): Uint8Array | undefined {
	if (!BASE64URL.test(part) || part.length % 4 === 1) return undefined;
	const bytes = Buffer.from(part, 'base64url');
	// Re-encoding gives back the input only when its trailing bits were zero.
	return bytes.toString('base64url') === part ? new Uint8Array(bytes) : undefined;
}

/** A base64url part decoded to one JSON object with unique member names, or `undefined`. */
export function decodeJoseObject(part: string): Record<string, unknown> | undefined {
	const bytes = decodeBase64url(part);
	const text = bytes && utf8(bytes);
	return text === undefined ? undefined : parseStrictObject(text);
}
