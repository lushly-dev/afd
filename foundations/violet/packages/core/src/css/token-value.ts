/**
 * Whether a token's value can reach CSS safely (#1325).
 *
 * The CSS and SCSS exports write a string value as it is, so a value such as
 * `#121214; background: url(…)` would land in the stylesheet. A value is checked
 * where it enters (written or imported) and again where it leaves (exported):
 *
 * - A token whose DTCG `$type` (or Violet category) names a kind is held to that
 *   kind's allow-list validator from `safe-css.ts`: a colour must parse as a
 *   colour, a dimension as one length, and so on.
 * - Any other string must stay inside one CSS declaration: no `;`, braces,
 *   comments, escapes, `!`, control characters, resource-loading functions, or
 *   unbalanced quotes and brackets.
 *
 * Numbers are always safe. A DTCG alias (`{color.base}`) is checked once
 * resolved, so it passes here; so does an object value's structure, whose
 * string leaves get the general check.
 */

import { validateTokenId } from '../types/token-id.js';
import {
	safeCssColor,
	safeCssLength,
	safeCssNumber,
	safeDuration,
	safeEasing,
	safeFontFamily,
	safeShadow,
} from './safe-css.js';

/** The kinds of value a token can be held to */
export type CssValueKind =
	| 'color'
	| 'length'
	| 'fontFamily'
	| 'shadow'
	| 'duration'
	| 'easing'
	| 'number';

/** What the check reads from a token's metadata */
export interface CssValueMetadata {
	/** DTCG `$type` */
	type?: string;
	/** Violet category; `custom` names no kind */
	category?: string;
}

/** Longest string value the general check reads */
export const MAX_TOKEN_STRING_LENGTH = 1024;

const KIND_BY_TYPE: Record<string, CssValueKind> = {
	color: 'color',
	dimension: 'length',
	fontFamily: 'fontFamily',
	shadow: 'shadow',
	duration: 'duration',
	cubicBezier: 'easing',
	number: 'number',
};

const KIND_BY_CATEGORY: Record<string, CssValueKind> = {
	color: 'color',
	spacing: 'length',
	radius: 'length',
	shadow: 'shadow',
};

/** The kind a token's value is held to, or null when its metadata names none */
export function cssValueKind(metadata: CssValueMetadata | null | undefined): CssValueKind | null {
	if (!metadata) return null;
	if (metadata.type) return KIND_BY_TYPE[metadata.type] ?? null;
	return metadata.category ? (KIND_BY_CATEGORY[metadata.category] ?? null) : null;
}

/** A family name: quoted, or words, the first of which may be vendor-prefixed (`-apple-system`) */
const FAMILY_PART =
	/^(?:"[^"]{1,64}"|'[^']{1,64}'|-?[A-Za-z_][A-Za-z0-9_-]*(?: +[A-Za-z_][A-Za-z0-9_-]*)*)$/;

/** A comma-separated list of up to ten family names */
function isFamilyList(value: string): boolean {
	const parts = value.split(',').map((part) => part.trim());
	return parts.length <= 10 && parts.every((part) => FAMILY_PART.test(part));
}

/** CSS colour keywords: the named colours, `transparent`, `currentColor` and the system colours */
const COLOR_KEYWORDS = new Set(
	(
		'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue ' +
		'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk ' +
		'crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
		'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
		'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue ' +
		'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite ' +
		'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
		'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
		'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
		'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
		'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
		'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
		'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
		'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
		'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
		'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
		'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow ' +
		'yellowgreen transparent currentcolor accentcolor accentcolortext activetext buttonborder ' +
		'buttonface buttontext canvas canvastext field fieldtext graytext highlight highlighttext ' +
		'linktext mark marktext selecteditem selecteditemtext visitedtext'
	).split(' '),
);

/**
 * Modern functions a typed value may use beyond the strict forms, by kind. Their
 * arguments have passed the general check, so they cannot leave the declaration or
 * load anything; `var()` points at another custom property.
 */
const FUNCTIONS_BY_KIND: Partial<Record<CssValueKind, RegExp>> = {
	color: /^(?:oklch|oklab|lch|lab|hwb|color|color-mix|light-dark|rgb|rgba|hsl|hsla|var)\(.*\)$/is,
	length: /^(?:calc|clamp|min|max|var)\(.*\)$/is,
	duration: /^(?:calc|var)\(.*\)$/is,
	easing: /^(?:linear|var)\(.*\)$/is,
	number: /^(?:calc|clamp|min|max|var)\(.*\)$/is,
	shadow: /^var\(.*\)$/is,
	fontFamily: /^var\(.*\)$/is,
};

const KIND_CHECKS: Record<CssValueKind, { accepts: (value: string) => boolean; expected: string }> =
	{
		color: {
			accepts: (value) =>
				safeCssColor(value) !== null || COLOR_KEYWORDS.has(value.trim().toLowerCase()),
			expected: 'a colour (hex, rgb(), hsl(), oklch() and the like) or a colour keyword',
		},
		length: {
			accepts: (value) => safeCssLength(value) !== null,
			expected: 'one length such as 16px, 1.5rem or 0, or calc()',
		},
		fontFamily: {
			accepts: (value) => safeFontFamily(value) !== null || isFamilyList(value),
			expected: 'a font-family list of plain or quoted names',
		},
		shadow: {
			accepts: (value) => safeShadow(value) !== null,
			expected: 'a box-shadow of lengths, an optional inset and a colour, or none',
		},
		duration: {
			accepts: (value) => safeDuration(value) !== null,
			expected: 'a time such as 200ms or 0.3s, at most a minute',
		},
		easing: {
			accepts: (value) => safeEasing(value) !== null,
			expected: 'an easing keyword, cubic-bezier(), steps() or linear()',
		},
		number: {
			accepts: (value) => safeCssNumber(value) !== null,
			expected: 'a number',
		},
	};

/** Whether a string fits its kind, by the strict validator or an allowed function */
function fitsKind(value: string, kind: CssValueKind): boolean {
	return KIND_CHECKS[kind].accepts(value) || (FUNCTIONS_BY_KIND[kind]?.test(value.trim()) ?? false);
}

/**
 * A whole-value DTCG alias: followed at resolution and checked as the value it
 * reaches. Matched untrimmed, as the resolver matches it, and narrowed to token-id
 * characters, so text the resolver would write out as it is can never pass as one.
 * An alias inside a longer string is not followed, so its braces are refused.
 */
const WHOLE_ALIAS = /^\{[A-Za-z0-9_.-]+\}$/;

/** A reference the resolver follows: `{ ref }`, optionally with `transform`, naming a token id */
function isReference(record: Record<string, unknown>): boolean {
	return (
		typeof record.ref === 'string' &&
		/^[A-Za-z0-9_.-]+$/.test(record.ref) &&
		Object.keys(record).every((key) => key === 'ref' || key === 'transform') &&
		(record.transform === undefined || typeof record.transform === 'string')
	);
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
const CONTROL = /[\u0000-\u001f\u007f]/;
const DECLARATION_BREAKERS = /[;{}<>\\!]/;
const COMMENT = /\/\*|\*\//;
/** Functions that load a resource or run code */
const RESOURCE_FUNCTION =
	/(?:^|[^a-z0-9_-])(?:-[a-z]+-)?(?:url|src|image|image-set|expression|element|cross-fade|paint)\s*\(/i;

/** Why a string cannot sit in a CSS declaration, or null when it can */
function generalStringProblem(text: string): string | null {
	if (text.length > MAX_TOKEN_STRING_LENGTH) {
		return `is longer than ${MAX_TOKEN_STRING_LENGTH} characters`;
	}
	if (CONTROL.test(text)) return 'holds a control character or line break';
	if (COMMENT.test(text)) return 'holds a CSS comment';
	const breaker = DECLARATION_BREAKERS.exec(text);
	if (breaker) return `holds '${breaker[0]}', which can end or escape a CSS declaration`;
	if (RESOURCE_FUNCTION.test(text)) return 'calls a function that loads a resource or runs code';
	return balanceProblem(text);
}

/** Why a string's quotes or brackets do not balance, or null */
function balanceProblem(text: string): string | null {
	let depth = 0;
	let quote: string | null = null;
	for (const char of text) {
		if (quote) {
			if (char === quote) quote = null;
		} else if (char === '"' || char === "'") {
			quote = char;
		} else if (char === '(' || char === '[') {
			depth += 1;
		} else if (char === ')' || char === ']') {
			depth -= 1;
			if (depth < 0) return 'has an unbalanced bracket';
		}
	}
	if (quote) return 'has an unclosed quote';
	if (depth !== 0) return 'has an unbalanced bracket';
	return null;
}

/** Why one string leaf is unsafe for its kind, or null */
function stringProblem(value: string, kind: CssValueKind | null): string | null {
	// Untrimmed, as the resolver matches it: ' {a}' is a literal, not an alias
	if (WHOLE_ALIAS.test(value)) return null;
	const general = generalStringProblem(value);
	if (general) return general;
	if (!kind || fitsKind(value, kind)) return null;
	return `is not ${KIND_CHECKS[kind].expected}`;
}

/** Why a number is unsafe for its kind, or null: only a number, or a zero length, is one */
function numberProblem(value: number, kind: CssValueKind | null): string | null {
	if (!Number.isFinite(value)) return 'is not a finite number';
	if (!kind || kind === 'number' || (kind === 'length' && value === 0)) return null;
	return `is a bare number, not ${KIND_CHECKS[kind].expected}`;
}

const at = (path: string) => (path ? `${path} ` : '');

/** Why a value is unsafe, walking object values; `path` names the leaf */
function valueProblem(value: unknown, kind: CssValueKind | null, path: string): string | null {
	if (typeof value === 'string') {
		const problem = stringProblem(value, kind);
		return problem ? `${at(path)}${problem}` : null;
	}
	if (typeof value === 'number') {
		const problem = numberProblem(value, kind);
		return problem ? `${at(path)}${problem}` : null;
	}
	if (value === null || typeof value === 'boolean' || value === undefined) return null;
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			const problem = valueProblem(item, null, `${path}[${index}]`);
			if (problem) return problem;
		}
		return null;
	}
	if (typeof value === 'object') {
		const record = value as Record<string, unknown>;
		// A reference is checked as the value it resolves to
		if (isReference(record)) return null;
		// Not followed as a reference, yet written out as one ('{<ref>}') by the resolver
		if ('ref' in record) return `${at(path)}has a ref that is not a reference to a token id`;
		for (const [key, item] of Object.entries(record)) {
			// A key is written out with a composite, so it is held to the general check too
			const keyProblem = generalStringProblem(key);
			if (keyProblem) return `${at(path)}key '${key.slice(0, 40)}' ${keyProblem}`;
			// The web value is the one CSS gets, so it keeps the token's kind
			const keepsKind = key === 'web';
			const problem = valueProblem(item, keepsKind ? kind : null, path ? `${path}.${key}` : key);
			if (problem) return problem;
		}
		return null;
	}
	return `${at(path)}is not a value a token can hold`;
}

/** A token whose value or name cannot reach CSS safely; the CSS and SCSS exports throw it */
export class UnsafeCssValueError extends Error {
	constructor(
		readonly tokenId: string,
		readonly problem: string,
	) {
		super(`Token '${tokenId}': ${problem}`);
		this.name = 'UnsafeCssValueError';
	}
}

/**
 * Why `value` cannot reach CSS safely for a token with `metadata`, as a phrase
 * that follows "the value" (for example "is not one length such as 16px, 1.5rem
 * or 0"), or null when it is safe.
 */
export function checkCssTokenValue(
	value: unknown,
	metadata?: CssValueMetadata | null,
): string | null {
	return valueProblem(value, cssValueKind(metadata), '');
}

/** A custom property or variable name a token id becomes: letters, digits, `_` and `-` */
const CSS_NAME = /^[A-Za-z0-9_-]+$/;

/** What the export check reads from a resolved token */
export interface CssCheckedToken {
	id: string;
	/** The value as stored, a composite object or a platform value included */
	value?: unknown;
	/** `value` with references followed */
	finalValue?: unknown;
	resolvedValue: unknown;
	metadata?: CssValueMetadata | null;
}

function isComposite(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	return !('ref' in value) && !('web' in value);
}

/**
 * Why a resolved token cannot be written to CSS or SCSS, as a sentence, or null
 * when it can: its id must make a plain name, and its value must be safe. A
 * composite (an object that is neither a reference nor a platform value) is
 * checked by its keys and leaves, since the export writes it as JSON.
 */
export function checkCssToken(token: CssCheckedToken, prefix = ''): string | null {
	const name = `${prefix}${token.id.replace(/\./g, '-')}`;
	if (validateTokenId(token.id) !== null || !CSS_NAME.test(name)) {
		return 'its id cannot be a CSS name; use non-empty dot-separated segments of letters, digits, _ and - only';
	}
	const structured = token.finalValue ?? token.value;
	const problem = isComposite(structured)
		? valueProblem(structured, null, '')
		: checkCssTokenValue(token.resolvedValue, token.metadata);
	return problem ? `the value ${problem}` : null;
}
