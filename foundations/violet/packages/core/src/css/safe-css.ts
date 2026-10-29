/**
 * Allow-list validators for token values that end up in CSS.
 *
 * Token values are untrusted: anyone who can write a token can type `url(...)`,
 * `expression(...)`, `;`, `}` or a comment into it. A value only reaches a
 * `style` attribute or a stylesheet after one of these validators has parsed it
 * as exactly one kind of value, and what they return is rebuilt from the parsed
 * parts rather than passed through. Anything they don't recognize is `null`, and
 * callers draw a neutral placeholder instead.
 *
 * The grammars are deliberately small: no `var()`, `calc()`, `url()`, escapes,
 * comments, quotes inside names, or `!important`.
 */

/** Longest input any validator looks at; longer values are rejected unread */
export const MAX_CSS_VALUE_LENGTH = 256;

/** Longest shadow (several layers with colours) */
const MAX_SHADOW_LENGTH = 512;

/** A string no longer than `max`, trimmed; anything else is null */
function boundedString(value: unknown, max = MAX_CSS_VALUE_LENGTH): string | null {
	if (typeof value !== 'string' || value.length > max) return null;
	return value.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Colour
// ─────────────────────────────────────────────────────────────────────────────

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTIONAL_COLOR =
	/^(?:rgb|hsl)a?\(\s*[\d.]+(?:deg|%)?(?:\s*[\s,/]\s*[\d.]+(?:deg|%)?){2,3}\s*\)$/i;

/**
 * `value` if it is a plain hex, rgb() or hsl() colour, otherwise `null`.
 */
export function safeCssColor(value: unknown): string | null {
	const trimmed = boundedString(value);
	if (trimmed === null) return null;
	return HEX_COLOR.test(trimmed) || FUNCTIONAL_COLOR.test(trimmed) ? trimmed : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Length
// ─────────────────────────────────────────────────────────────────────────────

const LENGTH_UNITS = ['px', 'rem', 'em', '%', 'vh', 'vw', 'vmin', 'vmax', 'ch', 'ex', 'pt'];
const LENGTH = new RegExp(
	`^(-?)(\\d{1,6}(?:\\.\\d{1,4})?|\\.\\d{1,4})(${LENGTH_UNITS.join('|')})$`,
	'i',
);
const ZERO = /^-?(?:0+(?:\.0+)?|\.0+)$/;

/**
 * A single length such as `16px`, `1.5rem`, `-0.02em` or `0`, otherwise `null`.
 * The number 0 is accepted too; other unitless numbers are not, since their unit
 * would be a guess.
 */
export function safeCssLength(value: unknown): string | null {
	if (value === 0) return '0';
	const trimmed = boundedString(value, 32);
	if (trimmed === null) return null;
	if (ZERO.test(trimmed)) return '0';
	const match = LENGTH.exec(trimmed);
	if (!match) return null;
	const [, sign, number, unit] = match;
	return `${sign}${number}${unit.toLowerCase()}`;
}

/**
 * Pixel size of a safe length, for scaling a specimen (rem and em as 16px).
 * Relative units that depend on the viewport or the font are `null`.
 */
export function cssLengthToPx(length: string): number | null {
	if (length === '0') return 0;
	const match = LENGTH.exec(length);
	if (!match) return null;
	const [, sign, number, unit] = match;
	const amount = Number(number) * (sign ? -1 : 1);
	switch (unit.toLowerCase()) {
		case 'px':
			return amount;
		case 'rem':
		case 'em':
			return amount * 16;
		case 'pt':
			return (amount * 4) / 3;
		default:
			return null;
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Numbers (font weight, line height, opacity)
// ─────────────────────────────────────────────────────────────────────────────

const NUMBER = /^-?(?:\d{1,6}(?:\.\d{1,4})?|\.\d{1,4})$/;

/**
 * A finite number (or numeric string) within `min`..`max`, as a string, otherwise
 * `null`. Use it for unitless values such as a font weight or line height.
 */
export function safeCssNumber(
	value: unknown,
	{ min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {},
): string | null {
	let amount: number;
	if (typeof value === 'number') {
		amount = value;
	} else {
		const trimmed = boundedString(value, 16);
		if (trimmed === null || !NUMBER.test(trimmed)) return null;
		amount = Number(trimmed);
	}
	if (!Number.isFinite(amount) || amount < min || amount > max) return null;
	return String(amount);
}

// ─────────────────────────────────────────────────────────────────────────────
// Font family
// ─────────────────────────────────────────────────────────────────────────────

const MAX_FAMILIES = 10;
const FAMILY_WORD = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const QUOTED_FAMILY = /^(["'])([A-Za-z0-9 _.-]{1,64})\1$/;
/** Keywords that are not family names; unquoted they would change the declaration */
const RESERVED_FAMILIES = new Set([
	'inherit',
	'initial',
	'unset',
	'revert',
	'revert-layer',
	'default',
]);

function safeFamilyName(part: string): string | null {
	const quoted = QUOTED_FAMILY.exec(part);
	if (quoted) {
		const name = quoted[2].trim();
		return name ? `"${name}"` : null;
	}
	if (part.length > 64) return null;
	const words = part.split(/ +/);
	if (!words.every((word) => FAMILY_WORD.test(word))) return null;
	if (words.length === 1 && RESERVED_FAMILIES.has(words[0].toLowerCase())) return null;
	return words.join(' ');
}

/**
 * A font-family list such as `Segoe UI, system-ui, sans-serif`, otherwise `null`.
 * Names are letters, digits, spaces, `_` and `-` (and `.` when quoted); the list
 * is rebuilt with `, ` between names and double quotes around quoted ones.
 */
export function safeFontFamily(value: unknown): string | null {
	const trimmed = boundedString(value);
	if (!trimmed) return null;
	const parts = trimmed.split(',').map((part) => part.trim());
	if (parts.length > MAX_FAMILIES) return null;
	const names: string[] = [];
	for (const part of parts) {
		const name = safeFamilyName(part);
		if (!name) return null;
		names.push(name);
	}
	return names.join(', ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Shadow
// ─────────────────────────────────────────────────────────────────────────────

const MAX_SHADOW_LAYERS = 6;
const SHADOW_COLOR_KEYWORDS = new Set(['transparent', 'currentcolor']);

/**
 * Split at top-level `separator` characters (outside parentheses). Null when the
 * parentheses don't balance or nest, since no allowed value nests them.
 */
function splitTopLevel(value: string, separator: RegExp): string[] | null {
	const parts: string[] = [];
	let depth = 0;
	let current = '';
	for (const char of value) {
		if (char === '(') depth += 1;
		if (char === ')') depth -= 1;
		if (depth < 0 || depth > 1) return null;
		if (depth === 0 && separator.test(char)) {
			parts.push(current);
			current = '';
		} else {
			current += char;
		}
	}
	if (depth !== 0) return null;
	parts.push(current);
	return parts;
}

/** A shadow layer part: `L` a length, `I` inset, `C` a colour; null when it is none of them */
function shadowPart(token: string): { kind: 'L' | 'I' | 'C'; text: string } | null {
	const length = safeCssLength(token);
	if (length !== null) return { kind: 'L', text: length };
	const keyword = token.toLowerCase();
	if (keyword === 'inset') return { kind: 'I', text: keyword };
	const color = SHADOW_COLOR_KEYWORDS.has(keyword) ? keyword : safeCssColor(token);
	return color ? { kind: 'C', text: color } : null;
}

/** Two to four lengths in a row, with at most one inset and one colour before or after them */
const SHADOW_LAYER_SHAPE = /^[IC]{0,2}L{2,4}[IC]{0,2}$/;

function safeShadowLayer(layer: string): string | null {
	const parts = splitTopLevel(layer.trim(), /\s/)?.filter(Boolean).map(shadowPart);
	if (!parts || parts.some((part) => part === null)) return null;
	const found = parts as Array<{ kind: 'L' | 'I' | 'C'; text: string }>;
	const shape = found.map((part) => part.kind).join('');
	const count = (kind: string) => found.filter((part) => part.kind === kind).length;
	if (!SHADOW_LAYER_SHAPE.test(shape) || count('I') > 1 || count('C') > 1) return null;
	const pick = (kind: string) =>
		found.filter((part) => part.kind === kind).map((part) => part.text);
	return [...pick('I'), ...pick('L'), ...pick('C')].join(' ');
}

/**
 * A box-shadow such as `0 4px 8px rgba(0, 0, 0, 0.12)` (up to six layers, each
 * with optional `inset`, two to four lengths and an optional colour) or `none`,
 * otherwise `null`.
 */
export function safeShadow(value: unknown): string | null {
	const trimmed = boundedString(value, MAX_SHADOW_LENGTH);
	if (!trimmed) return null;
	if (trimmed.toLowerCase() === 'none') return 'none';
	const layers = splitTopLevel(trimmed, /,/);
	if (!layers || layers.length > MAX_SHADOW_LAYERS) return null;
	const safe: string[] = [];
	for (const layer of layers) {
		const rebuilt = safeShadowLayer(layer);
		if (!rebuilt) return null;
		safe.push(rebuilt);
	}
	return safe.join(', ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Motion
// ─────────────────────────────────────────────────────────────────────────────

const DURATION = /^(\d{1,6}(?:\.\d{1,3})?|\.\d{1,3})(ms|s)$/i;

/** Longest duration a specimen will play */
export const MAX_DURATION_MS = 60_000;

/**
 * A time such as `200ms` or `0.3s` (at most a minute), otherwise `null`.
 */
export function safeDuration(value: unknown): string | null {
	const trimmed = boundedString(value, 16);
	if (trimmed === null) return null;
	const match = DURATION.exec(trimmed);
	if (!match) return null;
	const [, number, unit] = match;
	const lower = unit.toLowerCase();
	const ms = Number(number) * (lower === 's' ? 1000 : 1);
	return ms <= MAX_DURATION_MS ? `${number}${lower}` : null;
}

/** Milliseconds of a safe duration */
export function durationToMs(duration: string): number {
	const match = DURATION.exec(duration);
	if (!match) return 0;
	return Number(match[1]) * (match[2].toLowerCase() === 's' ? 1000 : 1);
}

const EASING_KEYWORDS = new Set([
	'linear',
	'ease',
	'ease-in',
	'ease-out',
	'ease-in-out',
	'step-start',
	'step-end',
]);
const CUBIC_BEZIER = /^cubic-bezier\(\s*([^,()]+),\s*([^,()]+),\s*([^,()]+),\s*([^,()]+)\)$/i;
const STEPS =
	/^steps\(\s*(\d{1,3})\s*(?:,\s*(jump-start|jump-end|jump-none|jump-both|start|end)\s*)?\)$/i;

/**
 * A timing function: a keyword such as `ease-out`, `cubic-bezier(x1, y1, x2, y2)`
 * (x within 0..1) or `steps(n[, position])`, otherwise `null`.
 */
export function safeEasing(value: unknown): string | null {
	const trimmed = boundedString(value, 64);
	if (!trimmed) return null;
	const lower = trimmed.toLowerCase();
	if (EASING_KEYWORDS.has(lower)) return lower;
	const bezier = CUBIC_BEZIER.exec(trimmed);
	if (bezier) {
		const [x1, y1, x2, y2] = bezier.slice(1).map((part) => safeCssNumber(part.trim()));
		const inUnit = (x: string | null) => x !== null && Number(x) >= 0 && Number(x) <= 1;
		const bounded = (y: string | null) => y !== null && Math.abs(Number(y)) <= 10;
		return inUnit(x1) && inUnit(x2) && bounded(y1) && bounded(y2)
			? `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`
			: null;
	}
	const steps = STEPS.exec(trimmed);
	if (steps && Number(steps[1]) >= 1) {
		return steps[2]
			? `steps(${Number(steps[1])}, ${steps[2].toLowerCase()})`
			: `steps(${Number(steps[1])})`;
	}
	return null;
}
