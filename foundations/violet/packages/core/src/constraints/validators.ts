/**
 * Constraint Validators
 *
 * Validate token values against constraint configurations.
 */

import type {
	Constraint,
	ConstraintConfig,
	ConstraintSeverity,
	ConstraintViolation,
	ContrastConfig,
	EnumConfig,
	PatternConfig,
	RampConfig,
	RangeConfig,
	ReferenceConfig,
	ScaleConfig,
} from '../types/constraint.js';
import type { TokenReferenceError } from '../types/token.js';
import { matchesGlob } from '../utils/glob.js';
import { checkPattern } from './pattern-safety.js';
import { ADVISORY_VIOLATION_CODES, evaluateRampConstraint } from './ramp.js';

// =============================================================================
// Minimal token type for validation context
// =============================================================================

export interface ValidatorToken {
	id: string;
	resolvedValue: string | number;
	aliasOf?: string;
	referenceError?: TokenReferenceError;
	reason?: string;
}

// =============================================================================
// Validator Interface
// =============================================================================

export interface ValidatorContext {
	/** All resolved tokens (for reference/contrast/ramp validators) */
	allTokens: Map<string, ValidatorToken>;
	/** The token currently being validated (used by pattern.target: 'id' and ramp) */
	token?: ValidatorToken;
	/** The constraint's applyTo glob (used by ramp repeat clustering & pairWith) */
	applyTo?: string;
	/** The constraint's configured severity */
	severity?: ConstraintSeverity;
	/** Optional precomputed normalized off-ramp literal groups for O(n) ramp repeat checks */
	rampRepeatGroups?: Map<string, string[]>;
	/** Optional precomputed advisory uneven-jump violations for O(n log n) ramp progression checks */
	rampUnevenViolations?: Map<string, ConstraintViolation>;
}

export interface Validator<T extends ConstraintConfig = ConstraintConfig> {
	/** Constraint type this validator handles */
	type: T['type'];

	/**
	 * Validate a token value against the constraint config
	 * @returns null if valid, or the first violation object if invalid
	 */
	validate(
		value: unknown,
		config: T,
		constraintId: string,
		constraintName: string,
		context: ValidatorContext,
	): ConstraintViolation | null;

	/**
	 * Optional multi-violation entry point returning every violation emitted by this constraint.
	 * Validators that omit it produce 0 or 1 violations via `validate()`.
	 */
	validateAll?(
		value: unknown,
		config: T,
		constraintId: string,
		constraintName: string,
		context: ValidatorContext,
	): ConstraintViolation[];
}

// =============================================================================
// Enum Validator
// =============================================================================

export const enumValidator: Validator<EnumConfig> = {
	type: 'enum',

	validate(value, config, constraintId, constraintName) {
		const strValue = String(value);

		if (!config.values.includes(strValue)) {
			return {
				constraintId,
				constraintName,
				severity: 'error',
				message: `Value must be one of: ${config.values.join(', ')}`,
				expected: config.values.join(' | '),
				actual: strValue,
			};
		}

		return null;
	},
};

// =============================================================================
// Range Validator
// =============================================================================

export const rangeValidator: Validator<RangeConfig> = {
	type: 'range',

	validate(value, config, constraintId, constraintName) {
		// Extract numeric value from string (e.g., "8px" -> 8)
		const numValue = parseNumericValue(value);

		if (numValue === null) {
			return {
				constraintId,
				constraintName,
				severity: 'error',
				message: 'Value must be numeric',
				expected: `number between ${config.min ?? '-∞'} and ${config.max ?? '∞'}`,
				actual: String(value),
			};
		}

		if (config.min !== undefined && numValue < config.min) {
			return {
				constraintId,
				constraintName,
				severity: 'error',
				message: `Value must be at least ${config.min}`,
				expected: `>= ${config.min}`,
				actual: String(numValue),
			};
		}

		if (config.max !== undefined && numValue > config.max) {
			return {
				constraintId,
				constraintName,
				severity: 'error',
				message: `Value must be at most ${config.max}`,
				expected: `<= ${config.max}`,
				actual: String(numValue),
			};
		}

		return null;
	},
};

// =============================================================================
// Pattern Validator
// =============================================================================

export const patternValidator: Validator<PatternConfig> = {
	type: 'pattern',

	validate(value, config, constraintId, constraintName, context) {
		const isIdTarget = (config.target ?? 'value') === 'id';
		const strValue = isIdTarget ? (context.token?.id ?? String(value)) : String(value);

		// Patterns are user supplied: compile through the safety check so invalid or
		// catastrophic patterns (including ones stored before constraints.set validated
		// them) produce a structured violation instead of throwing or hanging.
		const check = checkPattern(config.pattern, config.flags);
		if (!check.ok) {
			return {
				constraintId,
				constraintName,
				severity: 'error',
				message: `Unusable regex pattern: ${check.reason}`,
				expected: 'valid, non-backtracking regex',
				actual: config.pattern,
			};
		}

		if (!check.regex.test(strValue)) {
			return {
				constraintId,
				constraintName,
				severity: 'error',
				message: isIdTarget
					? `Token ID must match pattern: ${config.pattern}`
					: `Value must match pattern: ${config.pattern}`,
				expected: config.pattern,
				actual: strValue,
			};
		}

		return null;
	},
};

// =============================================================================
// Scale Validator
// =============================================================================

export const scaleValidator: Validator<ScaleConfig> = {
	type: 'scale',

	validate(value, config, constraintId, constraintName) {
		const numValue = parseNumericValue(value);

		if (numValue === null) {
			return {
				constraintId,
				constraintName,
				severity: 'error',
				message: 'Value must be numeric for scale validation',
				expected: `multiple of ${config.base}`,
				actual: String(value),
			};
		}

		// Floor-mod so negatives behave (-5 % 8 is -5 in JS, which is not a multiple of 8),
		// then measure the distance to the nearest multiple. The epsilon absorbs
		// floating point noise such as 0.3 % 0.1 = 0.09999999999999998.
		const remainder = ((numValue % config.base) + config.base) % config.base;
		const distance = Math.min(remainder, config.base - remainder);
		const tolerance = config.tolerance ?? 0;
		const epsilon = 1e-9 * Math.max(1, Math.abs(numValue), config.base);

		const isValid = distance <= Math.max(tolerance, epsilon);

		if (!isValid) {
			return {
				constraintId,
				constraintName,
				severity: 'error',
				message: `Value must be a multiple of ${config.base}${
					tolerance > 0 ? ` (±${tolerance})` : ''
				}`,
				expected: `multiple of ${config.base}`,
				actual: String(numValue),
			};
		}

		return null;
	},
};

// =============================================================================
// Contrast Validator
// =============================================================================

export const contrastValidator: Validator<ContrastConfig> = {
	type: 'contrast',

	validate(value, config, constraintId, constraintName, context) {
		// Find the token to compare against
		const againstToken = context.allTokens.get(config.against);

		if (!againstToken) {
			return {
				constraintId,
				constraintName,
				severity: 'warning',
				message: `Cannot validate contrast: reference token '${config.against}' not found`,
				expected: `contrast ratio >= ${config.min}`,
				actual: 'unknown',
			};
		}

		const foreground = parseColorWithAlpha(String(value));
		const background = parseColorWithAlpha(String(againstToken.resolvedValue));

		if (!foreground || !background) {
			return {
				constraintId,
				constraintName,
				severity: 'warning',
				message: 'Cannot validate contrast: invalid color format',
				expected: `contrast ratio >= ${config.min}`,
				actual: 'invalid color',
			};
		}

		// A translucent background shows what lies under it, so it is measured over
		// its backdrop; a translucent foreground is then drawn over that (#1326)
		let surface = background;
		if (background.a < 1) {
			const backdropToken = config.backdrop ? context.allTokens.get(config.backdrop) : undefined;
			const backdrop = backdropToken
				? parseColorWithAlpha(String(backdropToken.resolvedValue))
				: null;
			if (!backdrop || backdrop.a < 1) {
				return {
					constraintId,
					constraintName,
					severity: 'warning',
					message: !config.backdrop
						? `Cannot validate contrast: '${config.against}' is translucent; name the opaque surface under it as 'backdrop'`
						: !backdropToken
							? `Cannot validate contrast: backdrop token '${config.backdrop}' not found`
							: !backdrop
								? `Cannot validate contrast: backdrop token '${config.backdrop}' is not a color`
								: `Cannot validate contrast: backdrop token '${config.backdrop}' must be opaque`,
					expected: `contrast ratio >= ${config.min}`,
					actual: 'unknown',
				};
			}
			surface = compositeOver(background, backdrop);
		}

		const ratio = calculateContrastRatio(compositeOver(foreground, surface), surface);

		if (ratio < config.min) {
			return {
				constraintId,
				constraintName,
				severity: 'error',
				message: `Contrast ratio ${ratio.toFixed(2)}:1 is below minimum ${config.min}:1`,
				expected: `>= ${config.min}:1`,
				actual: `${ratio.toFixed(2)}:1`,
			};
		}

		return null;
	},
};

// =============================================================================
// Reference Validator
// =============================================================================

export const referenceValidator: Validator<ReferenceConfig> = {
	type: 'reference',

	validate(_value, config, constraintId, constraintName, context) {
		const referencedToken = context.allTokens.get(config.token);

		if (!referencedToken) {
			return {
				constraintId,
				constraintName,
				severity: 'error',
				message: `Referenced token '${config.token}' does not exist`,
				expected: `token '${config.token}' to exist`,
				actual: 'token not found',
			};
		}

		// Optionally, could check if value matches the referenced token
		// For now, just checking existence
		return null;
	},
};

// =============================================================================
// Ramp Validator
// =============================================================================

export const rampValidator: Validator<RampConfig> = {
	type: 'ramp',

	validateAll(value, config, constraintId, constraintName, context) {
		const token: ValidatorToken = context.token ?? {
			id: '',
			resolvedValue: typeof value === 'number' ? value : String(value),
		};
		return evaluateRampConstraint(
			token,
			{
				id: constraintId,
				name: constraintName,
				applyTo: context.applyTo ?? '*',
				severity: context.severity ?? 'error',
				enabled: true,
				config,
			},
			context.allTokens,
			context.rampRepeatGroups,
			context.rampUnevenViolations,
		);
	},

	validate(value, config, constraintId, constraintName, context) {
		return this.validateAll?.(value, config, constraintId, constraintName, context)[0] ?? null;
	},
};

// =============================================================================
// Validator Registry
// =============================================================================

// biome-ignore lint/suspicious/noExplicitAny: Registry stores heterogeneous validator types
const validators = new Map<string, Validator<any>>([
	['enum', enumValidator],
	['range', rangeValidator],
	['pattern', patternValidator],
	['scale', scaleValidator],
	['contrast', contrastValidator],
	['reference', referenceValidator],
	['ramp', rampValidator],
]);

export function getValidator(type: string): Validator | undefined {
	return validators.get(type);
}

/**
 * Evaluate a constraint config through the validator registry and return every violation.
 */
export function validateValues(
	value: unknown,
	config: ConstraintConfig,
	constraintId: string,
	constraintName: string,
	context: ValidatorContext,
): ConstraintViolation[] {
	const validator = getValidator(config.type);

	if (!validator) {
		return [
			{
				constraintId,
				constraintName,
				severity: 'warning',
				message: `Unknown constraint type: ${config.type}`,
			},
		];
	}

	if (validator.validateAll) {
		return validator.validateAll(
			value,
			config as Parameters<typeof validator.validate>[1],
			constraintId,
			constraintName,
			context,
		);
	}

	const single = validator.validate(
		value,
		config as Parameters<typeof validator.validate>[1],
		constraintId,
		constraintName,
		context,
	);
	return single ? [single] : [];
}

/**
 * Evaluate one constraint against a token through the validator registry, returning all violations.
 *
 * Advisory sub-checks (such as `ramp:repeat` and `ramp:uneven`) keep `severity: 'warning'`
 * instead of being overwritten by `constraint.severity`.
 */
export function validateConstraintForToken(
	token: ValidatorToken,
	constraint: Constraint,
	allTokens: Map<string, ValidatorToken>,
	rampRepeatGroups?: Map<string, string[]>,
	rampUnevenViolations?: Map<string, ConstraintViolation>,
): ConstraintViolation[] {
	if (constraint.config.type !== 'ramp' && !matchesPattern(token.id, constraint.applyTo)) {
		return [];
	}

	const rawViolations = validateValues(
		token.resolvedValue,
		constraint.config,
		constraint.id,
		constraint.name,
		{
			allTokens,
			token,
			applyTo: constraint.applyTo,
			severity: constraint.severity,
			rampRepeatGroups,
			rampUnevenViolations,
		},
	);

	return rawViolations.map((violation) => {
		const preserveAdvisory =
			violation.code !== undefined && ADVISORY_VIOLATION_CODES.has(violation.code);
		return {
			...violation,
			severity: preserveAdvisory ? violation.severity : constraint.severity,
		};
	});
}

export function validateValue(
	value: unknown,
	config: ConstraintConfig,
	constraintId: string,
	constraintName: string,
	context: ValidatorContext,
): ConstraintViolation | null {
	return validateValues(value, config, constraintId, constraintName, context)[0] ?? null;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Extract numeric value from a string (e.g., "8px" -> 8, "1.5rem" -> 1.5)
 */
export function parseNumericValue(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}

	if (typeof value === 'string') {
		// A number (optionally with exponent, e.g. "1e3") followed only by a unit such as
		// px, rem or %. "1e3px" is 1000px; "1em" is 1 with unit "em".
		const match = value.match(/^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*[a-zA-Z%]*\s*$/);
		if (match) {
			const num = Number.parseFloat(match[1]);
			return Number.isFinite(num) ? num : null;
		}
	}

	return null;
}

/** Clamp a channel to the 0-255 range and round it */
function clampChannel(value: number): number {
	return Math.min(255, Math.max(0, Math.round(value)));
}

/** Convert HSL (h in degrees, s and l in 0-100) to RGB */
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
	const hue = ((h % 360) + 360) % 360;
	const sat = Math.min(100, Math.max(0, s)) / 100;
	const light = Math.min(100, Math.max(0, l)) / 100;
	const chroma = (1 - Math.abs(2 * light - 1)) * sat;
	const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
	const m = light - chroma / 2;
	let r = 0;
	let g = 0;
	let b = 0;
	if (hue < 60) {
		[r, g, b] = [chroma, x, 0];
	} else if (hue < 120) {
		[r, g, b] = [x, chroma, 0];
	} else if (hue < 180) {
		[r, g, b] = [0, chroma, x];
	} else if (hue < 240) {
		[r, g, b] = [0, x, chroma];
	} else if (hue < 300) {
		[r, g, b] = [x, 0, chroma];
	} else {
		[r, g, b] = [chroma, 0, x];
	}
	return {
		r: clampChannel((r + m) * 255),
		g: clampChannel((g + m) * 255),
		b: clampChannel((b + m) * 255),
	};
}

const NUMBER = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)';
const SEPARATOR = '\\s*(?:,|\\s)\\s*';
const ALPHA = `(?:\\s*[,/]\\s*(${NUMBER})(%?))?`;
const RGB_PATTERN = new RegExp(
	`^rgba?\\(\\s*(${NUMBER})(%?)${SEPARATOR}(${NUMBER})(%?)${SEPARATOR}(${NUMBER})(%?)${ALPHA}\\s*\\)$`,
	'i',
);
const HSL_PATTERN = new RegExp(
	`^hsla?\\(\\s*(${NUMBER})(?:deg)?${SEPARATOR}(${NUMBER})%${SEPARATOR}(${NUMBER})%${ALPHA}\\s*\\)$`,
	'i',
);

/**
 * Parse a CSS color to RGB. Supports #RGB, #RGBA, #RRGGBB, #RRGGBBAA (alpha is
 * ignored here; parseColorWithAlpha keeps it), rgb()/rgba() with 0-255 or percentage channels (clamped), and
 * hsl()/hsla().
 */
export function parseColor(value: string): { r: number; g: number; b: number } | null {
	const input = value.trim();

	const hexMatch = input.match(/^#([0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/);
	if (hexMatch) {
		let hex = hexMatch[1];
		if (hex.length <= 4) {
			hex = hex
				.split('')
				.map((c) => c + c)
				.join('');
		}
		return {
			r: Number.parseInt(hex.substring(0, 2), 16),
			g: Number.parseInt(hex.substring(2, 4), 16),
			b: Number.parseInt(hex.substring(4, 6), 16),
		};
	}

	const rgbMatch = input.match(RGB_PATTERN);
	if (rgbMatch) {
		const channel = (raw: string, percent: string) =>
			clampChannel(percent ? (Number.parseFloat(raw) / 100) * 255 : Number.parseFloat(raw));
		return {
			r: channel(rgbMatch[1], rgbMatch[2]),
			g: channel(rgbMatch[3], rgbMatch[4]),
			b: channel(rgbMatch[5], rgbMatch[6]),
		};
	}

	const hslMatch = input.match(HSL_PATTERN);
	if (hslMatch) {
		return hslToRgb(
			Number.parseFloat(hslMatch[1]),
			Number.parseFloat(hslMatch[2]),
			Number.parseFloat(hslMatch[3]),
		);
	}

	return null;
}

/** A color with its alpha, 0 (transparent) to 1 (opaque) */
export interface RgbaColor {
	r: number;
	g: number;
	b: number;
	a: number;
}

/**
 * Parse a CSS color with its alpha: the forms parseColor reads, keeping the
 * alpha of #RGBA, #RRGGBBAA and rgba()/hsla() (a number or a percentage,
 * clamped to 0-1). An opaque form has alpha 1.
 */
export function parseColorWithAlpha(value: string): RgbaColor | null {
	const rgb = parseColor(value);
	if (!rgb) return null;
	return { ...rgb, a: parseAlphaChannel(value.trim()) };
}

/** The alpha of a color parseColor accepted */
function parseAlphaChannel(input: string): number {
	const hex = input.match(/^#([0-9A-Fa-f]{4}|[0-9A-Fa-f]{8})$/);
	if (hex) {
		const digits = hex[1].length === 4 ? hex[1][3].repeat(2) : hex[1].slice(6);
		return Number.parseInt(digits, 16) / 255;
	}
	// The optional fourth argument of rgba()/hsla(), after a comma or a slash
	const rgb = input.match(RGB_PATTERN);
	const hsl = rgb ? null : input.match(HSL_PATTERN);
	const [raw, percent] = rgb ? [rgb[7], rgb[8]] : hsl ? [hsl[4], hsl[5]] : [undefined, ''];
	if (raw === undefined) return 1;
	const parsed = Number.parseFloat(raw);
	return Math.min(1, Math.max(0, percent ? parsed / 100 : parsed));
}

/**
 * `top` drawn over `bottom` (source-over). The result keeps fractional channels,
 * so a contrast measured on it is not rounded first.
 */
export function compositeOver(top: RgbaColor, bottom: RgbaColor): RgbaColor {
	const a = top.a + bottom.a * (1 - top.a);
	if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
	const mix = (front: number, back: number) => (front * top.a + back * bottom.a * (1 - top.a)) / a;
	return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
}

/**
 * Calculate relative luminance (WCAG 2.0)
 */
export function calculateLuminance(color: { r: number; g: number; b: number }): number {
	const [r, g, b] = [color.r, color.g, color.b].map((c) => {
		const sRGB = c / 255;
		return sRGB <= 0.03928 ? sRGB / 12.92 : ((sRGB + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Calculate contrast ratio between two colors (WCAG 2.0)
 */
export function calculateContrastRatio(
	color1: { r: number; g: number; b: number },
	color2: { r: number; g: number; b: number },
): number {
	const l1 = calculateLuminance(color1);
	const l2 = calculateLuminance(color2);
	const lighter = Math.max(l1, l2);
	const darker = Math.min(l1, l2);
	return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Check if a token ID matches a glob pattern.
 * Uses the shared glob dialect: `*` matches any characters including dots.
 */
export function matchesPattern(tokenId: string, pattern: string): boolean {
	return matchesGlob(tokenId, pattern);
}
