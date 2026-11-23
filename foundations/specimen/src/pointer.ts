/** Error code returned when a `specimen:` pointer URI is malformed. */
export const POINTER_INVALID = 'POINTER_INVALID' as const;

/** Maximum length of a decoded pointer text hint (Proposal §4.2). */
export const MAX_POINTER_TEXT_LENGTH = 200;

/** Default fractional pin coordinates when `&pin=` is omitted. */
export const DEFAULT_PIN: Readonly<PointerPin> = /* @__PURE__ */ Object.freeze({ x: 0.5, y: 0.5 });

const DEFAULT_SUGGESTION = 'Copy the pointer again from the review page.';
const SPECIMEN_ID = /^[^\s\p{Cc}/?#&=]+$/u;
const ELEMENT_REF = /^root(?:(?:\/shadow)?\/[a-zA-Z][a-zA-Z0-9._-]*:[1-9]\d*)+$/;
const DECIMAL = /^(?:\d+(?:\.\d+)?|\.\d+)$/;
const FRAGMENT_KEYS = /* @__PURE__ */ new Set(['ref', 'text', 'depth', 'pin']);
const RESERVED_KEYS = /* @__PURE__ */ new Set(['__proto__', 'constructor', 'prototype']);

export interface PointerPin {
	x: number;
	y: number;
}

export interface SpecimenPointer {
	specimen: string;
	context: Record<string, string>;
	checkpoint?: string;
	ref: string;
	text?: string;
	depth?: 'deepest';
	pin: PointerPin;
}

export interface FormatPointerInput {
	specimen: string;
	context?: Record<string, string>;
	checkpoint?: string;
	ref: string;
	text?: string;
	depth?: 'deepest';
	pin?: PointerPin;
}

/** Structured error thrown when parsing or formatting an invalid `specimen:` pointer URI. */
export class PointerError extends Error {
	readonly code = POINTER_INVALID;
	readonly suggestion: string;
	readonly details?: Record<string, unknown>;

	constructor(message: string, details?: Record<string, unknown>, suggestion = DEFAULT_SUGGESTION) {
		super(message);
		this.name = 'PointerError';
		this.suggestion = suggestion;
		if (details) this.details = details;
	}
}

/** Whether `ref` matches Specimen's positional element reference grammar (`root/.../tag:n`). */
export function isValidElementRef(ref: string): boolean {
	return ELEMENT_REF.test(ref);
}

function decodePart(value: string, field: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		throw new PointerError(`Malformed percent-encoding in pointer ${field}.`, { field });
	}
}

function clampText(text: string): string {
	const chars = Array.from(text);
	return chars.length <= MAX_POINTER_TEXT_LENGTH
		? text
		: chars.slice(0, MAX_POINTER_TEXT_LENGTH).join('');
}

function parsePinCoord(raw: string, axis: 'x' | 'y'): number {
	if (!DECIMAL.test(raw)) {
		throw new PointerError(`Invalid pointer pin ${axis} coordinate: ${raw}.`, {
			field: 'pin',
			value: raw,
		});
	}
	const value = Number(raw);
	if (!Number.isFinite(value) || value < 0 || value > 1) {
		throw new PointerError(`Pointer pin ${axis} coordinate must be between 0 and 1: ${raw}.`, {
			field: 'pin',
			value: raw,
		});
	}
	return value;
}

function parsePin(raw: string): PointerPin {
	const parts = raw.split(',');
	if (parts.length !== 2) {
		throw new PointerError(`Pointer pin must be x,y in [0, 1]: ${raw}.`, {
			field: 'pin',
			value: raw,
		});
	}
	return {
		x: parsePinCoord(parts[0] ?? '', 'x'),
		y: parsePinCoord(parts[1] ?? '', 'y'),
	};
}

function parsePairs(raw: string, section: 'query' | 'fragment'): [string, string][] {
	const pairs: [string, string][] = [];
	const seen = new Set<string>();
	for (const segment of raw.split('&')) {
		if (!segment) {
			throw new PointerError(`Empty parameter in pointer ${section}.`, { field: section });
		}
		const eq = segment.indexOf('=');
		if (eq <= 0) {
			throw new PointerError(`Missing key or value in pointer ${section}: ${segment}.`, {
				field: section,
			});
		}
		const key = decodePart(segment.slice(0, eq), section);
		const value = decodePart(segment.slice(eq + 1), key);
		if (!key) {
			throw new PointerError(`Empty parameter key in pointer ${section}.`, { field: section });
		}
		if (RESERVED_KEYS.has(key)) {
			throw new PointerError(`Reserved parameter key in pointer ${section}: ${key}.`, {
				field: key,
			});
		}
		if (seen.has(key)) {
			throw new PointerError(`Duplicate pointer ${section} parameter: ${key}.`, {
				field: key,
			});
		}
		seen.add(key);
		pairs.push([key, value]);
	}
	return pairs;
}

/**
 * Parse a `specimen:<id>?<context>#ref=<path>[&text=<hint>][&depth=deepest][&pin=<x>,<y>]` URI.
 * Throws `PointerError` (`code: 'POINTER_INVALID'`) on any malformed input.
 */
export function parsePointer(uri: string): SpecimenPointer {
	if (typeof uri !== 'string' || !uri.startsWith('specimen:')) {
		throw new PointerError('Pointer must start with the specimen: scheme.', { field: 'scheme' });
	}
	for (let i = 0; i < uri.length; i++) {
		const code = uri.charCodeAt(i);
		if (code <= 0x1f || code === 0x7f) {
			throw new PointerError('Pointer must not contain control characters.', { field: 'uri' });
		}
	}
	const body = uri.slice('specimen:'.length);
	const hash = body.indexOf('#');
	if (hash < 0) {
		throw new PointerError('Pointer is missing its #ref=... fragment.', { field: 'ref' });
	}
	const head = body.slice(0, hash);
	const fragment = body.slice(hash + 1);
	if (!fragment) {
		throw new PointerError('Pointer fragment must include ref.', { field: 'ref' });
	}

	const queryStart = head.indexOf('?');
	const rawId = queryStart < 0 ? head : head.slice(0, queryStart);
	const rawQuery = queryStart < 0 ? '' : head.slice(queryStart + 1);

	const specimen = decodePart(rawId, 'specimen');
	if (!SPECIMEN_ID.test(specimen)) {
		throw new PointerError(`Invalid specimen id in pointer: ${specimen || '(empty)'}.`, {
			field: 'specimen',
		});
	}

	const context: Record<string, string> = {};
	let checkpoint: string | undefined;
	if (queryStart >= 0 && rawQuery.length > 0) {
		for (const [key, value] of parsePairs(rawQuery, 'query')) {
			if (key === 'checkpoint') {
				if (!value) {
					throw new PointerError('Pointer checkpoint must not be empty.', { field: 'checkpoint' });
				}
				checkpoint = value;
			} else {
				context[key] = value;
			}
		}
	}

	let ref: string | undefined;
	let text: string | undefined;
	let depth: 'deepest' | undefined;
	let pin: PointerPin = { ...DEFAULT_PIN };

	for (const [key, value] of parsePairs(fragment, 'fragment')) {
		if (!FRAGMENT_KEYS.has(key)) {
			throw new PointerError(`Unknown pointer fragment parameter: ${key}.`, { field: key });
		}
		if (key === 'ref') {
			if (!isValidElementRef(value)) {
				throw new PointerError(`Invalid element ref in pointer: ${value || '(empty)'}.`, {
					field: 'ref',
				});
			}
			ref = value;
		} else if (key === 'text') {
			text = clampText(value);
		} else if (key === 'depth') {
			if (value !== 'deepest') {
				throw new PointerError(`Unknown pointer depth value: ${value || '(empty)'}.`, {
					field: 'depth',
				});
			}
			depth = 'deepest';
		} else if (key === 'pin') {
			pin = parsePin(value);
		}
	}

	if (!ref) {
		throw new PointerError('Pointer fragment must include ref.', { field: 'ref' });
	}

	return {
		specimen,
		context,
		...(checkpoint === undefined ? {} : { checkpoint }),
		ref,
		...(text === undefined ? {} : { text }),
		...(depth === undefined ? {} : { depth }),
		pin,
	};
}

function formatPinValue(value: number, axis: 'x' | 'y'): string {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
		throw new PointerError(`Pointer pin ${axis} coordinate must be between 0 and 1.`, {
			field: 'pin',
		});
	}
	return String(Math.round(value * 100) / 100);
}

/**
 * Format a `specimen:` pointer URI according to Proposal §4.2.
 * Throws `PointerError` (`code: 'POINTER_INVALID'`) if required fields or bounds are invalid.
 */
export function formatPointer(input: FormatPointerInput): string {
	if (!SPECIMEN_ID.test(input.specimen)) {
		throw new PointerError(`Invalid specimen id: ${input.specimen || '(empty)'}.`, {
			field: 'specimen',
		});
	}
	if (!isValidElementRef(input.ref)) {
		throw new PointerError(`Invalid element ref: ${input.ref || '(empty)'}.`, { field: 'ref' });
	}
	if (input.depth !== undefined && input.depth !== 'deepest') {
		throw new PointerError(`Unknown pointer depth value: ${String(input.depth)}.`, {
			field: 'depth',
		});
	}

	const queryParts: string[] = [];
	let checkpoint = input.checkpoint;
	if (checkpoint !== undefined && checkpoint.length === 0) {
		throw new PointerError('Pointer checkpoint must not be empty.', { field: 'checkpoint' });
	}
	for (const [key, value] of Object.entries(input.context ?? {})) {
		if (!key || value === undefined) continue;
		if (RESERVED_KEYS.has(key)) {
			throw new PointerError(`Reserved parameter key in pointer query: ${key}.`, { field: key });
		}
		if (key === 'checkpoint') {
			if (!value) {
				throw new PointerError('Pointer checkpoint must not be empty.', { field: 'checkpoint' });
			}
			if (checkpoint !== undefined && checkpoint !== value) {
				throw new PointerError(
					'Pointer context.checkpoint conflicts with checkpoint; provide one value.',
					{ field: 'checkpoint' }
				);
			}
			checkpoint = value;
			continue;
		}
		queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
	}
	if (checkpoint) {
		queryParts.push(`checkpoint=${encodeURIComponent(checkpoint)}`);
	}

	const fragmentParts: string[] = [`ref=${input.ref}`];
	if (input.text) {
		const trimmed = clampText(input.text);
		if (trimmed) fragmentParts.push(`text=${encodeURIComponent(trimmed)}`);
	}
	if (input.depth === 'deepest') {
		fragmentParts.push('depth=deepest');
	}
	if (input.pin) {
		const x = formatPinValue(input.pin.x, 'x');
		const y = formatPinValue(input.pin.y, 'y');
		fragmentParts.push(`pin=${x},${y}`);
	}

	const query = queryParts.length ? `?${queryParts.join('&')}` : '';
	return `specimen:${encodeURIComponent(input.specimen)}${query}#${fragmentParts.join('&')}`;
}
