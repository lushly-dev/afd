/**
 * Constraint Validators
 *
 * Validate token values against constraint configurations.
 */

import type {
	ConstraintConfig,
	ConstraintViolation,
	ContrastConfig,
	EnumConfig,
	PatternConfig,
	RangeConfig,
	ReferenceConfig,
	ScaleConfig,
} from '../types/constraint.js';
import { matchesGlob } from '../utils/glob.js';
import { checkPattern } from './pattern-safety.js';

// =============================================================================
// Minimal token type for validation context
// =============================================================================

export interface ValidatorToken {
	id: string;
	resolvedValue: string | number;
}

// =============================================================================
// Validator Interface
// =============================================================================

export interface ValidatorContext {
	/** All resolved tokens (for reference/contrast validators) */
	allTokens: Map<string, ValidatorToken>;
}

export interface Validator<T extends ConstraintConfig = ConstraintConfig> {
	/** Constraint type this validator handles */
	type: T['type'];

	/**
	 * Validate a token value against the constraint config
	 * @returns null if valid, or a violation object if invalid
	 */
	validate(
		value: unknown,
		config: T,
		constraintId: string,
		constraintName: string,
		context: ValidatorContext,
	): ConstraintViolation | null;
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

	validate(value, config, constraintId, constraintName) {
		const strValue = String(value);

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
				message: `Value must match pattern: ${config.pattern}`,
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

		const color1 = parseColor(String(value));
		const color2 = parseColor(String(againstToken.resolvedValue));

		if (!color1 || !color2) {
			return {
				constraintId,
				constraintName,
				severity: 'warning',
				message: 'Cannot validate contrast: invalid color format',
				expected: `contrast ratio >= ${config.min}`,
				actual: 'invalid color',
			};
		}

		const ratio = calculateContrastRatio(color1, color2);

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
]);

export function getValidator(type: string): Validator | undefined {
	return validators.get(type);
}

export function validateValue(
	value: unknown,
	config: ConstraintConfig,
	constraintId: string,
	constraintName: string,
	context: ValidatorContext,
): ConstraintViolation | null {
	const validator = getValidator(config.type);

	if (!validator) {
		return {
			constraintId,
			constraintName,
			severity: 'warning',
			message: `Unknown constraint type: ${config.type}`,
		};
	}

	return validator.validate(
		value,
		config as Parameters<typeof validator.validate>[1],
		constraintId,
		constraintName,
		context,
	);
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
const ALPHA = `(?:\\s*[,/]\\s*${NUMBER}%?)?`;
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
 * ignored), rgb()/rgba() with 0-255 or percentage channels (clamped), and
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

/**
 * Calculate relative luminance (WCAG 2.0)
 */
export function calculateLuminance(color: {
	r: number;
	g: number;
	b: number;
}): number {
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
